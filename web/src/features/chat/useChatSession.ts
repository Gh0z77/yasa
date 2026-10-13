// Owns the live chat turn of a project: sending, attaching to a running job and applying SSE events.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authHeaders } from '@/lib/auth';
import type { ChatEvent, ChatMessage, ChatRequest, MessagePart } from '@shared/types';
import { useWorkspace } from '@/features/workspace/store';
import { getLocale } from '@/i18n';
import { api, isAbortError, isApiError } from '@/lib/api';
import { invalidateAfterChat, patchProjectInCache, qk } from '@/lib/queries';
import { storedModel } from './prefs';

export interface LiveTurn {
  user: ChatMessage | null;
  assistant: ChatMessage | null;
}

export interface RequestFailure {
  code: string;
  message: string;
  request: ChatRequest;
}

export interface ChatSession {
  live: LiveTurn | null;
  generating: boolean;
  /** HTTP-level failure of the last send (before any stream started). */
  failure: RequestFailure | null;
  /** Lines written so far per action id (live "Writing X · 84 lines"). */
  writtenLines: Record<string, number>;
  /** Id + time of the last finished assistant message (used to attribute runtime crashes). */
  lastDone: { messageId: string; at: number } | null;
  send(request: ChatRequest): void;
  stop(): void;
  retry(): void;
  clearFailure(): void;
}

/** Idle time after which the client double-checks that the job is still alive (the server pings every 15 s). */
const WATCHDOG_IDLE_MS = 30_000;

function optimisticUser(projectId: string, request: ChatRequest): ChatMessage {
  return {
    id: `pending-${Date.now()}`,
    projectId,
    role: 'user',
    content: request.message,
    parts: [],
    attachments: [],
    selectedElement: request.selectedElement ?? null,
    mode: request.mode ?? 'build',
    status: 'done',
    model: null,
    versionId: null,
    versionNumber: null,
    usage: null,
    durationMs: null,
    createdAt: new Date().toISOString(),
  };
}

