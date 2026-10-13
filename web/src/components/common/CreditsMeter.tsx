import { Zap } from 'lucide-react';
import { useLocale, useT } from '@/i18n';
import { relativeTime } from '@/lib/format';
import { useUsage } from '@/lib/queries';
import { cn } from '@/lib/utils';

/**
 * How many AI messages are left today on the server's own keys. `compact` is the one-line form used next to
 * the chat composer; the full form (with a bar and the reset time) sits in the sidebar.
 */
export function CreditsMeter({ compact = false, enabled = true, className }: { compact?: boolean; enabled?: boolean; className?: string }) {
  const t = useT('shell');
  const { locale } = useLocale();
  const usage = useUsage({ enabled });
  const data = usage.data;
  if (!data) return null;

  const limit = data.dailyMessageLimit;
  const left = data.remainingToday;
  const unlimited = limit === null || left === null;
  const ratio = unlimited ? 1 : Math.max(0, Math.min(1, left / Math.max(1, limit)));
  const low = !unlimited && ratio <= 0.15;
  const label = unlimited ? t('credits.unlimited') : t('credits.left', { left, total: limit });

  if (compact) {
    return (
      <p className={cn('flex items-center gap-1.5 text-[11.5px] text-muted-foreground', low && 'text-destructive', className)} title={t('credits.hint')}>
        <Zap className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </p>
    );
  }

  return (
    <div className={cn('rounded-2xl border border-[color:var(--glass-border)] bg-foreground/[0.04] px-3.5 py-3', className)} title={t('credits.hint')}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 font-medium text-foreground/85">
          <Zap className="size-3.5 text-[color:var(--brand-to)]" aria-hidden />
          {t('credits.title')}
        </span>
        <span className={cn('tabular-nums text-muted-foreground', low && 'text-destructive')}>{unlimited ? '∞' : `${left} / ${limit}`}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={unlimited ? 1 : limit}
        aria-valuenow={unlimited ? 1 : left}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/10"
      >
        <div className={cn('h-full rounded-full transition-[width] duration-500', low ? 'bg-destructive' : 'bg-brand-gradient')} style={{ width: `${ratio * 100}%` }} />
      </div>
      <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
        {unlimited ? t('credits.unlimitedHint') : t('credits.resets', { when: relativeTime(data.resetsAt, locale) })}
      </p>
    </div>
  );
}
