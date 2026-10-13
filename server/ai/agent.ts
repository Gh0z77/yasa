// One chat turn: stream the model, apply actions, validate the build, repair, snapshot (docs/SPEC.md §8.5, §15.2).
import { LIMITS } from '../../shared/constants';
import { normalizePath, pathError } from '../../shared/paths';
import type {
  ActionPart,
  BuildErrorInfo,
  BuildSummary,
  ChatErrorCode,
  ChatEvent,
  ChatMessage,
  ChatRequest,
  FileChange,
  MessagePart,
  ProjectFile,
  User, ModelId } from '../../shared/types';
import { getConfig } from '../env';
import { logger } from '../lib/logger';
import { buildProject, type BuildOutput } from '../preview/bundler';
import { applyFileChanges, listFiles } from '../services/files';
import { listMessages, updateMessage } from '../services/messages';
import { getProjectRow, updateProject, type ProjectRow } from '../services/projects';
import { getUpload, uploadFileName } from '../services/uploads';
import { recordUsage } from '../services/usage';
import { createVersion, listVersions, uncommittedPaths, versionChangedPaths } from '../services/versions';
import { applyAction, treeFromFiles, type ApplyResult, type WorkingTree } from './apply';
import {
  buildMessages,
  renderBuildErrors,
  renderFilesFull,
  timelineNotes,
  type ContextImage,
} from './context';
import { ProtocolParser, type ParsedAction } from './parser';
import { buildSystemPrompt, CONTINUE_INTRO, FAILED_ACTIONS_INTRO, FIX_BUILD_INTRO, UNUSED_FILES_INTRO } from './prompt';
import { declareDependencies, fixMigrationSql, isMigrationPath, restoreTree, unusedFileError, unusedFiles } from './tidy';
import { generateImage, imageGenerationEnabled, normalizeAspect } from '../services/imagegen';
import { isSupabaseConnected } from '../services/supabase';
import { markAvailable, markUnavailable } from './health';
import { ProviderError, type ProviderMessage, type ProviderStopReason } from './providers/types';
import type { ResolvedModel } from './registry';

export interface TurnContext {
  project: ProjectRow;
  user: User;
  request: ChatRequest;
  model: ResolvedModel;
  /** Models to switch to, in order, when the current one cannot serve the request. */
  fallbacks?: ResolvedModel[];
  /** The model the user asked for, when the turn starts on another one because that model just failed. */
  skippedModel?: ModelId | null;
  userMessage: ChatMessage;
  /** Live assistant message; `parts` is mutated in place so snapshots stay current. */
  assistantMessage: ChatMessage;
  images: ContextImage[];
  signal: AbortSignal;
  emit(event: ChatEvent): void;
}

interface ActionOutcome {
  action: ParsedAction;
  result: ApplyResult;
}

interface PassResult {
  rawText: string;
  outcomes: ActionOutcome[];
  stop: ProviderStopReason;
  stopDetail?: string;
  changed: boolean;
  /** The provider error that cut the stream off mid-answer, if that is why the pass ended. */
  cut: ProviderError | null;
}

const UPLOAD_REF = /\/uploads\/(upl_[a-z2-7]{26})\.(?:png|jpe?g|webp|gif)/g;
const PERSIST_EVERY_MS = 2000;
const RAW_HISTORY_MAX = 300_000;
const RETRY_DELAYS_MS = [1500, 5000];
/** Longest silence tolerated from a provider stream (thinking models still emit thought summaries). */
const STALL_TIMEOUT_MS = 120_000;
/** With another model to switch to, a provider gets this long to send its first event. */
const FIRST_EVENT_TIMEOUT_MS = 25_000;
/** Pictures one reply may generate, and where they may be stored. */
const MAX_IMAGES_PER_TURN = 6;
const IMAGE_PATH = /^public\/[\w./-]+\.(?:jpe?g|png|webp)$/i;
/** How many times a turn resumes after its stream is cut off mid-answer. */
const MAX_RESUMES = 3;

function treeToFiles(tree: WorkingTree): ProjectFile[] {
  const now = new Date().toISOString();
  return [...tree.entries()].map(([path, f]) => ({ path, content: f.content, encoding: f.encoding, size: f.content.length, updatedAt: now }));
}

function firstSentence(text: string): string {
  const clean = text.replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim();
  const m = /^(.{8,120}?[.!?。])(?:\s|$)/.exec(clean);
  return (m ? m[1] : clean.slice(0, 120)).trim();
}

