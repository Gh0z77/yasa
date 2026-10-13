import type { ReactNode } from 'react';
import { CalendarDays, Clock, Infinity as InfinityIcon, KeyRound, Sun, Wrench, type LucideIcon } from 'lucide-react';
import type { UsageBucket } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorMessage, useLocale, useT } from '@/i18n';
import { formatNumber, formatTime } from '@/lib/format';
import { useUsage } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { SettingsCard } from './SettingsCard';

function BucketCard({ icon: Icon, title, bucket }: { icon: LucideIcon; title: string; bucket: UsageBucket }) {
  const t = useT('settings');
  const { locale } = useLocale();
  const tokens = bucket.inputTokens + bucket.outputTokens;
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
        <h3>{title}</h3>
      </div>
      <dl className="grid grid-cols-2 gap-4">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t('usage.messages')}</dt>
          <dd className="mt-1 truncate text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {formatNumber(bucket.messages, locale)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t('usage.tokens')}</dt>
          <dd
            className="mt-1 truncate text-2xl font-semibold tabular-nums tracking-tight text-foreground"
            title={formatNumber(tokens, locale)}
          >
            {formatNumber(tokens, locale, { compact: tokens >= 100_000 })}
          </dd>
        </div>
      </dl>
      <p className="mt-3 flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums text-muted-foreground">
        <span>{t('usage.tokensIn', { value: formatNumber(bucket.inputTokens, locale) })}</span>
        <span>{t('usage.tokensOut', { value: formatNumber(bucket.outputTokens, locale) })}</span>
      </p>
    </div>
  );
}

function Fact({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-sm font-medium text-foreground">{children}</dd>
      </div>
    </div>
  );
}

export function UsageSection({ onConnectKey }: { onConnectKey?: () => void }) {
  const t = useT('settings');
  const { locale } = useLocale();
  const errorMessage = useErrorMessage();
  const usageQuery = useUsage();
  const usage = usageQuery.data;

  if (usageQuery.isPending) {
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-44 w-full rounded-xl" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-36 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (!usage) {
    return (
      <SettingsCard title={t('usage.title')} description={t('usage.loadError')}>
        <div className="flex flex-wrap items-center gap-3" role="alert">
          {usageQuery.error ? <p className="text-sm text-destructive">{errorMessage(usageQuery.error)}</p> : null}
          <Button type="button" variant="outline" size="sm" loading={usageQuery.isFetching} onClick={() => void usageQuery.refetch()}>
            {t('usage.retry')}
          </Button>
        </div>
      </SettingsCard>
    );
  }

  const limit = usage.dailyMessageLimit;
  const unlimited = limit === null;
  const remaining = unlimited ? null : Math.max(0, usage.remainingToday ?? 0);
  const used = unlimited || remaining === null ? 0 : Math.max(0, limit - remaining);
  const ratio = unlimited || limit === 0 ? 0 : used / limit;
  const exhausted = !unlimited && remaining === 0;
  const resetTime = formatTime(usage.resetsAt, locale);

  return (
    <div className="space-y-6">
      <SettingsCard
        title={t('usage.dailyLimit')}
        description={unlimited ? t('usage.unlimitedHint') : t('usage.dailyLimitHint')}
        aside={
          unlimited ? (
            <Badge variant="success" className="gap-1">
              <InfinityIcon className="size-3.5" aria-hidden="true" />
              {t('usage.unlimited')}
            </Badge>
          ) : exhausted ? (
            <Badge variant="destructive">{t('usage.limitReached')}</Badge>
          ) : null
        }
        footer={
          !unlimited && onConnectKey ? (
            <Button type="button" variant={exhausted ? 'default' : 'outline'} size="sm" onClick={onConnectKey}>
              <KeyRound className="size-4" aria-hidden="true" />
              {t('usage.connectCta')}
            </Button>
          ) : undefined
        }
      >
        <div className="space-y-5">
          {unlimited ? (
            <p className="text-3xl font-semibold tracking-tight text-foreground">{t('usage.unlimited')}</p>
          ) : (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-sm font-medium tabular-nums text-foreground">
                  {t('usage.used', { used: formatNumber(used, locale), limit: formatNumber(limit, locale) })}
                </p>
                <p className={cn('text-sm tabular-nums', exhausted ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                  {exhausted ? t('usage.limitReached') : t('usage.remaining', { count: remaining ?? 0 })}
                </p>
              </div>
              <Progress
                value={used}
                max={Math.max(1, limit)}
                aria-label={t('usage.dailyLimit')}
                getValueLabel={() => t('usage.used', { used: formatNumber(used, locale), limit: formatNumber(limit, locale) })}
                className="h-2.5"
                indicatorClassName={exhausted ? 'bg-destructive' : ratio >= 0.8 ? 'bg-warning' : 'bg-brand-gradient'}
              />
            </div>
          )}
          <dl className="grid gap-4 sm:grid-cols-2">
            <Fact icon={Wrench} label={t('usage.freeFixes')}>
              <span className="tabular-nums">{t('usage.freeFixesLeft', { count: usage.freeFixesRemaining })}</span>
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{t('usage.freeFixesHint')}</span>
            </Fact>
            <Fact icon={Clock} label={t('usage.resetsLabel')}>
              <time dateTime={usage.resetsAt} className="tabular-nums">
                {t('usage.resets', { time: resetTime })}
              </time>
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{t('usage.resetsHint')}</span>
            </Fact>
          </dl>
        </div>
      </SettingsCard>

      <div className="grid gap-4 sm:grid-cols-2">
        <BucketCard icon={Sun} title={t('usage.today')} bucket={usage.today} />
        <BucketCard icon={CalendarDays} title={t('usage.month')} bucket={usage.month} />
      </div>
    </div>
  );
}
