// In-memory registry of running generations (one per project). Jobs outlive the HTTP request that started them.
import { LIMITS } from '../../shared/constants';
import type { Attachment, ChatEvent, ChatMessage, ChatRequest, User } from '../../shared/types';
import { getConfig } from '../env';
import { conflict, HttpError, rateLimited } from '../lib/errors';
import { keepAlive, staleGenerationMs } from '../lib/hosting';
import { logger } from '../lib/logger';
import { createMessage, findRunningMessage } from '../services/messages';
import type { ProjectRow } from '../services/projects';
import { attachUploadToProject, getUpload, uploadFileName } from '../services/uploads';
import { countServerFixesToday, countServerMessagesToday } from '../services/usage';
import { runTurn } from './agent';
import type { ContextImage } from './context';
import { planModels } from './registry';

export interface StartChatInput {
  project: ProjectRow;
  user: User;
  request: ChatRequest;
}

export interface ChatJob {
  projectId: string;
  userId: string;
  /** Subscribe to live events; returns unsubscribe. */
  subscribe(listener: (e: ChatEvent) => void): () => void;
  /** Current state for late subscribers. */
  snapshot(): { userMessage: ChatMessage | null; assistantMessage: ChatMessage };
  stop(): void;
  done: Promise<void>;
}

class Job implements ChatJob {
  readonly listeners = new Set<(e: ChatEvent) => void>();
  readonly abort = new AbortController();
  done: Promise<void> = Promise.resolve();

  constructor(
    readonly projectId: string,
    readonly userId: string,
    readonly userMessage: ChatMessage,
    readonly assistantMessage: ChatMessage,
  ) {}

  subscribe(listener: (e: ChatEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: ChatEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (err) {
        logger.warn('Chat listener failed', { error: err });
      }
    }
  }

  snapshot(): { userMessage: ChatMessage | null; assistantMessage: ChatMessage } {
    // Deep copy so later mutations of the live parts do not leak into what was sent.
    return { userMessage: this.userMessage, assistantMessage: structuredClone(this.assistantMessage) };
  }

  stop(): void {
    this.abort.abort();
  }
}

const jobs = new Map<string, Job>();

export function getActiveJob(projectId: string): ChatJob | null {
  return jobs.get(projectId) ?? null;
}

export function isGenerating(projectId: string): boolean {
  return jobs.has(projectId) || remoteGeneration(projectId) !== null;
}

/** A generation for this project that runs on another instance (serverless hosts only). */
export function remoteGeneration(projectId: string): ChatMessage | null {
  if (!getConfig().hosted || jobs.has(projectId)) return null;
  return findRunningMessage(projectId, staleGenerationMs());
}

export function isGeneratingForUser(userId: string): boolean {
  for (const job of jobs.values()) if (job.userId === userId) return true;
  return false;
}

export async function stopAllJobs(): Promise<void> {
  const running = [...jobs.values()];
  for (const job of running) job.stop();
  await Promise.allSettled(running.map((j) => j.done));
}

function loadAttachments(user: User, projectId: string, ids: string[] | undefined): { attachments: Attachment[]; images: ContextImage[] } {
  const attachments: Attachment[] = [];
  const images: ContextImage[] = [];
  for (const id of (ids ?? []).slice(0, LIMITS.attachmentsMax)) {
    const upload = getUpload(id);
    if (!upload || upload.userId !== user.id) continue;
    if (upload.projectId !== projectId) attachUploadToProject(id, projectId);
    const fileName = uploadFileName(id, upload.attachment.mime);
    attachments.push({ ...upload.attachment, projectPath: `public/uploads/${fileName}` });
    images.push({
      mime: upload.attachment.mime,
      data: Buffer.from(upload.data).toString('base64'),
      publicPath: `/uploads/${fileName}`,
      name: upload.attachment.name,
    });
  }
  return { attachments, images };
}

/**
 * Validates provider availability and limits (throws HttpError), stores the two messages and starts the
 * generation in the background. The first event a subscriber sees is `start`.
 */
export function startChatJob(input: StartChatInput): ChatJob {
  const { project, user, request } = input;
  if (isGenerating(project.id)) throw conflict('The AI is already working on this project');
  if (jobs.size >= getConfig().maxJobsGlobal) throw rateLimited('The server is busy. Try again in a moment.');
  let mine = 0;
  for (const job of jobs.values()) if (job.userId === user.id) mine++;
  if (mine >= getConfig().maxJobsPerUser) throw rateLimited('You already have generations running in other projects');

  const { model, fallbacks, skipped } = planModels(user.id, request.model);
  const limit = getConfig().dailyMessageLimit;
  if (model.keySource === 'server' && limit > 0) {
    const freeFix = request.intent === 'fix' && countServerFixesToday(user.id) < LIMITS.freeFixesPerDay;
    if (!freeFix && countServerMessagesToday(user.id) >= limit) {
      throw new HttpError(429, 'limit_reached', 'Daily message limit reached. It resets at midnight UTC — or add your own API key.', {
        chatCode: 'limit_reached',
      });
    }
  }

  const mode = request.mode === 'chat' ? 'chat' : 'build';
  const { attachments, images } = loadAttachments(user, project.id, request.attachmentIds);
  const userMessage = createMessage({
    projectId: project.id,
    userId: user.id,
    role: 'user',
    content: request.message,
    attachments,
    selectedElement: request.selectedElement ?? null,
    mode,
    status: 'done',
  });
  const assistantMessage = createMessage({
    projectId: project.id,
    role: 'assistant',
    content: '',
    mode,
    status: 'streaming',
    model: model.modelId,
  });

  const job = new Job(project.id, user.id, userMessage, assistantMessage);
  jobs.set(project.id, job);
  // Where requests may only run for so long, stop in time: what was built so far is saved as a version.
  const timeLimit = getConfig().generationTimeLimitMs;
  const deadline = timeLimit > 0 ? setTimeout(() => job.stop(), timeLimit) : null;

  job.done = new Promise<void>((resolve) => {
    // Deferred so the caller can subscribe before the first event.
    setImmediate(() => {
      job.emit({ type: 'start', userMessage, assistantMessage: structuredClone(assistantMessage) });
      runTurn({
        project,
        user,
        request: { ...request, mode },
        model,
        fallbacks,
        skippedModel: skipped,
        userMessage,
        assistantMessage,
        images,
        signal: job.abort.signal,
        emit: (event) => {
          if (event.type === 'done') {
            // The job is over once the final message exists; release the project before listeners react.
            jobs.delete(project.id);
          }
          job.emit(event);
        },
      })
        .catch((err) => logger.error('Chat job crashed', { projectId: project.id, error: err }))
        .finally(() => {
          if (deadline) clearTimeout(deadline);
          jobs.delete(project.id);
          job.listeners.clear();
          resolve();
        });
    });
  });
  keepAlive(job.done);
  return job;
}