export async function runTurn(ctx: TurnContext): Promise<void> {
  const { project, user, request, emit, signal } = ctx;
  // The model in use; replaced when a provider fails before producing anything and a fallback exists.
  let active = ctx.model;
  const fallbacks = [...(ctx.fallbacks ?? [])];
  const mode = request.mode === 'chat' ? 'chat' : 'build';
  const startedAt = Date.now();
  const parts = ctx.assistantMessage.parts;
  const config = getConfig();

  let lastPersist = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let title: string | null = null;
  let anyChange = false;
  let lastBuild: BuildSummary | null = null;
  let thinkingIndex = -1;
  let thinkingStarted = 0;
  const actionIndex = new Map<string, number>();

  // --- part helpers ---------------------------------------------------------
  const persist = (force = false) => {
    if (!force && Date.now() - lastPersist < PERSIST_EVERY_MS) return;
    lastPersist = Date.now();
    updateMessage(ctx.assistantMessage.id, { parts });
  };
  // Events carry copies: text parts keep growing in place and subscribers serialize events later.
  const addPart = (part: MessagePart): number => {
    parts.push(part);
    emit({ type: 'part_start', index: parts.length - 1, part: structuredClone(part) });
    return parts.length - 1;
  };
  const updatePart = (index: number, part: MessagePart) => {
    parts[index] = part;
    emit({ type: 'part_update', index, part: structuredClone(part) });
  };
  const endThinking = () => {
    if (thinkingIndex === -1) return;
    const part = parts[thinkingIndex];
    if (part.type === 'thinking') updatePart(thinkingIndex, { ...part, durationMs: Date.now() - thinkingStarted });
    thinkingIndex = -1;
  };
  const appendThinking = (delta: string) => {
    if (thinkingIndex === -1) {
      thinkingStarted = Date.now();
      thinkingIndex = addPart({ type: 'thinking', text: delta, durationMs: null });
      return;
    }
    const part = parts[thinkingIndex];
    if (part.type === 'thinking') {
      part.text += delta;
      emit({ type: 'part_delta', index: thinkingIndex, delta });
    }
  };
  const appendText = (delta: string) => {
    endThinking();
    const last = parts[parts.length - 1];
    if (last && last.type === 'text') {
      last.text += delta;
      emit({ type: 'part_delta', index: parts.length - 1, delta });
    } else {
      // Skip pure whitespace between blocks instead of opening an empty text part.
      if (delta.trim() === '') return;
      addPart({ type: 'text', text: delta.replace(/^\s+/, '') });
    }
    persist();
  };
  const addError = (code: ChatErrorCode, message: string) => {
    endThinking();
    addPart({ type: 'error', code, message });
    emit({ type: 'error', error: { code, message } });
  };

  // --- state ------------------------------------------------------------------
  const tree = treeFromFiles(listFiles(project.id));
  const history = listMessages(project.id).filter((m) => m.id !== ctx.userMessage.id && m.id !== ctx.assistantMessage.id);
  // "First" until a turn has produced a version: a turn that only asked questions does not count.
  const isFirstAiTurn = !history.some((m) => m.role === 'assistant' && m.versionId !== null);
  const alreadyAsked = history.some((m) => m.role === 'assistant' && m.parts.some((p) => p.type === 'questions'));
  // Ask before building only on a genuinely new project, once, and never for fixes or continuations.
  const askFirst = mode === 'build' && isFirstAiTurn && !alreadyAsked && !request.intent && request.skipQuestions !== true && !history.some((m) => m.role === 'assistant');
  const timeline = timelineNotes({
    versions: listVersions(project.id),
    history,
    uncommittedPaths: uncommittedPaths(project.id),
    changedPathsOf: (versionId) => versionChangedPaths(project.id, versionId),
  });
  // Keep the user's manual edits in their own version so the AI version's diff is purely AI changes.
  if (mode === 'build' && getProjectRow(project.id)?.has_uncommitted_changes) {
    createVersion(project.id, { summary: 'Manual edits', source: 'manual' });
  }

  const system = buildSystemPrompt({ mode, customInstructions: project.custom_instructions, supabase: isSupabaseConnected(project.id), askFirst, images: imageGenerationEnabled() });
  const baseMessages = buildMessages({
    tree,
    history,
    request: {
      message: request.message,
      selectedElement: request.selectedElement,
      runtimeErrors: request.runtimeErrors,
      locale: request.locale,
      mode,
    },
    images: ctx.images,
    timeline,
  });

  if (ctx.skippedModel && ctx.skippedModel !== active.modelId) {
    addPart({ type: 'notice', code: 'model_fallback', from: ctx.skippedModel, to: active.modelId });
  }

  // --- applying actions -----------------------------------------------------------
  const copyReferencedUploads = (content: string): FileChange[] => {
    const extra: FileChange[] = [];
    for (const match of content.matchAll(UPLOAD_REF)) {
      const upload = getUpload(match[1]);
      if (!upload || upload.userId !== user.id) continue;
      const path = `public/uploads/${uploadFileName(match[1], upload.attachment.mime)}`;
      if (tree.has(path)) continue;
      const base64 = Buffer.from(upload.data).toString('base64');
      tree.set(path, { content: base64, encoding: 'base64' });
      extra.push({ path, kind: 'upsert', content: base64, encoding: 'base64' });
    }
    return extra;
  };

  // Pictures are generated in the background while the model keeps writing; the turn waits for them before it
  // validates the build and snapshots a version.
  const pendingImages: Promise<void>[] = [];
  let imagesRequested = 0;
  const startImage = (action: Extract<ParsedAction, { kind: 'image' }>, index: number, part: ActionPart, outcomes: ActionOutcome[]): boolean => {
    const path = normalizePath(action.path);
    // A picture that cannot be made is reported on its own row; it is not something the model can "repair".
    outcomes.push({ action, result: { ok: true, path, changes: [], linesAdded: 0, linesRemoved: 0 } });
    const reject = (error: string): boolean => {
      updatePart(index, { ...part, path, status: 'error', error });
      return false;
    };
    if (!imageGenerationEnabled()) return reject('Image generation is turned off on this server');
    if (!IMAGE_PATH.test(path) || pathError(path)) return reject('Images are saved under public/ as .jpg, .png or .webp');
    if (imagesRequested >= MAX_IMAGES_PER_TURN) return reject(`A reply can generate up to ${MAX_IMAGES_PER_TURN} images`);
    imagesRequested++;
    pendingImages.push(
      generateImage({ prompt: action.prompt, aspect: normalizeAspect(action.aspect), signal })
        .then((image) => {
          const base64 = image.data.toString('base64');
          tree.set(path, { content: base64, encoding: 'base64' });
          const changes: FileChange[] = [{ path, kind: 'upsert', content: base64, encoding: 'base64' }];
          applyFileChanges(project.id, changes);
          emit({ type: 'files_changed', changes });
          updatePart(index, { ...part, path, status: 'done' });
          persist(true);
        })
        .catch((err) => {
          logger.warn('Image generation failed', { projectId: project.id, path, error: err instanceof Error ? err.message : String(err) });
          updatePart(index, { ...part, path, status: 'error', error: signal.aborted ? 'Stopped' : 'The image could not be generated' });
        }),
    );
    return true;
  };

  const handleActionEnd = (action: ParsedAction, outcomes: ActionOutcome[]): boolean => {
    const index = actionIndex.get(action.id);
    if (index === undefined) return false;
    const part = parts[index] as ActionPart;
    if (action.kind === 'image') return startImage(action, index, part, outcomes);
    if (action.kind === 'write' && isMigrationPath(normalizePath(action.path))) action.content = fixMigrationSql(action.content);
    const result = signal.aborted && action.incomplete
      ? ({ ok: false, error: 'Stopped', changes: [], linesAdded: 0, linesRemoved: 0 } satisfies ApplyResult)
      : applyAction(tree, action);
    outcomes.push({ action, result });
    if (!result.ok) {
      updatePart(index, { ...part, path: result.path ?? part.path, status: 'error', error: result.error });
      return false;
    }
    const changes = [...result.changes];
    for (const change of result.changes) {
      if (change.kind === 'upsert' && change.content && change.encoding !== 'base64') changes.push(...copyReferencedUploads(change.content));
    }
    if (changes.length > 0) {
      applyFileChanges(project.id, changes);
      emit({ type: 'files_changed', changes });
    }
    updatePart(index, {
      ...part,
      path: result.path ?? part.path,
      status: 'done',
      linesAdded: result.linesAdded,
      linesRemoved: result.linesRemoved,
    });
    persist(true);
    return changes.length > 0;
  };

  /** Hands the rest of the turn to another model and says so in the chat. */
  const switchTo = (next: ResolvedModel) => {
    endThinking();
    addPart({ type: 'notice', code: 'model_fallback', from: active.modelId, to: next.modelId });
    active = next;
    ctx.assistantMessage.model = next.modelId;
    updateMessage(ctx.assistantMessage.id, { model: next.modelId, parts });
  };

  // --- one provider pass ------------------------------------------------------------
  const streamPass = async (messages: ProviderMessage[], pass: number): Promise<PassResult> => {
    const outcomes: ActionOutcome[] = [];
    let rawText = '';
    let stop: ProviderStopReason = 'end';
    let stopDetail: string | undefined;
    let changed = false;

    const parser = new ProtocolParser(
      {
        onText: appendText,
        onActionStart: (a) => {
          endThinking();
          if (mode === 'chat') return;
          const path = a.path ? normalizePath(a.path) : a.path;
          const index = addPart({
            type: 'action',
            id: a.id,
            kind: a.kind,
            path,
            ...(a.from ? { from: normalizePath(a.from) } : {}),
            ...(a.dependency ? { dependency: a.dependency } : {}),
            status: 'pending',
          });
          actionIndex.set(a.id, index);
        },
        onActionDelta: (id, delta) => {
          const index = actionIndex.get(id);
          if (index !== undefined) emit({ type: 'part_delta', index, delta });
        },
        onActionEnd: (action) => {
          if (mode === 'chat') return;
          if (handleActionEnd(action, outcomes)) changed = true;
        },
        onProject: (meta) => {
          if (mode === 'chat' || !isFirstAiTurn) return;
          const row = getProjectRow(project.id);
          if (!row) return;
          const patch: { name?: string; emoji?: string; description?: string } = {};
          if (meta.name && !row.name_locked) patch.name = meta.name.slice(0, LIMITS.projectNameMax);
          if (meta.emoji && !row.name_locked) patch.emoji = [...meta.emoji].slice(0, 4).join('');
          if (meta.description && !row.description) patch.description = meta.description.slice(0, 160);
          if (Object.keys(patch).length === 0) return;
          const updated = updateProject(project.id, patch);
          emit({ type: 'project_updated', project: { name: updated.name, emoji: updated.emoji, description: updated.description } });
        },
        onTitle: (value) => {
          if (mode === 'build' && !title) title = value;
        },
        onQuestions: (items) => {
          // Only where the prompt invited them: later turns must build, not interview the user again.
          if (!askFirst) return;
          endThinking();
          addPart({ type: 'questions', items });
        },
        onSuggestions: (items) => {
          endThinking();
          addPart({ type: 'suggestions', items });
        },
      },
      `p${pass}a`,
    );

    // Set when the stream broke mid-answer; the pass then ends like a truncated one and the turn resumes.
    let cut: ProviderError | null = null;
    // Transient provider failures are retried as long as nothing of this pass has reached the user yet.
    for (let attempt = 0; ; attempt++) {
      // A connection that silently stalls would otherwise hang the job forever: abort after a quiet period.
      const passAbort = new AbortController();
      const onJobAbort = () => passAbort.abort();
      signal.addEventListener('abort', onJobAbort, { once: true });
      let stalled = false;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const armIdleTimer = (first = false) => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(
          () => {
            stalled = true;
            passAbort.abort();
          },
          first && fallbacks.length > 0 && !config.isTest ? FIRST_EVENT_TIMEOUT_MS : STALL_TIMEOUT_MS,
        );
      };
      try {
        armIdleTimer(true);
        const stream = active.provider.stream({
          model: active.model,
          system,
          messages,
          maxOutputTokens: LIMITS.maxOutputTokens,
          apiKey: active.apiKey,
          baseUrl: active.baseUrl,
          signal: passAbort.signal,
        });
        for await (const event of stream) {
          armIdleTimer();
          if (event.type === 'text') {
            rawText += event.delta;
            parser.push(event.delta);
          } else if (event.type === 'thinking') {
            appendThinking(event.delta);
          } else if (event.type === 'usage') {
            inputTokens += event.inputTokens;
            outputTokens += event.outputTokens;
          } else if (event.type === 'stop') {
            stop = event.reason;
            stopDetail = event.detail;
          }
        }
        if (stalled && !signal.aborted) throw new ProviderError('network', 'The AI provider stopped responding.');
        if (rawText !== '') markAvailable(active.modelId);
        break;
      } catch (rawErr) {
        const err = stalled && !signal.aborted ? new ProviderError('network', 'The AI provider stopped responding.') : rawErr;
        const transient = err instanceof ProviderError && ['network', 'overloaded', 'rate_limit'].includes(err.kind);
        // Nothing of this pass has reached the user yet, so another model can take over without leaving traces:
        // used-up quota, an overloaded or silent provider and a rejected key all move on to the next one.
        const canSwitch = err instanceof ProviderError && (transient || err.kind === 'auth') && rawText === '' && !signal.aborted;
        const next = canSwitch ? fallbacks.shift() : undefined;
        if (err instanceof ProviderError && rawText === '') markUnavailable(active.modelId, err.kind);
        if (next) {
          logger.warn('Provider request failed, switching model', { projectId: project.id, from: active.modelId, to: next.modelId, error: err });
          switchTo(next);
          attempt = -1;
          continue;
        }
        // The connection died after part of the answer arrived: keep what was applied and resume from there
        // (on the next model when there is one) instead of failing the whole turn.
        if (err instanceof ProviderError && (err.kind === 'network' || err.kind === 'overloaded') && rawText !== '' && !signal.aborted) {
          markUnavailable(active.modelId, err.kind);
          const resumeOn = fallbacks.shift();
          logger.warn('Provider stream was cut off, resuming', { projectId: project.id, model: active.modelId, resumeOn: resumeOn?.modelId, error: err });
          if (resumeOn) switchTo(resumeOn);
          cut = err;
          break;
        }
        if (!transient || rawText !== '' || attempt >= RETRY_DELAYS_MS.length || signal.aborted) throw err;
        logger.warn('Provider request failed, retrying', { projectId: project.id, attempt: attempt + 1, error: err });
        await new Promise((resolve) => setTimeout(resolve, config.isTest ? 0 : RETRY_DELAYS_MS[attempt]));
      } finally {
        clearTimeout(idleTimer);
        signal.removeEventListener('abort', onJobAbort);
      }
    }
    if (signal.aborted) stop = 'aborted';
    else if (cut) stop = 'max_tokens';
    parser.finish();
    endThinking();
    // The answer ended inside a file although the provider reported a normal end: the model ran out (free tiers
    // cap replies without saying so). Handled like a cut stream — the next model, when there is one, continues.
    if (stop === 'end' && mode === 'build' && outcomes.some((o) => o.action.incomplete)) {
      const resumeOn = fallbacks.shift();
      logger.warn('Model stopped mid-file, resuming', { projectId: project.id, model: active.modelId, resumeOn: resumeOn?.modelId });
      if (resumeOn) switchTo(resumeOn);
      cut = new ProviderError('network', 'The model stopped before finishing its answer.');
      stop = 'max_tokens';
    }
    return { rawText, outcomes, stop, stopDetail, changed, cut };
  };

  const validate = async (): Promise<BuildOutput> => {
    const current = getProjectRow(project.id);
    return buildProject(treeToFiles(tree), {
      mode: 'preview',
      appOrigin: new URL(config.appUrl).origin,
      project: { name: current?.name ?? project.name, emoji: current?.emoji ?? project.emoji, description: current?.description ?? '' },
    });
  };

  const repairMessage = (errors: BuildErrorInfo[], failed: ActionOutcome[]): string => {
    const sections: string[] = [];
    const paths = new Set<string>();
    if (errors.length) {
      sections.push(FIX_BUILD_INTRO, renderBuildErrors(errors));
      for (const e of errors) if (e.file) paths.add(e.file);
    }
    if (failed.length) {
      const lines = failed.map(({ action, result }) => {
        const path = result.path ?? ('path' in action ? action.path : '');
        if (path) paths.add(path);
        const search = result.failedSearch ? `\n  SEARCH text that was not found:\n${result.failedSearch.slice(0, 1500)}` : '';
        return `- ${action.kind} ${path}: ${result.error}${search}`;
      });
      sections.push(FAILED_ACTIONS_INTRO, `<failed_actions>\n${lines.join('\n')}\n</failed_actions>`);
    }
    if (paths.size) sections.push(`Current content of the affected files:\n${renderFilesFull(tree, [...paths].slice(0, 12))}`);
    return sections.join('\n\n');
  };

  const unusedMessage = (unused: string[]): string => {
    const hosts = ['src/App.tsx', 'src/App.jsx', 'src/main.tsx', 'src/main.jsx'].filter((path) => tree.has(path)).slice(0, 2);
    return [
      UNUSED_FILES_INTRO,
      `<unused_files>\n${unused.map((path) => `- ${path}`).join('\n')}\n</unused_files>`,
      hosts.length ? `Current content of the files that should render them:\n${renderFilesFull(tree, hosts)}` : '',
    ].filter(Boolean).join('\n\n');
  };

  // --- main loop ------------------------------------------------------------------------
  let stopped = false;
  let failed = false;
  try {
    let messages = baseMessages;
    let attempts = 0;
    let continued = false;
    let resumes = 0;
    let wiringAsked = false;
    let escalated = false;
    // The files as they were at the last build that passed in this turn.
    let lastGood: WorkingTree | null = null;
    const written = new Set<string>();
    const rawSoFar: string[] = [];

    for (let pass = 0; pass < 8; pass++) {
      const result = await streamPass(messages, pass);
      // Every picture this pass asked for is in the project (or has failed) before the build is checked.
      await Promise.allSettled(pendingImages);
      if (result.changed) anyChange = true;
      rawSoFar.push(result.rawText);

      if (result.stop === 'aborted') {
        stopped = true;
        break;
      }
      if (result.stop === 'refusal') {
        addError('refusal', result.stopDetail ?? 'The model declined this request.');
        failed = true;
        break;
      }
      if (mode === 'chat') break;

      const assistantTurn = (): ProviderMessage => ({
        role: 'assistant',
        content: [{ type: 'text', text: rawSoFar.join('\n').slice(-RAW_HISTORY_MAX) || '[no output]' }],
      });

      if (result.stop === 'max_tokens') {
        const canResume = result.cut ? resumes < MAX_RESUMES : !continued;
        if (canResume) {
          if (result.cut) resumes++;
          else continued = true;
          const incomplete = result.outcomes.find((o) => o.action.incomplete);
          const written = result.outcomes.filter((o) => o.result.ok && o.result.path).map((o) => o.result.path);
          const note = [
            CONTINUE_INTRO,
            incomplete && 'path' in incomplete.action ? `The discarded incomplete action was for: ${incomplete.action.path}. Write that file again from the beginning.` : '',
            written.length ? `Files already completed: ${written.join(', ')}` : '',
          ].filter(Boolean).join('\n');
          messages = [...baseMessages, assistantTurn(), { role: 'user', content: [{ type: 'text', text: note }] }];
          continue;
        }
        if (result.cut) addError(result.cut.chatCode, result.cut.message);
        else addError('max_tokens', 'The response was too long and was cut off.');
        failed = true;
      }

      const failedActions = result.outcomes.filter((o) => !o.result.ok);
      if (!anyChange && failedActions.length === 0) break;

      let build = await validate();
      // Packages the code imports but package.json does not list are declared here, not by another model pass.
      if (build.undeclared.length > 0) {
        const changes = declareDependencies(tree, build.undeclared);
        if (changes.length > 0) {
          applyFileChanges(project.id, changes);
          emit({ type: 'files_changed', changes });
          build = await validate();
        }
      }
      const summary = build.summary;
      lastBuild = summary;
      if (summary.ok) lastGood = new Map(tree);
      for (const outcome of result.outcomes) if (outcome.result.ok && outcome.result.path) written.add(outcome.result.path);
      const withinBudget = attempts < LIMITS.autoFixAttempts;
      // A model that could not repair its own work gets one more pass — done by the next model in line.
      const escalate = !withinBudget && !escalated && fallbacks.length > 0 && (!summary.ok || failedActions.length > 0);
      const canRetry = (withinBudget || escalate) && !failed && !signal.aborted;
      // Screens written in this turn that nothing renders: the build passes, but the user would see an empty app.
      const unused = summary.ok && failedActions.length === 0 && withinBudget && canRetry && !wiringAsked ? unusedFiles(build.bundled, written, tree) : [];
      const needsRepair = !summary.ok || failedActions.length > 0 || unused.length > 0;
      const willRetry = needsRepair && canRetry;
      addPart({
        type: 'build',
        attempt: attempts,
        ok: summary.ok && unused.length === 0,
        errors: (unused.length > 0 ? unused.map(unusedFileError) : summary.errors).slice(0, 20),
        failedActions: failedActions.length,
        willRetry,
        durationMs: summary.durationMs,
      });
      emit({ type: 'build', summary, attempt: attempts });
      persist(true);

      if (willRetry) {
        if (escalate) {
          escalated = true;
          const next = fallbacks.shift()!;
          logger.warn('Build still broken after repairs, switching model', { projectId: project.id, from: active.modelId, to: next.modelId });
          switchTo(next);
        }
        attempts++;
        if (unused.length > 0) wiringAsked = true;
        messages = [
          ...baseMessages,
          assistantTurn(),
          { role: 'user', content: [{ type: 'text', text: unused.length > 0 ? unusedMessage(unused) : repairMessage(summary.errors, failedActions) }] },
        ];
        continue;
      }
      if (!failed && !summary.ok && lastGood && !signal.aborted) {
        // The repairs made an app that worked worse: the user gets the last state that built, not a broken one.
        const changes = restoreTree(tree, lastGood);
        if (changes.length > 0) {
          applyFileChanges(project.id, changes);
          emit({ type: 'files_changed', changes });
        }
        const restored = (await validate()).summary;
        logger.warn('Repairs broke a working build, restored the last good state', { projectId: project.id, files: changes.length, ok: restored.ok });
        if (restored.ok) {
          lastBuild = restored;
          addPart({ type: 'build', attempt: attempts + 1, ok: true, errors: [], failedActions: 0, willRetry: false, durationMs: restored.durationMs });
          emit({ type: 'build', summary: restored, attempt: attempts + 1 });
          persist(true);
          break;
        }
      }
      if (!failed && !summary.ok) {
        addError('build_failed', 'The app does not build yet and could not be fixed automatically.');
        failed = true;
      } else if (!failed && failedActions.length > 0) {
        addError('edit_failed', 'Some changes could not be applied.');
        failed = true;
      }
      break;
    }
  } catch (err) {
    if (signal.aborted) stopped = true;
    else if (err instanceof ProviderError) {
      addError(err.chatCode, err.message);
      failed = true;
    } else {
      logger.error('Chat turn failed', { projectId: project.id, error: err });
      addError('internal', 'Something went wrong while generating.');
      failed = true;
    }
  }

  // --- finalize -----------------------------------------------------------------------------
  try {
    await Promise.allSettled(pendingImages);
    endThinking();
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.type === 'action' && part.status === 'pending') updatePart(i, { ...part, status: 'error', error: 'Stopped' });
    }
    const text = parts.filter((p) => p.type === 'text').map((p) => (p.type === 'text' ? p.text.trim() : '')).filter(Boolean).join('\n\n');

    let versionId: string | null = null;
    if (anyChange) {
      if (stopped && !lastBuild) lastBuild = await validate().then((output) => output.summary, () => null);
      const lastText = [...parts].reverse().find((p) => p.type === 'text');
      const summary = title ?? (lastText && lastText.type === 'text' ? firstSentence(lastText.text) : '') ?? '';
      const version = createVersion(project.id, {
        summary: summary || 'AI changes',
        source: 'ai',
        messageId: ctx.assistantMessage.id,
        buildOk: lastBuild ? lastBuild.ok : null,
      });
      versionId = version.id;
      emit({ type: 'version', version });
    }

    recordUsage({
      userId: user.id,
      projectId: project.id,
      provider: active.provider.id,
      model: active.model,
      keySource: active.keySource,
      kind: request.intent === 'fix' ? 'fix' : 'message',
      inputTokens,
      outputTokens,
    });

    const final = updateMessage(ctx.assistantMessage.id, {
      content: text,
      parts,
      status: stopped ? 'stopped' : failed ? 'error' : 'done',
      versionId,
      usage: { inputTokens, outputTokens },
      durationMs: Date.now() - startedAt,
    });
    emit({ type: 'usage', inputTokens, outputTokens });
    emit({ type: 'done', message: final });
  } catch (err) {
    logger.error('Could not finalize chat turn', { projectId: project.id, error: err });
    const message = updateMessage(ctx.assistantMessage.id, { parts, status: 'error', durationMs: Date.now() - startedAt });
    emit({ type: 'error', error: { code: 'internal', message: 'Something went wrong while saving the result.' } });
    emit({ type: 'done', message });
  }
}
