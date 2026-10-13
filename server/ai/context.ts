// Builds the provider messages for a chat turn (docs/SPEC.md §8.3, §15.3).
import { LIMITS } from '../../shared/constants';
import { isBinaryPath } from '../../shared/paths';
import type {
  BuildErrorInfo,
  ChatMessage,
  Locale,
  PreviewError,
  SelectedElement,
  VersionSummary,
} from '../../shared/types';
import { isTemplateFile, TEMPLATE_EXPORTS } from '../template';
import type { WorkingTree } from './apply';
import type { ProviderContentImage, ProviderContentText, ProviderMessage } from './providers/types';

const PRIORITY_PATHS = ['package.json', 'index.html', 'src/main.tsx', 'src/App.tsx', 'src/index.css'];
const SKIP_PATHS = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb']);

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Prevents file contents from closing our wrapper tags. */
function guard(text: string, tag: string): string {
  return text.split(`</${tag}>`).join(`<\\/${tag}>`);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export interface RenderFilesOptions {
  /** Paths that must be rendered in full even if they match the starter template. */
  forceFull?: Set<string>;
  /** Recently changed paths get priority when the size budget is tight. */
  recent?: string[];
}

/** <project_files> block: full text for changed files, stubs for untouched template files, names for the rest. */
export function renderProjectFiles(tree: WorkingTree, opts: RenderFilesOptions = {}): string {
  const paths = [...tree.keys()].sort();
  const order = [
    ...PRIORITY_PATHS.filter((p) => tree.has(p)),
    ...(opts.recent ?? []).filter((p) => tree.has(p) && !PRIORITY_PATHS.includes(p)),
  ];
  const seen = new Set(order);
  for (const p of paths) if (!seen.has(p)) order.push(p);

  const rendered = new Map<string, string>();
  let budget = LIMITS.contextTotalBytesMax;
  for (const path of order) {
    const file = tree.get(path)!;
    if (SKIP_PATHS.has(path)) {
      rendered.set(path, `<file path="${escapeAttr(path)}" omitted="lockfile" />`);
      continue;
    }
    if (file.encoding !== 'utf8' || isBinaryPath(path)) {
      rendered.set(path, `<file path="${escapeAttr(path)}" omitted="binary" />`);
      continue;
    }
    if (!opts.forceFull?.has(path) && isTemplateFile(path, file.content)) {
      const exports = TEMPLATE_EXPORTS[path];
      const exportsAttr = exports?.length ? ` exports="${escapeAttr(exports.join(', '))}"` : '';
      // The few files the model always needs to see in full stay inline.
      if (!PRIORITY_PATHS.includes(path)) {
        rendered.set(path, `<file path="${escapeAttr(path)}" unchanged_template="true"${exportsAttr} />`);
        continue;
      }
    }
    if (file.content.length > LIMITS.contextFileBytesMax) {
      rendered.set(path, `<file path="${escapeAttr(path)}" omitted="too large (${Math.round(file.content.length / 1024)} KB)" />`);
      continue;
    }
    if (file.content.length > budget) {
      rendered.set(path, `<file path="${escapeAttr(path)}" omitted="context budget" />`);
      continue;
    }
    budget -= file.content.length;
    rendered.set(path, `<file path="${escapeAttr(path)}">\n${guard(file.content, 'file')}${file.content.endsWith('\n') ? '' : '\n'}</file>`);
  }
  return `<project_files>\n${paths.map((p) => rendered.get(p)).join('\n')}\n</project_files>`;
}

/** Full contents of specific files (repair passes). */
export function renderFilesFull(tree: WorkingTree, paths: string[]): string {
  const out: string[] = [];
  for (const path of [...new Set(paths)]) {
    const file = tree.get(path);
    if (!file) out.push(`<file path="${escapeAttr(path)}" missing="true" />`);
    else if (file.encoding !== 'utf8') out.push(`<file path="${escapeAttr(path)}" omitted="binary" />`);
    else out.push(`<file path="${escapeAttr(path)}">\n${guard(file.content, 'file')}${file.content.endsWith('\n') ? '' : '\n'}</file>`);
  }
  return out.join('\n');
}

export function renderBuildErrors(errors: BuildErrorInfo[]): string {
  const lines = errors.slice(0, 20).map((e) => {
    const where = e.file ? `${e.file}${e.line ? `:${e.line}${e.column ? `:${e.column}` : ''}` : ''}` : 'project';
    const code = e.lineText ? `\n    > ${truncate(e.lineText.trim(), 200)}` : '';
    return `- ${where}: ${truncate(e.message, 500)}${code}`;
  });
  return `<build_errors>\n${lines.join('\n')}\n</build_errors>`;
}

function renderRuntimeErrors(errors: PreviewError[]): string {
  const lines = errors.slice(0, LIMITS.runtimeErrorsMax).map((e) => {
    const where = e.source ? ` (${truncate(e.source, 200)}${e.line ? `:${e.line}` : ''})` : '';
    const stack = e.stack ? `\n${truncate(e.stack, 800)}` : '';
    return `- [${e.kind}] ${truncate(e.message, 600)}${where}${stack}`;
  });
  return `<runtime_errors>\n${guard(lines.join('\n'), 'runtime_errors')}\n</runtime_errors>`;
}

function renderSelectedElement(el: SelectedElement): string {
  const components = el.components?.length ? el.components.join(' < ') : 'unknown';
  return [
    '<selected_element>',
    `route: ${truncate(el.path, 200)}`,
    `components (innermost first): ${truncate(components, 300)}`,
    `selector: ${truncate(el.selector, 300)}`,
    `text: ${truncate(el.text, LIMITS.selectedElementTextMax)}`,
    `html: ${guard(truncate(el.html, LIMITS.selectedElementHtmlMax), 'selected_element')}`,
    '</selected_element>',
  ].join('\n');
}

function actionSummary(message: ChatMessage, reverted: boolean): string {
  const items: string[] = [];
  for (const part of message.parts) {
    if (part.type !== 'action' || part.status !== 'done') continue;
    if (part.kind === 'dependency') items.push(`added dependency ${part.dependency?.name ?? ''}`);
    else if (part.kind === 'rename') items.push(`renamed ${part.from} → ${part.path}`);
    else items.push(`${part.kind === 'write' ? 'wrote' : part.kind === 'edit' ? 'edited' : 'deleted'} ${part.path}`);
  }
  if (items.length === 0) return '';
  return `\n[changes${reverted ? ' (reverted later by the user)' : ''}: ${items.slice(0, 40).join('; ')}]`;
}

function assistantText(message: ChatMessage): string {
  return message.parts
    .filter((p) => p.type === 'text')
    .map((p) => (p.type === 'text' ? p.text : ''))
    .join('\n')
    .trim();
}

/** Version number a 'restore' version went back to (parsed from its summary). */
function restoreTarget(version: VersionSummary): number | null {
  const m = /version (\d+)/i.exec(version.summary);
  return m ? Number(m[1]) : null;
}

export interface TimelineInput {
  /** Newest first or any order. */
  versions: VersionSummary[];
  history: ChatMessage[];
  uncommittedPaths: string[];
  changedPathsOf(versionId: string): string[];
}

/** Notes about things that happened outside the chat since the last AI turn. */
export function timelineNotes(input: TimelineInput): { notes: string[]; revertedAbove: number | null; restoreNumber: number | null } {
  const versions = [...input.versions].sort((a, b) => a.number - b.number);
  let lastAiNumber = 0;
  for (const m of input.history) {
    if (m.role === 'assistant' && m.versionNumber) lastAiNumber = Math.max(lastAiNumber, m.versionNumber);
  }
  const notes: string[] = [];
  let revertedAbove: number | null = null;
  let restoreNumber: number | null = null;
  for (const v of versions) {
    if (v.source === 'restore') {
      const target = restoreTarget(v);
      if (target !== null) {
        revertedAbove = target;
        restoreNumber = v.number;
      }
      if (v.number > lastAiNumber && target !== null) {
        notes.push(`[The user restored the project to version ${target}; changes made after it were undone.]`);
      }
    } else if (v.source === 'manual' && v.number > lastAiNumber) {
      const paths = input.changedPathsOf(v.id);
      if (paths.length) notes.push(`[The user manually edited: ${paths.slice(0, 20).join(', ')}]`);
    }
  }
  if (input.uncommittedPaths.length) {
    notes.push(`[The user manually edited: ${input.uncommittedPaths.slice(0, 20).join(', ')}]`);
  }
  return { notes, revertedAbove, restoreNumber };
}

export interface ContextImage {
  mime: string;
  /** base64 */
  data: string;
  /** e.g. /uploads/upl_xxx.png */
  publicPath: string;
  name: string;
}

export interface BuildContextInput {
  tree: WorkingTree;
  /** Earlier messages of the project, oldest → newest, without the current turn. */
  history: ChatMessage[];
  request: {
    message: string;
    selectedElement?: SelectedElement | null;
    runtimeErrors?: PreviewError[];
    locale?: Locale;
    mode: 'build' | 'chat';
  };
  images: ContextImage[];
  timeline: { notes: string[]; revertedAbove: number | null; restoreNumber: number | null };
  recentPaths?: string[];
}

function mergeConsecutive(messages: ProviderMessage[]): ProviderMessage[] {
  const out: ProviderMessage[] = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) {
      last.content.push({ type: 'text', text: '\n\n' }, ...m.content);
    } else out.push({ role: m.role, content: [...m.content] });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

/** History as provider messages: prose plus compact change lists, never full code. */
export function historyMessages(history: ChatMessage[], timeline: { revertedAbove: number | null; restoreNumber: number | null }): ProviderMessage[] {
  const recent = history.slice(-LIMITS.historyMessages);
  const out: ProviderMessage[] = [];
  for (const m of recent) {
    if (m.role === 'user') {
      let text = truncate(m.content, 6000);
      if (m.attachments.length) text += `\n[${m.attachments.length} image(s) attached]`;
      if (m.selectedElement) text += `\n[selected element: ${truncate(m.selectedElement.selector, 120)}]`;
      out.push({ role: 'user', content: [{ type: 'text', text }] });
      continue;
    }
    const reverted =
      timeline.revertedAbove !== null &&
      m.versionNumber !== null &&
      m.versionNumber > timeline.revertedAbove &&
      (timeline.restoreNumber === null || m.versionNumber < timeline.restoreNumber);
    const text = `${truncate(assistantText(m), 4000)}${actionSummary(m, reverted)}`.trim();
    if (text) out.push({ role: 'assistant', content: [{ type: 'text', text }] });
  }
  return mergeConsecutive(out);
}

/** The final user message: project state + everything the user attached to this request. */
export function buildUserTurn(input: BuildContextInput): ProviderMessage {
  const sections: string[] = [];
  sections.push(renderProjectFiles(input.tree, { recent: input.recentPaths }));
  if (input.timeline.notes.length) sections.push(input.timeline.notes.join('\n'));
  if (input.request.locale) sections.push(`<ui_locale>${input.request.locale}</ui_locale>`);
  if (input.images.length) {
    sections.push(
      `<uploaded_images>\n${input.images.map((i) => `- ${i.publicPath} (${escapeAttr(i.name)})`).join('\n')}\n</uploaded_images>`,
    );
  }
  if (input.request.selectedElement) sections.push(renderSelectedElement(input.request.selectedElement));
  if (input.request.runtimeErrors?.length) sections.push(renderRuntimeErrors(input.request.runtimeErrors));
  sections.push(`<user_request>\n${guard(input.request.message, 'user_request')}\n</user_request>`);

  const content: Array<ProviderContentText | ProviderContentImage> = [];
  for (const image of input.images) content.push({ type: 'image', mime: image.mime, data: image.data });
  content.push({ type: 'text', text: sections.join('\n\n') });
  return { role: 'user', content };
}

export function buildMessages(input: BuildContextInput): ProviderMessage[] {
  const history = historyMessages(input.history, input.timeline);
  return mergeConsecutiveKeepLast([...history, buildUserTurn(input)]);
}

/** Like mergeConsecutive, but images must stay before text inside a merged user turn. */
function mergeConsecutiveKeepLast(messages: ProviderMessage[]): ProviderMessage[] {
  const out: ProviderMessage[] = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) {
      const images = m.content.filter((p) => p.type === 'image');
      const texts = m.content.filter((p) => p.type === 'text');
      last.content = [...images, ...last.content, { type: 'text', text: '\n\n' }, ...texts];
    } else out.push({ role: m.role, content: [...m.content] });
  }
  return out;
}

/** Compact transcript of an assistant pass, used as the assistant turn before a repair/continuation pass. */
export function passSummary(text: string, actions: Array<{ kind: string; path: string | null; ok: boolean }>): string {
  const lines = actions.map((a) => `${a.ok ? 'applied' : 'FAILED'}: ${a.kind} ${a.path ?? ''}`.trim());
  const body = truncate(text.trim(), 3000);
  return `${body}${lines.length ? `\n[${lines.join('; ')}]` : ''}`.trim() || '[no text]';
}
