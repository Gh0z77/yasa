// Renderers for the non-text parts of an assistant message.
import { useEffect, useState, type ReactNode } from 'react';
import {
  Brain,
  ChevronRight,
  CircleCheck,
  CircleX,
  FilePen,
  FilePlus,
  FileX,
  Hammer,
  LoaderCircle,
  Package,
  Replace,
  TriangleAlert, Image as ImageIcon } from 'lucide-react';
import type { ActionPart, BuildPart, ChatErrorCode, ErrorPart, ThinkingPart } from '@shared/types';
import { LIMITS } from '@shared/constants';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/features/workspace/store';
import { useLocale, useT } from '@/i18n';
import { formatDuration, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Markdown } from './Markdown';

// ---------------------------------------------------------------------------------- thinking
export function ThinkingBlock({ part, live }: { part: ThinkingPart; live: boolean }) {
  const t = useT('chat');
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const running = live && part.durationMs === null;

  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Date.now() - started), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const label = running
    ? `${t('message.thinking')}${elapsed >= 2000 ? ` ${formatDuration(elapsed, locale)}` : ''}`
    : t('message.thoughtFor', { time: formatDuration(Math.max(part.durationMs ?? 0, 1000), locale) });

  return (
    <div className="text-[13px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md py-0.5 text-muted-foreground transition hover:text-foreground"
      >
        <Brain className={cn('size-3.5', running && 'animate-pulse text-foreground')} />
        <span className={cn(running && 'bg-shimmer bg-clip-text')}>{label}</span>
        {part.text.trim() ? <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} /> : null}
      </button>
      {open && part.text.trim() ? (
        <div className="mt-1.5 border-l-2 border-border pl-3">
          <Markdown text={part.text} className="text-[13px] text-muted-foreground" />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------- actions
const ACTION_ICON = {
  write: FilePlus,
  edit: FilePen,
  delete: FileX,
  rename: Replace,
  dependency: Package,
  image: ImageIcon,
} as const;

function ActionRow({ part, lines }: { part: ActionPart; lines: number | undefined }) {
  const t = useT('chat');
  const Icon = ACTION_ICON[part.kind];
  const label = part.kind === 'dependency' ? `${part.dependency?.name ?? ''}${part.dependency?.version ? `@${part.dependency.version}` : ''}` : (part.path ?? '');
  const canOpen = part.status === 'done' && part.kind !== 'delete' && part.kind !== 'dependency' && Boolean(part.path);
  const open = () => {
    if (!canOpen || !part.path) return;
    const store = useWorkspace.getState();
    store.openFile(part.path);
    store.setView('code');
  };
  const name = label.split('/').pop() ?? label;
  const dir = label.includes('/') ? label.slice(0, label.lastIndexOf('/') + 1) : '';

  return (
    <li>
      <button
        type="button"
        onClick={open}
        disabled={!canOpen}
        title={canOpen ? t('actions.openFile') : (part.error ?? label)}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-[13px]',
          canOpen ? 'hover:bg-muted' : 'cursor-default',
        )}
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
          <span className="text-muted-foreground">{dir}</span>
          <span className="text-foreground">{name}</span>
        </span>
        {part.status === 'pending' ? (
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            {lines ? t('actions.lines', { count: lines }) : null}
            <LoaderCircle className="size-3.5 animate-spin" />
          </span>
        ) : part.status === 'error' ? (
          <CircleX className="size-3.5 shrink-0 text-destructive" />
        ) : (
          <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px]">
            {part.linesAdded ? <span className="text-success">+{part.linesAdded}</span> : null}
            {part.linesRemoved ? <span className="text-destructive">−{part.linesRemoved}</span> : null}
            <CircleCheck className="size-3.5 text-success" />
          </span>
        )}
      </button>
      {part.status === 'error' && part.error ? (
        <p className="break-words px-2 pb-1 pl-7 text-[11.5px] text-destructive/90">{part.error}</p>
      ) : null}
    </li>
  );
}

