import { memo, type ReactNode } from 'react';
import { History, MousePointerClick, Redo2, Shuffle, Square, Undo2, WandSparkles } from 'lucide-react';
import type { ActionPart, ChatMessage, MessagePart, PreviewError } from '@shared/types';
import { LogoMark } from '@/components/common/Logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/features/workspace/store';
import { useLocale, useT } from '@/i18n';
import { formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Markdown } from './Markdown';
import { ActionGroup, BuildCard, ErrorCard, ThinkingBlock, type ErrorActions } from './parts';
import { QuestionsCard } from './QuestionsCard';

// ---------------------------------------------------------------------------------- user
export const UserMessage = memo(function UserMessage({ message, pending }: { message: ChatMessage; pending?: boolean }) {
  const t = useT('chat');
  const el = message.selectedElement;
  return (
    <div className="flex justify-end">
      <div className={cn('max-w-[88%] space-y-2', pending && 'opacity-70')}>
        {message.attachments.length > 0 ? (
          <div className="flex flex-wrap justify-end gap-2">
            {message.attachments.map((a) => (
              <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-border">
                <img src={a.url} alt={t('message.imageAlt')} loading="lazy" className="size-20 object-cover" />
              </a>
            ))}
          </div>
        ) : null}
        <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-muted px-3.5 py-2.5 text-sm text-foreground">
          {message.content}
        </div>
        {el ? (
          <div className="flex justify-end">
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground">
              <MousePointerClick className="size-3" />
              <span className="truncate">{t('composer.selected', { name: el.components?.[0] ?? el.tagName.toLowerCase() })}</span>
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------------- assistant
type Block =
  | { kind: 'part'; part: MessagePart; index: number }
  | { kind: 'actions'; parts: ActionPart[]; index: number };

function groupParts(parts: MessagePart[]): Block[] {
  const blocks: Block[] = [];
  parts.forEach((part, index) => {
    if (!part) return;
    if (part.type === 'action') {
      const last = blocks[blocks.length - 1];
      if (last && last.kind === 'actions') last.parts.push(part);
      else blocks.push({ kind: 'actions', parts: [part], index });
    } else blocks.push({ kind: 'part', part, index });
  });
  return blocks;
}

export interface AssistantMessageProps {
  message: ChatMessage;
  live: boolean;
  isLast: boolean;
  lines: Record<string, number>;
  resetsAt: string | null | undefined;
  errorActions?: ErrorActions;
  /** Undo/redo controls for the latest message that produced a version. */
  undo?: { state: 'can-undo' | 'can-redo'; busy: boolean; onUndo(): void; onRedo(): void };
  crash?: PreviewError | null;
  onFixCrash?(): void;
  onSuggestion?(text: string): void;
  /** Sends the answers to the questions the AI asked (only the latest message can be answered). */
  onAnswer?(text: string): void;
  onBuildThis?(): void;
}

/** "nvidia:nvidia/nemotron-3-ultra" → "nemotron-3-ultra": enough to tell the models apart in a one-line notice. */
function modelName(id: string): string {
  return id.slice(id.indexOf(':') + 1).split('/').pop() || id;
}

export function AssistantMessage(props: AssistantMessageProps) {
  const { message, live, isLast, lines, resetsAt, errorActions, undo, crash } = props;
  const t = useT('chat');
  const tc = useT('common');
  const { locale } = useLocale();
  const blocks = groupParts(message.parts);
  const suggestions = message.parts.find((p) => p?.type === 'suggestions');
  const hasContent = blocks.some((b) => b.kind === 'actions' || b.part.type !== 'suggestions');
  const isDemo = message.model?.startsWith('mock:');

  const body: ReactNode[] = [];
  for (const block of blocks) {
    if (block.kind === 'actions') {
      body.push(<ActionGroup key={`a${block.index}`} parts={block.parts} lines={lines} live={live} />);
      continue;
    }
    const { part, index } = block;
    switch (part.type) {
      case 'text':
        if (part.text.trim()) body.push(<Markdown key={index} text={part.text} />);
        break;
      case 'thinking':
        body.push(<ThinkingBlock key={index} part={part} live={live} />);
        break;
      case 'build':
        body.push(<BuildCard key={index} part={part} live={live} />);
        break;
      case 'questions':
        body.push(<QuestionsCard key={index} items={part.items} active={isLast && !live} onAnswer={props.onAnswer} />);
        break;
      case 'notice':
        body.push(
          <p key={index} className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <Shuffle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{t('notice.modelFallback', { from: modelName(part.from), to: modelName(part.to) })}</span>
          </p>,
        );
        break;
      case 'error':
        body.push(<ErrorCard key={index} code={part.code} fallback={part.message} resetsAt={resetsAt} actions={isLast && !live ? errorActions : undefined} />);
        break;
      default:
        break;
    }
  }

  return (
    <div className="flex gap-2.5">
      <LogoMark className="mt-0.5 size-6 shrink-0" />
      <div className="min-w-0 flex-1 space-y-2.5">
        {isDemo ? <Badge variant="secondary" className="text-[10px]">{t('message.demo')}</Badge> : null}
        {body}
        {live && !hasContent ? (
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <span className="flex gap-1">
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
            </span>
            {t('message.thinking')}
          </div>
        ) : null}

        {crash && !live ? (
          <div className="rounded-xl border border-warning/40 bg-warning/5 px-3 py-2.5 text-[13px]" role="alert">
            <p className="font-medium">{t('crash.title')}</p>
            <p className="mt-1 break-words font-mono text-[11.5px] text-muted-foreground">{crash.message}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={props.onFixCrash}>
                <WandSparkles className="size-3.5" />
                {t('crash.tryFix')}
              </Button>
              {undo?.state === 'can-undo' ? (
                <Button size="sm" variant="ghost" onClick={undo.onUndo} disabled={undo.busy}>
                  <Undo2 className="size-3.5" />
                  {t('message.undo')}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {!live ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] text-muted-foreground">
            {message.status === 'stopped' ? (
              <span className="inline-flex items-center gap-1">
                <Square className="size-3" />
                {t('message.stopped')}
              </span>
            ) : null}
            {message.versionNumber !== null ? (
              <button
                type="button"
                onClick={() => useWorkspace.getState().setPanel('history', true)}
                title={t('message.viewChanges')}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-medium text-foreground transition hover:bg-muted"
              >
                <History className="size-3" />
                {t('message.version', { n: message.versionNumber })}
              </button>
            ) : null}
            {undo ? (
              undo.state === 'can-undo' ? (
                <button type="button" onClick={undo.onUndo} disabled={undo.busy} className="inline-flex items-center gap-1 hover:text-foreground disabled:opacity-50">
                  <Undo2 className="size-3" />
                  {t('message.undo')}
                </button>
              ) : (
                <button type="button" onClick={undo.onRedo} disabled={undo.busy} className="inline-flex items-center gap-1 hover:text-foreground disabled:opacity-50">
                  <Redo2 className="size-3" />
                  {t('message.redo')}
                </button>
              )
            ) : null}
            {message.durationMs ? <span>{t('message.workedFor', { time: formatDuration(message.durationMs, locale) })}</span> : null}
          </div>
        ) : null}

        {!live && isLast && message.mode === 'chat' && message.status === 'done' && props.onBuildThis ? (
          <Button size="sm" variant="outline" onClick={props.onBuildThis}>
            <WandSparkles className="size-3.5" />
            {t('message.buildThis')}
          </Button>
        ) : null}

        {!live && isLast && suggestions?.type === 'suggestions' && props.onSuggestion ? (
          <div className="flex flex-wrap gap-1.5 pt-0.5" aria-label={tc('actions.select')}>
            {suggestions.items.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => props.onSuggestion?.(item)}
                className="rounded-full border border-border bg-background px-3 py-1 text-left text-[12.5px] text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
              >
                {item}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
