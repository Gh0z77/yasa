import { Hono } from 'hono';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import { z } from 'zod';
import { LIMITS, RATE_LIMITS } from '../../shared/constants';
import type { ChatEvent, ChatRequest, MessagesResponse, OkResponse, StopResponse } from '../../shared/types';
import { getActiveJob, isGenerating, startChatJob, type ChatJob } from '../ai/jobs';
import { editProject, ownProject, viewProject } from '../lib/access';
import { conflict } from '../lib/errors';
import { RateLimiter } from '../lib/rate-limit';
import { parseJson, zLocale, zModelId } from '../lib/validate';
import { clearMessages, listMessages } from '../services/messages';
import type { AppContext, AppEnv } from '../types';

const chatLimiter = new RateLimiter(RATE_LIMITS.chatPerMinute, 60_000);

const zShort = (max: number) => z.string().max(max * 4).transform((s) => s.slice(0, max));

const SelectedElementSchema = z.object({
  tagName: zShort(40),
  id: zShort(200).nullable(),
  className: zShort(1000),
  text: zShort(LIMITS.selectedElementTextMax),
  html: zShort(LIMITS.selectedElementHtmlMax),
  selector: zShort(500),
  components: z.array(zShort(80)).max(8).default([]),
  path: zShort(500),
});

const PreviewErrorSchema = z.object({
  kind: z.enum(['runtime', 'promise', 'console', 'resource', 'build']),
  message: zShort(2000),
  stack: zShort(4000).nullable(),
  source: zShort(500).nullable(),
  line: z.number().int().nullable(),
  column: z.number().int().nullable(),
  timestamp: z.number(),
});

const ChatSchema = z.object({
  message: z.string().trim().min(1, 'Write a message first').max(LIMITS.messageMax),
  attachmentIds: z.array(z.string().max(40)).max(LIMITS.attachmentsMax).optional(),
  selectedElement: SelectedElementSchema.nullable().optional(),
  runtimeErrors: z.array(PreviewErrorSchema).max(LIMITS.runtimeErrorsMax).optional(),
  model: zModelId.optional(),
  mode: z.enum(['build', 'chat']).optional(),
  intent: z.enum(['fix', 'continue']).optional(),
  locale: zLocale.optional(),
  skipQuestions: z.boolean().optional(),
});

/** Pipes job events into an SSE response until the job finishes or the client goes away. */
function pipeJob(c: AppContext, job: ChatJob, first: ChatEvent | null): Response {
  c.header('Cache-Control', 'no-cache, no-transform');
  c.header('X-Accel-Buffering', 'no');
  // Subscribe synchronously: the job emits `start` on the next tick, before the stream callback may run.
  let closed = false;
  const queue: ChatEvent[] = [];
  let wake: (() => void) | null = null;
  const push = (event: ChatEvent) => {
    queue.push(event);
    wake?.();
  };
  const unsubscribe = job.subscribe(push);
  return streamSSE(c, async (stream: SSEStreamingApi) => {
    const ping = setInterval(() => {
      if (!closed) void stream.write(': ping\n\n').catch(() => undefined);
    }, 15_000);
    stream.onAbort(() => {
      // The client left; the job keeps running in the background.
      closed = true;
      wake?.();
    });
    void job.done.then(() => {
      // Safety net in case no terminal event reached this subscriber.
      push({ type: 'error', error: { code: 'interrupted', message: 'The generation ended.' } });
    });

    try {
      if (first) await stream.writeSSE({ event: first.type, data: JSON.stringify(first) });
      for (;;) {
        while (queue.length > 0 && !closed) {
          const event = queue.shift()!;
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
          if (event.type === 'done') return;
          if (event.type === 'error' && event.error.code === 'interrupted') return;
        }
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
      }
    } finally {
      clearInterval(ping);
      unsubscribe();
    }
  });
}

export const chatRoutes = new Hono<AppEnv>();

chatRoutes.get('/:id/messages', (c) => {
  const { row } = viewProject(c);
  return c.json<MessagesResponse>({ messages: listMessages(row.id) });
});

chatRoutes.delete('/:id/messages', (c) => {
  const { row } = ownProject(c);
  if (isGenerating(row.id)) throw conflict('Stop the running generation first');
  clearMessages(row.id);
  return c.json<OkResponse>({ ok: true });
});

chatRoutes.post('/:id/chat', async (c) => {
  const { row, user } = editProject(c);
  chatLimiter.check(`chat:${user.id}`);
  const body = (await parseJson(c, ChatSchema)) as ChatRequest;
  const job = startChatJob({ project: row, user, request: body });
  return pipeJob(c, job, null);
});

chatRoutes.get('/:id/chat/active', (c) => {
  const { row } = editProject(c);
  const job = getActiveJob(row.id);
  if (!job) return c.body(null, 204);
  const snap = job.snapshot();
  return pipeJob(c, job, { type: 'snapshot', userMessage: snap.userMessage, assistantMessage: snap.assistantMessage });
});

chatRoutes.post('/:id/chat/stop', (c) => {
  const { row } = editProject(c);
  const job = getActiveJob(row.id);
  if (job) job.stop();
  return c.json<StopResponse>({ ok: true, stopped: Boolean(job) });
});