export function ActionGroup({ parts, lines, live }: { parts: ActionPart[]; lines: Record<string, number>; live: boolean }) {
  const t = useT('chat');
  const tc = useT('common');
  const pending = parts.some((p) => p.status === 'pending');
  const [open, setOpen] = useState(true);
  const files = new Set(parts.map((p) => p.path ?? p.dependency?.name ?? '')).size;
  const current = pending ? parts.find((p) => p.status === 'pending') : undefined;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium hover:bg-muted/50"
      >
        {pending && live ? <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" /> : <FilePen className="size-4 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate">
          {pending && live && current
            ? `${t('actions.writing')} ${(current.path ?? current.dependency?.name ?? '').split('/').pop()}`
            : t('actions.summary', { files: tc('count.files', { count: files }) })}
        </span>
        <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
      </button>
      {open ? (
        <ul className="border-t border-border p-1">
          {parts.map((part) => (
            <ActionRow key={part.id} part={part} lines={lines[part.id]} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------- build
export function BuildCard({ part, live = false }: { part: BuildPart; live?: boolean }) {
  const t = useT('chat');
  const [open, setOpen] = useState(false);
  if (part.ok && part.failedActions === 0) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <CircleCheck className="size-4 text-success" />
        {t('build.ok')}
      </div>
    );
  }
  const shown = part.errors.slice(0, open ? 12 : 2);
  return (
    <div className={cn('rounded-xl border px-3 py-2 text-[13px]', part.willRetry ? 'border-border bg-muted/40' : 'border-destructive/30 bg-destructive/5')}>
      <div className="flex items-center gap-2 font-medium">
        {part.willRetry ? <Hammer className={cn('size-4 text-warning', live && 'animate-pulse')} /> : <TriangleAlert className="size-4 text-destructive" />}
        <span className="min-w-0 flex-1">
          {part.willRetry
            ? t('build.fixing', { n: part.attempt + 1, max: Math.max(LIMITS.autoFixAttempts, part.attempt + 1) })
            : part.ok
              ? t('build.reapplying', { count: part.failedActions })
              : t('build.failed')}
        </span>
      </div>
      {!part.ok && part.errors.length > 0 ? (
        <ul className="mt-1.5 space-y-1">
          {shown.map((e, i) => (
            <li key={i} className="break-words font-mono text-[11.5px] text-muted-foreground">
              {e.file ? <span className="text-foreground">{e.file}{e.line ? `:${e.line}` : ''} </span> : null}
              {e.message}
            </li>
          ))}
          {part.errors.length > 2 ? (
            <li>
              <button type="button" className="text-[11.5px] text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => setOpen((v) => !v)}>
                {open ? '−' : t('build.moreErrors', { count: part.errors.length - 2 })}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
      {part.ok && part.failedActions > 0 && !part.willRetry ? null : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------- errors
export interface ErrorActions {
  onRetry(): void;
  onContinue(): void;
  onFixBuild(): void;
  onConnectKey(): void;
}

const KEY_CODES: ReadonlySet<string> = new Set(['provider_auth', 'no_provider']);
const RETRY_CODES: ReadonlySet<string> = new Set([
  'provider_rate_limit', 'provider_overloaded', 'provider_network', 'provider_error', 'provider_bad_request',
  'internal', 'interrupted', 'edit_failed', 'rate_limited', 'network', 'conflict',
]);

export function ErrorCard({
  code,
  fallback,
  resetsAt,
  actions,
  compact,
}: {
  code: ChatErrorCode | string;
  fallback?: string;
  resetsAt?: string | null;
  actions?: ErrorActions;
  compact?: boolean;
}) {
  const t = useT('chat');
  const { locale } = useLocale();
  const known = code in ERROR_KEYS;
  let text: string = known ? t(`errors.${code as keyof typeof ERROR_KEYS}`, { time: resetsAt ? formatTime(resetsAt, locale) : '—' }) : (fallback ?? t('errors.internal'));
  if (code === 'provider_bad_request' && fallback) text = `${text} ${fallback}`;

  let buttons: ReactNode = null;
  if (actions) {
    if (KEY_CODES.has(code)) {
      buttons = (
        <Button size="sm" variant="outline" onClick={actions.onConnectKey}>
          {code === 'provider_auth' ? t('errors.updateKey') : t('errors.connectKey')}
        </Button>
      );
    } else if (code === 'limit_reached') {
      buttons = <Button size="sm" variant="outline" onClick={actions.onConnectKey}>{t('errors.ownKey')}</Button>;
    } else if (code === 'max_tokens') {
      buttons = <Button size="sm" variant="outline" onClick={actions.onContinue}>{t('errors.continue')}</Button>;
    } else if (code === 'build_failed') {
      buttons = <Button size="sm" variant="outline" onClick={actions.onFixBuild}>{t('errors.tryFix')}</Button>;
    } else if (RETRY_CODES.has(code)) {
      buttons = <Button size="sm" variant="outline" onClick={actions.onRetry}>{t('errors.retry')}</Button>;
    }
  }

  return (
    <div className={cn('rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[13px]', compact && 'py-2')} role="alert">
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
        <p className="min-w-0 flex-1 break-words text-foreground">{text}</p>
      </div>
      {buttons ? <div className="mt-2 flex flex-wrap gap-2 pl-6">{buttons}</div> : null}
    </div>
  );
}

const ERROR_KEYS = {
  provider_auth: 1, provider_rate_limit: 1, provider_overloaded: 1, provider_bad_request: 1, provider_network: 1,
  provider_error: 1, refusal: 1, max_tokens: 1, edit_failed: 1, build_failed: 1, interrupted: 1, no_provider: 1,
  limit_reached: 1, internal: 1, conflict: 1, rate_limited: 1, network: 1,
} as const;

export function errorPartCard(part: ErrorPart, resetsAt: string | null | undefined, actions?: ErrorActions): ReactNode {
  return <ErrorCard code={part.code} fallback={part.message} resetsAt={resetsAt} actions={actions} />;
}
