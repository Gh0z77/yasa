import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Check,
  ExternalLink,
  LoaderCircle,
  Monitor,
  MousePointerClick,
  RotateCw,
  Smartphone,
  Tablet,
  Terminal,
  TriangleAlert,
  WandSparkles,
  X,
} from 'lucide-react';
import type { ParentToPreviewMessage, PreviewError, PreviewToParentMessage } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/tooltip';
import { useWorkspace, type Device } from '@/features/workspace/store';
import { useT } from '@/i18n';
import { useProject } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { ConsoleDrawer } from './ConsoleDrawer';

const DEVICE_SIZE: Record<Exclude<Device, 'desktop'>, { width: number; height: number }> = {
  tablet: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844 },
};

const DEVICES: Array<{ id: Device; icon: typeof Monitor }> = [
  { id: 'desktop', icon: Monitor },
  { id: 'tablet', icon: Tablet },
  { id: 'mobile', icon: Smartphone },
];

function normalizeRoute(input: string): string {
  const value = input.trim();
  if (!value) return '/';
  return value.startsWith('/') ? value : `/${value}`;
}

export function PreviewPanel(props: { projectId: string; previewUrl: string; readOnly: boolean }) {
  const { projectId, previewUrl, readOnly } = props;
  const t = useT('preview');
  const tc = useT('common');
  const project = useProject(projectId);

  const device = useWorkspace((s) => s.device);
  const nonce = useWorkspace((s) => s.previewNonce);
  const previewPath = useWorkspace((s) => s.previewPath);
  const loading = useWorkspace((s) => s.previewLoading);
  const build = useWorkspace((s) => s.build);
  const previewErrors = useWorkspace((s) => s.previewErrors);
  const consoleEntries = useWorkspace((s) => s.consoleEntries);
  const selectMode = useWorkspace((s) => s.selectMode);
  const generating = useWorkspace((s) => s.generating);
  const liveFile = useWorkspace((s) => s.liveFile);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [routeDraft, setRouteDraft] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(0);
  const [slow, setSlow] = useState(false);
  const [stage, setStage] = useState({ width: 0, height: 0 });

  const origin = useMemo(() => {
    try {
      return new URL(previewUrl).origin;
    } catch {
      return '';
    }
  }, [previewUrl]);

  const post = useCallback(
    (message: ParentToPreviewMessage) => {
      if (origin) iframeRef.current?.contentWindow?.postMessage(message, origin);
    },
    [origin],
  );

  // ----- bridge: iframe → builder ---------------------------------------------------------------------------
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as PreviewToParentMessage | null;
      if (!data || typeof data !== 'object' || data.source !== 'yasa-preview') return;
      const store = useWorkspace.getState();
      switch (data.type) {
        case 'ready':
          store.setPreviewLoading(false);
          store.setPreviewPath(data.path || '/');
          if (store.selectMode) post({ source: 'yasa-parent', type: 'select-mode', enabled: true });
          break;
        case 'navigate':
          store.setPreviewPath(data.path || '/');
          break;
        case 'console':
          store.addConsoleEntry(data.entry);
          break;
        case 'error':
          store.addPreviewError(data.error);
          break;
        case 'element-selected':
          store.setSelectedElement(data.element);
          store.setSelectMode(false);
          break;
        case 'select-mode-exited':
          store.setSelectMode(false);
          break;
        default:
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [origin, post]);

  // ----- builder → iframe ------------------------------------------------------------------------------------
  useEffect(() => {
    post({ source: 'yasa-parent', type: 'select-mode', enabled: selectMode });
  }, [selectMode, post]);

  useEffect(() => {
    if (!selectMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useWorkspace.getState().setSelectMode(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectMode]);

  // ----- loading state per reload ---------------------------------------------------------------------------------
  useEffect(() => {
    useWorkspace.getState().setPreviewLoading(true);
    setSlow(false);
    setDismissed(0);
    const timer = window.setTimeout(() => setSlow(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [nonce, previewUrl]);

  // ----- device frame scaling ----------------------------------------------------------------------------------------
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setStage({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const frame = device === 'desktop' ? null : DEVICE_SIZE[device];
  const scale = frame && stage.width > 0 ? Math.min(1, (stage.width - 32) / frame.width, (stage.height - 32) / frame.height) : 1;

  // ----- first generation overlay ----------------------------------------------------------------------------------------
  const isFirstRun = generating && (project.data?.project.currentVersionNumber ?? 1) <= 1;
  const writtenRef = useRef(new Set<string>());
  const [written, setWritten] = useState(0);
  useEffect(() => {
    if (!generating) {
      writtenRef.current = new Set();
      setWritten(0);
      return;
    }
    if (liveFile && !writtenRef.current.has(liveFile.path)) {
      writtenRef.current.add(liveFile.path);
      setWritten(writtenRef.current.size);
    }
  }, [generating, liveFile]);
  const runStage = !isFirstRun ? -1 : written === 0 ? 0 : liveFile ? 1 : build ? (build.ok ? 3 : 2) : 2;

  const [tip, setTip] = useState(0);
  useEffect(() => {
    if (!isFirstRun) return;
    const timer = window.setInterval(() => setTip((n) => (n + 1) % 3), 6000);
    return () => window.clearInterval(timer);
  }, [isFirstRun]);

  // ----- errors ------------------------------------------------------------------------------------------------------------
  const { banner, resourceCount, errorCount } = useMemo(() => {
    const serious = previewErrors.filter((e) => e.kind === 'runtime' || e.kind === 'promise');
    const resources = previewErrors.filter((e) => e.kind === 'resource');
    let item: { title: string; message: string; where: string | null } | null = null;
    if (build && !build.ok && build.errors.length > 0) {
      const e = build.errors[0];
      item = { title: t('errors.build'), message: e.message, where: e.file ? `${e.file}${e.line ? `:${e.line}` : ''}` : null };
    } else if (serious.length > 0) {
      item = { title: t('errors.runtime'), message: serious[0].message, where: null };
    }
    const count = (build && !build.ok ? build.errors.length : 0) + serious.length;
    return { banner: item, resourceCount: resources.length, errorCount: count };
  }, [build, previewErrors, t]);

  const totalIssues = errorCount + resourceCount;
  const showBanner = !generating && totalIssues > 0 && dismissed !== totalIssues;

  const fixWithAi = useCallback(() => {
    const store = useWorkspace.getState();
    const fromBuild: PreviewError[] = (store.build && !store.build.ok ? store.build.errors : []).map((e) => ({
      kind: 'build',
      message: e.message,
      stack: e.lineText,
      source: e.file,
      line: e.line,
      column: e.column,
      timestamp: Date.now(),
    }));
    const fromRuntime = store.previewErrors.filter((e) => e.kind !== 'console' && e.kind !== 'build');
    store.queueChat({ message: t('errors.fixRequest'), intent: 'fix', runtimeErrors: [...fromBuild, ...fromRuntime].slice(0, 10) });
    setDismissed(totalIssues);
  }, [t, totalIssues]);

  const consoleErrors = consoleEntries.filter((e) => e.level === 'error').length;

  const submitRoute = (e: FormEvent) => {
    e.preventDefault();
    if (routeDraft === null) return;
    const path = normalizeRoute(routeDraft);
    post({ source: 'yasa-parent', type: 'navigate', path });
    useWorkspace.getState().setPreviewPath(path);
    setRouteDraft(null);
  };

  const openUrl = `${previewUrl.replace(/\/$/, '')}${previewPath.startsWith('/') ? previewPath : `/${previewPath}`}`;

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/30">
      {/* toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border bg-background px-2">
        <div className="flex items-center rounded-lg bg-muted p-0.5" role="group" aria-label={t('toolbar.frameTitle')}>
          {DEVICES.map(({ id, icon: Icon }) => (
            <Hint key={id} label={t(`toolbar.${id}`)}>
              <button
                type="button"
                aria-pressed={device === id}
                aria-label={t(`toolbar.${id}`)}
                onClick={() => useWorkspace.getState().setDevice(id)}
                className={cn('rounded-md p-1.5 transition', device === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              >
                <Icon className="size-3.5" />
              </button>
            </Hint>
          ))}
        </div>

        <form onSubmit={submitRoute} className="min-w-0 flex-1">
          <input
            value={routeDraft ?? previewPath}
            onChange={(e) => setRouteDraft(e.target.value)}
            onBlur={() => setRouteDraft(null)}
            aria-label={t('toolbar.route')}
            spellCheck={false}
            className="h-7 w-full min-w-0 rounded-md border border-transparent bg-muted px-2.5 font-mono text-[12px] text-muted-foreground outline-none transition focus:border-border focus:bg-background focus:text-foreground"
          />
        </form>

        {selectMode ? (
          <span className="hidden items-center gap-1.5 rounded-full bg-info/10 px-2.5 py-1 text-[11.5px] font-medium text-info sm:inline-flex">
            <MousePointerClick className="size-3 animate-pulse" />
            {t('toolbar.selecting')} · Esc
          </span>
        ) : null}

        <Hint label={t('toolbar.reload')}>
          <button type="button" onClick={() => useWorkspace.getState().reloadPreview()} aria-label={t('toolbar.reload')} className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground">
            <RotateCw className={cn('size-3.5', loading && 'animate-spin')} />
          </button>
        </Hint>
        <Hint label={t('toolbar.openNewTab')}>
          <a href={openUrl} target="_blank" rel="noreferrer" aria-label={t('toolbar.openNewTab')} className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground">
            <ExternalLink className="size-3.5" />
          </a>
        </Hint>
        <Hint label={t('toolbar.console')}>
          <button
            type="button"
            aria-pressed={consoleOpen}
            aria-label={t('toolbar.console')}
            onClick={() => setConsoleOpen((v) => !v)}
            className={cn('relative rounded-md p-1.5 transition', consoleOpen ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
          >
            <Terminal className="size-3.5" />
            {consoleErrors > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 grid min-w-3.5 place-items-center rounded-full bg-destructive px-1 text-[9px] font-semibold leading-[14px] text-white">
                {consoleErrors > 99 ? '99+' : consoleErrors}
              </span>
            ) : null}
          </button>
        </Hint>
      </div>

      {generating && !isFirstRun ? <div className="h-0.5 w-full shrink-0 animate-shimmer bg-brand-gradient" aria-label={t('updating')} /> : null}

      {/* stage */}
      <div ref={stageRef} className={cn('relative min-h-0 flex-1 overflow-hidden', frame && 'bg-grid')}>
        <div
          className={cn(frame ? 'absolute left-1/2 top-1/2 overflow-hidden rounded-[28px] border-[6px] border-foreground/85 bg-background shadow-2xl' : 'absolute inset-0 bg-background')}
          style={frame ? { width: frame.width, height: frame.height, transform: `translate(-50%, -50%) scale(${scale})` } : undefined}
        >
          <iframe
            key={`${previewUrl}#${nonce}`}
            ref={iframeRef}
            src={previewUrl}
            title={t('toolbar.frameTitle')}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
            allow="clipboard-write"
            className="size-full border-0 bg-white"
          />
        </div>

        {loading && !isFirstRun ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-background/70 backdrop-blur-[1px]">
            <div className="pointer-events-auto max-w-xs text-center">
              <LoaderCircle className="mx-auto size-5 animate-spin text-muted-foreground" />
              <p className="mt-3 text-[13px] font-medium">{slow ? t('loading.slow') : t('loading.title')}</p>
              {slow ? (
                <>
                  <p className="mt-1 text-[12px] text-muted-foreground">{t('loading.slowHint')}</p>
                  <a href={openUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[12px] font-medium underline underline-offset-4">
                    {t('loading.openDirect')}
                  </a>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {isFirstRun ? (
          <div className="absolute inset-0 grid place-items-center bg-background">
            <div className="w-full max-w-sm px-6 text-center">
              <div className="mx-auto size-14 animate-pulse rounded-2xl bg-brand-gradient shadow-brand" />
              <h3 className="mt-5 text-base font-semibold tracking-tight">{t('firstRun.title')}</h3>
              <ol className="mx-auto mt-5 w-fit space-y-2.5 text-left text-[13px]">
                {[t('firstRun.thinking'), written > 0 ? `${t('firstRun.writing')} (${written})` : t('firstRun.writing'), t('firstRun.building'), t('firstRun.ready')].map((label, i) => (
                  <li key={i} className={cn('flex items-center gap-2.5', i > runStage && 'text-muted-foreground/60')}>
                    {i < runStage ? (
                      <Check className="size-4 text-success" />
                    ) : i === runStage ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <span className="grid size-4 place-items-center"><span className="size-1.5 rounded-full bg-current" /></span>
                    )}
                    <span className={cn(i === runStage && 'font-medium text-foreground')}>{label}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-6 min-h-10 text-[12.5px] text-muted-foreground">{[t('firstRun.tipSelect'), t('firstRun.tipChat'), t('firstRun.tipHistory')][tip]}</p>
            </div>
          </div>
        ) : null}

        {showBanner ? (
          <div className="absolute inset-x-3 bottom-3 mx-auto max-w-xl rounded-xl border border-destructive/30 bg-background p-3 shadow-lg" role="alert">
            <div className="flex items-start gap-2.5">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div className="min-w-0 flex-1 text-[13px]">
                {banner ? (
                  <>
                    <p className="font-medium">
                      {banner.title}
                      {errorCount > 1 ? <span className="ml-1.5 font-normal text-muted-foreground">{t('errors.more', { count: errorCount - 1 })}</span> : null}
                    </p>
                    <p className="mt-0.5 line-clamp-3 break-words font-mono text-[11.5px] text-muted-foreground">
                      {banner.where ? <span className="text-foreground">{banner.where} </span> : null}
                      {banner.message}
                    </p>
                  </>
                ) : null}
                {resourceCount > 0 ? <p className={cn('text-muted-foreground', banner && 'mt-1 text-[12px]')}>{t('errors.resources', { count: resourceCount })}</p> : null}
              </div>
              <button type="button" aria-label={t('errors.dismiss')} onClick={() => setDismissed(totalIssues)} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>
            {!readOnly ? (
              <div className="mt-2.5 flex justify-end">
                <Button size="sm" variant="gradient" onClick={fixWithAi}>
                  <WandSparkles className="size-3.5" />
                  {tc('terms.fixWithAi')}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {consoleOpen ? <ConsoleDrawer onClose={() => setConsoleOpen(false)} /> : null}
    </div>
  );
}
