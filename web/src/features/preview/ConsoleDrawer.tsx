import { useEffect, useMemo, useRef, useState } from 'react';
import { Ban, X } from 'lucide-react';
import type { ConsoleEntry } from '@shared/types';
import { useWorkspace } from '@/features/workspace/store';
import { useLocale, useT } from '@/i18n';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'error' | 'warn';

const LEVEL_CLASS: Record<ConsoleEntry['level'], string> = {
  log: 'text-foreground',
  info: 'text-info',
  debug: 'text-muted-foreground',
  warn: 'text-warning bg-warning/5',
  error: 'text-destructive bg-destructive/5',
};

export function ConsoleDrawer({ onClose }: { onClose(): void }) {
  const t = useT('preview');
  const { locale } = useLocale();
  const entries = useWorkspace((s) => s.consoleEntries);
  const [filter, setFilter] = useState<Filter>('all');
  const listRef = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => (filter === 'all' ? entries : entries.filter((e) => e.level === filter)), [entries, filter]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length]);

  const filters: Array<{ id: Filter; label: string }> = [
    { id: 'all', label: t('console.all') },
    { id: 'error', label: t('console.errors') },
    { id: 'warn', label: t('console.warnings') },
  ];

  return (
    <section className="flex h-52 shrink-0 flex-col border-t border-border bg-background" aria-label={t('console.title')}>
      <header className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
        <span className="px-1 text-[12px] font-medium">{t('console.title')}</span>
        <div className="ml-2 flex items-center gap-0.5">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn('rounded px-2 py-0.5 text-[11.5px] transition', filter === f.id ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button type="button" title={t('console.clear')} aria-label={t('console.clear')} onClick={() => useWorkspace.getState().clearConsole()} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <Ban className="size-3.5" />
        </button>
        <button type="button" title={t('console.close')} aria-label={t('console.close')} onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="size-3.5" />
        </button>
      </header>
      <div ref={listRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto font-mono text-[11.5px] leading-relaxed">
        {shown.length === 0 ? (
          <p className="grid h-full place-items-center font-sans text-[12.5px] text-muted-foreground">{t('console.empty')}</p>
        ) : (
          shown.map((entry, i) => (
            <div key={i} className={cn('flex gap-2 border-b border-border/50 px-3 py-1', LEVEL_CLASS[entry.level])}>
              <span className="shrink-0 select-none text-muted-foreground/70">{formatTime(new Date(entry.timestamp).toISOString(), locale)}</span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{entry.args.join(' ')}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