function countNewlines(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

export function useChatSession(projectId: string, readOnly: boolean): ChatSession {
  const qc = useQueryClient();
  const liveRef = useRef<LiveTurn | null>(null);
  const linesRef = useRef<Record<string, number>>({});
  const runRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const generatingRef = useRef(false);
  const filesChangedRef = useRef(false);
  const reloadedRef = useRef(false);
  const lastRequestRef = useRef<ChatRequest | null>(null);
  const frameRef = useRef(0);
  const lastEventRef = useRef(Date.now());
  const [, render] = useReducer((x: number) => x + 1, 0);
  const [generating, setGeneratingState] = useState(false);
  const [failure, setFailure] = useState<RequestFailure | null>(null);
  const [lastDone, setLastDone] = useState<{ messageId: string; at: number } | null>(null);

  // Streaming deltas arrive much faster than React needs to paint: coalesce to one render per frame.
  const schedule = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      render();
    });
  }, []);

  const setGenerating = useCallback((value: boolean) => {
    generatingRef.current = value;
    setGeneratingState(value);
    useWorkspace.getState().setGenerating(value);
    if (!value) useWorkspace.getState().setLiveFile(null);
  }, []);

  const finish = useCallback(
    (final: ChatMessage | null) => {
      const live = liveRef.current;
      const store = useWorkspace.getState();
      if (final) {
        qc.setQueryData<ChatMessage[]>(qk.messages(projectId), (old) => {
          const list = (old ?? []).filter((m) => m.id !== final.id && m.id !== live?.user?.id);
          if (live?.user && !live.user.id.startsWith('pending-')) list.push(live.user);
          list.push(final);
          return list;
        });
        setLastDone({ messageId: final.id, at: Date.now() });
      }
      liveRef.current = null;
      linesRef.current = {};
      setGenerating(false);
      if (filesChangedRef.current && !reloadedRef.current) store.reloadPreview();
      invalidateAfterChat(qc, projectId);
      render();
    },
    [projectId, qc, setGenerating],
  );

  const makeHandler = useCallback(
    (run: number) => (event: ChatEvent) => {
      if (run !== runRef.current) return; // a newer session took over
      lastEventRef.current = Date.now();
      const store = useWorkspace.getState();
      const live = liveRef.current;
      switch (event.type) {
        case 'start':
        case 'snapshot':
          liveRef.current = { user: event.userMessage, assistant: { ...event.assistantMessage, parts: [...event.assistantMessage.parts] } };
          if (!generatingRef.current) setGenerating(true);
          break;
        case 'part_start': {
          if (!live?.assistant) break;
          const parts = live.assistant.parts.slice();
          parts[event.index] = event.part;
          live.assistant = { ...live.assistant, parts };
          if (event.part.type === 'action' && event.part.kind === 'write' && event.part.path) {
            store.setLiveFile({ path: event.part.path, content: '' });
          }
          break;
        }
        case 'part_delta': {
          if (!live?.assistant) break;
          const part = live.assistant.parts[event.index];
          if (!part) break;
          if (part.type === 'text' || part.type === 'thinking') {
            const parts = live.assistant.parts.slice();
            parts[event.index] = { ...part, text: part.text + event.delta } as MessagePart;
            live.assistant = { ...live.assistant, parts };
          } else if (part.type === 'action') {
            if (part.path) store.appendLiveFile(part.path, event.delta);
            linesRef.current = { ...linesRef.current, [part.id]: (linesRef.current[part.id] ?? 0) + countNewlines(event.delta) };
          }
          break;
        }
        case 'part_update': {
          if (!live?.assistant) break;
          const parts = live.assistant.parts.slice();
          parts[event.index] = event.part;
          live.assistant = { ...live.assistant, parts };
          if (event.part.type === 'action' && event.part.status !== 'pending' && store.liveFile?.path === event.part.path) {
            store.setLiveFile(null);
          }
          break;
        }
        case 'files_changed':
          filesChangedRef.current = true;
          reloadedRef.current = false;
          store.applyFileChanges(event.changes);
          break;
        case 'build':
          store.setBuild(event.summary);
          if (event.summary.ok) {
            store.reloadPreview();
            reloadedRef.current = true;
          }
          break;
        case 'project_updated':
          patchProjectInCache(qc, projectId, event.project);
          break;
        case 'done':
          finish(event.message);
          return;
        case 'error':
          // A terminal `interrupted` has no `done` after it; other errors are followed by `done`.
          if (event.error.code === 'interrupted') {
            finish(null);
            return;
          }
          break;
        default:
          break;
      }
      schedule();
    },
    [finish, projectId, qc, schedule, setGenerating],
  );

  const send = useCallback(
    (request: ChatRequest) => {
      if (readOnly) return;
      if (generatingRef.current) {
        useWorkspace.getState().queueChat(request);
        return;
      }
      const run = ++runRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      lastRequestRef.current = request;
      filesChangedRef.current = false;
      reloadedRef.current = false;
      linesRef.current = {};
      setFailure(null);
      liveRef.current = { user: optimisticUser(projectId, request), assistant: null };
      setGenerating(true);
      render();

      api.chat
        // Requests that do not come from the composer (retry, Fix with AI) still use the model picked there.
        .stream(projectId, { ...request, model: request.model ?? storedModel() ?? undefined, locale: getLocale() }, makeHandler(run), controller.signal)
        .then(() => {
          // Stream closed without a terminal event (connection dropped): fall back to the stored state.
          if (run === runRef.current && generatingRef.current && !controller.signal.aborted) finish(null);
        })
        .catch((err: unknown) => {
          if (run !== runRef.current || isAbortError(err)) return;
          const started = Boolean(liveRef.current?.assistant);
          if (started) {
            // The connection broke mid-stream; the job may still be running on the server.
            finish(null);
            return;
          }
          liveRef.current = null;
          setGenerating(false);
          setFailure({
            code: isApiError(err) ? (err.chatCode ?? err.code) : 'network',
            message: err instanceof Error ? err.message : String(err),
            request,
          });
          render();
        });
    },
    [finish, makeHandler, projectId, readOnly, setGenerating],
  );

  // Attach to a generation that is already running (page reload, project created with a prompt).
  useEffect(() => {
    if (readOnly) {
      useWorkspace.getState().setGenerating(false);
      return;
    }
    const run = ++runRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    api.chat
      .attach(projectId, makeHandler(run), controller.signal)
      .then((attached) => {
        if (run !== runRef.current) return;
        if (!attached) setGenerating(false);
        else if (generatingRef.current) finish(null);
      })
      .catch((err: unknown) => {
        if (run !== runRef.current || isAbortError(err)) return;
        if (generatingRef.current) finish(null);
        else setGenerating(false);
      });
    return () => {
      controller.abort();
      runRef.current++;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, readOnly]);

  // Watchdog: a proxy can keep a dead stream open (e.g. the server restarted). When nothing has arrived for a
  // while, ask the server whether the job still exists and stop waiting if it does not.
  useEffect(() => {
    if (!generating || readOnly) return;
    lastEventRef.current = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - lastEventRef.current < WATCHDOG_IDLE_MS) return;
      lastEventRef.current = Date.now();
      const probe = new AbortController();
      authHeaders()
        .then((headers) =>
          fetch(`/api/projects/${encodeURIComponent(projectId)}/chat/active`, { signal: probe.signal, credentials: 'same-origin', headers }),
        )
        .then((res) => {
          const gone = res.status === 204;
          probe.abort(); // only the status matters
          if (gone && generatingRef.current) {
            abortRef.current?.abort();
            runRef.current++;
            finish(null);
          }
        })
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [finish, generating, projectId, readOnly]);

  // Messages queued by other panels ("Fix with AI") or typed while a job was running.
  const queued = useWorkspace((s) => s.queuedChat);
  useEffect(() => {
    if (!queued || generating || readOnly) return;
    const next = useWorkspace.getState().consumeQueuedChat();
    if (!next) return;
    const { id: _id, ...request } = next;
    send(request);
  }, [queued, generating, readOnly, send]);

  const stop = useCallback(() => {
    void api.chat.stop(projectId).catch(() => undefined);
  }, [projectId]);

  const retry = useCallback(() => {
    const request = failure?.request ?? lastRequestRef.current;
    if (request) send(request);
  }, [failure, send]);

  return {
    live: liveRef.current,
    generating,
    failure,
    writtenLines: linesRef.current,
    lastDone,
    send,
    stop,
    retry,
    clearFailure: useCallback(() => setFailure(null), []),
  };
}
