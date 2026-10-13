import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, FlaskConical, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { ChatMessage, ChatRequest, PreviewError } from '@shared/types';
import { CreditsMeter } from '@/components/common/CreditsMeter';
import { ConnectAiDialog } from '@/features/settings/ConnectAiDialog';
import { useWorkspace } from '@/features/workspace/store';
import { useT } from '@/i18n';
import { useMessages, useModels, useProject, useRestoreVersion, useUsage, useVersions } from '@/lib/queries';
import { Skeleton } from '@/components/ui/skeleton';
import { Composer, type ComposerHandle } from './Composer';
import { AssistantMessage, UserMessage } from './messages';
import { ErrorCard, type ErrorActions } from './parts';
import { useChatSession } from './useChatSession';

const CRASH_WINDOW_MS = 12_000;
/** How long a detected crash waits before it is sent for an automatic fix. */
const AUTO_FIX_DELAY_MS = 1500;

export function ChatPanel(props: { projectId: string; readOnly: boolean }) {
  const { projectId, readOnly } = props;
  const t = useT('chat');
  const session = useChatSession(projectId, readOnly);
  const messagesQuery = useMessages(projectId);
  const versionsQuery = useVersions(projectId, { enabled: !readOnly });
  const usage = useUsage({ enabled: !readOnly });
  const models = useModels();
  const project = useProject(projectId);
  const restore = useRestoreVersion(projectId);
  const [connectOpen, setConnectOpen] = useState(false);
  const [undone, setUndone] = useState<{ messageId: string; versionId: string } | null>(null);
  const composerRef = useRef<ComposerHandle>(null);

  // ----- message list ------------------------------------------------------------------------------------
  const messages = useMemo(() => {
    const history = messagesQuery.data ?? [];
    const live = session.live;
    if (!live) return history;
    const hidden = new Set([live.user?.id, live.assistant?.id].filter(Boolean) as string[]);
    const list = history.filter((m) => !hidden.has(m.id));
    if (live.user) list.push(live.user);
    if (live.assistant) list.push(live.assistant);
    return list;
    // session.live is a mutable snapshot that changes identity on every applied event
  }, [messagesQuery.data, session.live, session.live?.assistant, session.live?.user]);

  const lastAssistant = useMemo(() => [...messages].reverse().find((m) => m.role === 'assistant') ?? null, [messages]);
  const lastUserPrompt = useMemo(() => [...messages].reverse().find((m) => m.role === 'user')?.content ?? null, [messages]);
  const lastVersioned = useMemo(
    () => [...messages].reverse().find((m) => m.role === 'assistant' && m.versionId !== null && m.status !== 'streaming') ?? null,
    [messages],
  );

  // ----- sending helpers -----------------------------------------------------------------------------------
  const autoFixBudget = useRef(1);
  const send = useCallback(
    (request: ChatRequest) => {
      setUndone(null);
      // Every request of the user's own earns one automatic repair of a crash it may cause.
      if (request.intent !== 'fix') autoFixBudget.current = 1;
      session.send(request);
    },
    [session],
  );

  const errorActions: ErrorActions = useMemo(
    () => ({
      onRetry: () => {
        if (session.failure) session.retry();
        else if (lastUserPrompt) send({ message: lastUserPrompt });
      },
      onContinue: () => send({ message: t('errors.continueRequest'), intent: 'continue' }),
      onFixBuild: () => {
        const build = useWorkspace.getState().build;
        const runtimeErrors: PreviewError[] = (build?.errors ?? []).slice(0, 10).map((e) => ({
          kind: 'build',
          message: e.message,
          stack: e.lineText,
          source: e.file,
          line: e.line,
          column: e.column,
          timestamp: Date.now(),
        }));
        send({ message: t('errors.fixBuildRequest'), intent: 'fix', runtimeErrors });
      },
      onConnectKey: () => setConnectOpen(true),
    }),
    [lastUserPrompt, send, session, t],
  );

  // ----- undo / redo of the latest AI version ---------------------------------------------------------------
  const applyRestore = useCallback(
    async (versionId: string) => {
      const { files } = await restore.mutateAsync(versionId);
      const store = useWorkspace.getState();
      store.setFiles(files);
      store.setBuild(null);
      store.reloadPreview();
    },
    [restore],
  );

  const undoControls = useMemo(() => {
    if (readOnly || session.generating || !lastVersioned || lastVersioned.versionNumber === null) return undefined;
    const versions = versionsQuery.data ?? [];
    const previous = versions.filter((v) => v.number < lastVersioned.versionNumber!).sort((a, b) => b.number - a.number)[0];
    if (!previous || !lastVersioned.versionId) return undefined;
    const isUndone = undone?.messageId === lastVersioned.id;
    return {
      state: isUndone ? ('can-redo' as const) : ('can-undo' as const),
      busy: restore.isPending,
      onUndo: () => {
        void applyRestore(previous.id)
          .then(() => {
            setUndone({ messageId: lastVersioned.id, versionId: lastVersioned.versionId! });
            toast.success(t('message.undone'), {
              action: {
                label: t('message.redo'),
                onClick: () => void applyRestore(lastVersioned.versionId!).then(() => setUndone(null)),
              },
            });
          })
          .catch(() => toast.error(t('errors.internal')));
      },
      onRedo: () => {
        void applyRestore(lastVersioned.versionId!)
          .then(() => {
            setUndone(null);
            toast.success(t('message.redone'));
          })
          .catch(() => toast.error(t('errors.internal')));
      },
    };
  }, [applyRestore, lastVersioned, readOnly, restore.isPending, session.generating, t, undone, versionsQuery.data]);

  // ----- runtime crash right after a change ---------------------------------------------------------------------
  const previewErrors = useWorkspace((s) => s.previewErrors);
  const crash = useMemo(() => {
    const done = session.lastDone;
    if (!done || session.generating) return null;
    return (
      previewErrors.find(
        (e) => (e.kind === 'runtime' || e.kind === 'promise') && e.timestamp >= done.at - 500 && e.timestamp <= done.at + CRASH_WINDOW_MS,
      ) ?? null
    );
  }, [previewErrors, session.generating, session.lastDone]);

  const fixCrash = useCallback(() => {
    const errors = useWorkspace.getState().previewErrors.filter((e) => e.kind !== 'console').slice(0, 10);
    send({ message: t('crash.fixRequest'), intent: 'fix', runtimeErrors: errors });
  }, [send, t]);

  // A build can succeed and the app still die on its first render (a hook outside its provider, a bad prop).
  // The first time that happens after a turn, ask for the fix straight away instead of leaving a blank preview;
  // if the repair crashes too, the card with the manual button stays.
  useEffect(() => {
    if (!crash || readOnly || session.generating || autoFixBudget.current <= 0) return;
    // Let the rest of the crash's errors arrive so the request carries all of them.
    const timer = window.setTimeout(() => {
      if (autoFixBudget.current <= 0) return;
      autoFixBudget.current -= 1;
      fixCrash();
    }, AUTO_FIX_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [crash, fixCrash, readOnly, session.generating]);

  // ----- scrolling --------------------------------------------------------------------------------------------------
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedRef.current = distance < 80;
    if (pinnedRef.current) setShowJump(false);
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (pinnedRef.current) el.scrollTop = el.scrollHeight;
    else if (session.generating) setShowJump(true);
  });

  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setShowJump(false);
  }, []);

  // ----- "done" notification in the tab title when the user is elsewhere ------------------------------------------------
  const projectName = project.data?.project.name;
  useEffect(() => {
    if (!session.lastDone || !document.hidden || !projectName) return;
    const original = document.title;
    document.title = `✓ ${projectName} — Yasa`;
    const restoreTitle = () => {
      document.title = original;
      window.removeEventListener('focus', restoreTitle);
    };
    window.addEventListener('focus', restoreTitle);
    return restoreTitle;
  }, [session.lastDone, projectName]);

  const isDemo = Boolean(models.data?.defaultModel?.startsWith('mock:')) && !readOnly;
  const empty = !messagesQuery.isLoading && messages.length === 0;
  const resetsAt = usage.data?.resetsAt;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={onScroll} className="scrollbar-thin h-full overflow-y-auto px-3 py-4">
          {messagesQuery.isLoading ? (
            <div className="space-y-4">
              <Skeleton className="ml-auto h-10 w-2/3 rounded-2xl" />
              <Skeleton className="h-24 w-full rounded-2xl" />
            </div>
          ) : empty ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <div className="grid size-11 place-items-center rounded-2xl bg-brand-gradient text-brand-foreground shadow-brand">
                <Sparkles className="size-5" />
              </div>
              <h2 className="mt-4 text-base font-semibold tracking-tight">{t('empty.title')}</h2>
              <p className="mt-1.5 max-w-xs text-[13px] text-muted-foreground">{t('empty.subtitle')}</p>
              {!readOnly ? (
                <div className="mt-5 flex flex-wrap justify-center gap-1.5">
                  {[t('empty.chipLanding'), t('empty.chipTodo'), t('empty.chipDashboard'), t('empty.chipPortfolio')].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => composerRef.current?.setText(chip)}
                      className="rounded-full border border-border px-3 py-1.5 text-[12.5px] text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-5">
              {messages.map((message: ChatMessage) => {
                if (message.role === 'user') {
                  return <UserMessage key={message.id} message={message} pending={message.id.startsWith('pending-')} />;
                }
                const live = session.live?.assistant?.id === message.id;
                const isLast = lastAssistant?.id === message.id;
                return (
                  <AssistantMessage
                    key={message.id}
                    message={message}
                    live={live}
                    isLast={isLast}
                    lines={live ? session.writtenLines : {}}
                    resetsAt={resetsAt}
                    errorActions={readOnly ? undefined : errorActions}
                    undo={lastVersioned?.id === message.id ? undoControls : undefined}
                    crash={isLast && session.lastDone?.messageId === message.id ? crash : null}
                    onFixCrash={fixCrash}
                    onSuggestion={readOnly ? undefined : (text) => composerRef.current?.setText(text)}
                    onAnswer={readOnly || session.generating ? undefined : (text) => send({ message: text })}
                    onBuildThis={readOnly ? undefined : () => send({ mode: 'build', message: t('message.implementPlan') })}
                  />
                );
              })}
              {session.live && !session.live.assistant ? (
                <AssistantMessage
                  message={{ ...session.live.user!, id: 'pending-assistant', role: 'assistant', content: '', parts: [], attachments: [], selectedElement: null, status: 'streaming' }}
                  live
                  isLast
                  lines={{}}
                  resetsAt={resetsAt}
                />
              ) : null}
              {session.failure ? (
                <ErrorCard code={session.failure.code} fallback={session.failure.message} resetsAt={resetsAt} actions={errorActions} />
              ) : null}
            </div>
          )}
        </div>
        {showJump ? (
          <button
            type="button"
            onClick={jumpToBottom}
            className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-[12px] font-medium shadow-md transition hover:bg-muted"
          >
            <ArrowDown className="size-3.5" />
            {t('message.newActivity')}
          </button>
        ) : null}
      </div>

      {readOnly ? (
        <p className="border-t border-border px-4 py-3 text-center text-[13px] text-muted-foreground">{t('composer.readOnly')}</p>
      ) : (
        <>
          <CreditsMeter compact className="mx-4 mb-1.5" />
          {isDemo ? (
            <div className="mx-3 mb-2 flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/5 px-3 py-2 text-[12.5px]">
              <FlaskConical className="size-4 shrink-0 text-warning" />
              <span className="min-w-0 flex-1">{t('demo.banner')}</span>
              <button type="button" onClick={() => setConnectOpen(true)} className="shrink-0 font-medium underline underline-offset-4 hover:no-underline">
                {t('demo.connect')}
              </button>
            </div>
          ) : null}
          <Composer
            ref={composerRef}
            projectId={projectId}
            generating={session.generating}
            remaining={usage.data?.remainingToday ?? null}
            lastPrompt={lastUserPrompt}
            onSend={send}
            onStop={session.stop}
            onAddKey={() => setConnectOpen(true)}
          />
        </>
      )}
      <ConnectAiDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </div>
  );
}
