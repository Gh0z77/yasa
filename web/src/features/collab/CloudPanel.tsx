import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Database, FolderClosed, KeyRound, RefreshCw, ShieldAlert, ShieldCheck, Table2, Users } from 'lucide-react';
import type { SupabaseFailure } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useWorkspace } from '@/features/workspace/store';
import { useErrorMessage, useLocale, useT } from '@/i18n';
import { api, isApiError } from '@/lib/api';
import { formatNumber, relativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

function Card({ icon, title, count, children }: { icon: ReactNode; title: string; count?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 backdrop-blur-xl">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <span className="text-muted-foreground">{icon}</span>
        {title}
        {count !== undefined ? <span className="ml-auto text-xs tabular-nums text-muted-foreground">{count}</span> : null}
      </h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** The "Cloud" tab: the backend of this project (database tables, accounts, storage, pending migrations). */
export function CloudPanel({ projectId, active }: { projectId: string; active: boolean }) {
  const t = useT('shell');
  const { locale } = useLocale();
  const errorMessage = useErrorMessage();
  const openDialog = () => useWorkspace.getState().setPanel('supabase', true);

  const status = useQuery({
    queryKey: ['supabase', projectId] as const,
    queryFn: ({ signal }) => api.supabase.status(projectId, { signal }),
    enabled: active,
  });
  const connection = status.data?.connection ?? null;
  const overview = useQuery({
    queryKey: ['supabase-overview', projectId] as const,
    queryFn: ({ signal }) => api.supabase.overview(projectId, { signal }),
    enabled: active && Boolean(connection?.canRunSql),
    staleTime: 20_000,
  });

  if (status.isPending) {
    return (
      <div className="grid gap-4 p-6 md:grid-cols-2">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }

  if (!connection) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-md text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-foreground/[0.06]">
            <Database className="size-6" aria-hidden />
          </span>
          <h2 className="mt-5 text-xl font-semibold tracking-tight">{t('cloud.emptyTitle')}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('cloud.emptyText')}</p>
          <Button type="button" className="mt-6" onClick={openDialog}>
            {t('supabase.connect')}
          </Button>
        </div>
      </div>
    );
  }

  const pending = status.data?.pending ?? 0;
  const failure = overview.isError && isApiError(overview.error) ? (overview.error.details as { supabase?: SupabaseFailure } | null)?.supabase : undefined;
  const data = overview.data;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
        <header className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight">{t('cloud.title')}</h2>
            <p className="truncate font-mono text-xs text-muted-foreground">{connection.url.replace('https://', '')}</p>
          </div>
          {connection.canRunSql ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => void overview.refetch()} loading={overview.isFetching}>
              <RefreshCw className="size-3.5" />
              {t('cloud.refresh')}
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" onClick={openDialog}>
            {t('cloud.manage')}
          </Button>
          <Button type="button" size="sm" variant="outline" asChild>
            <a href={`https://supabase.com/dashboard/project/${connection.projectRef}`} target="_blank" rel="noreferrer">
              Supabase
              <ArrowUpRight className="size-3.5" aria-hidden />
            </a>
          </Button>
        </header>

        {pending > 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[color:color-mix(in_oklab,var(--brand-to)_45%,transparent)] bg-[color:color-mix(in_oklab,var(--brand-to)_10%,transparent)] px-4 py-3 text-sm">
            <span className="min-w-0 flex-1">{t('cloud.pending', { count: pending })}</span>
            <Button type="button" size="sm" onClick={openDialog}>
              {t('cloud.review')}
            </Button>
          </div>
        ) : null}

        {!connection.canRunSql ? (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border px-4 py-3 text-sm">
            <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 text-muted-foreground">{t('cloud.needToken')}</span>
            <Button type="button" size="sm" variant="outline" onClick={openDialog}>
              {t('cloud.addToken')}
            </Button>
          </div>
        ) : overview.isPending ? (
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-44 rounded-2xl md:col-span-2" />
            <Skeleton className="h-36 rounded-2xl" />
            <Skeleton className="h-36 rounded-2xl" />
          </div>
        ) : overview.isError || !data ? (
          <p role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {failure ? t(`supabase.errors.${failure}`) : errorMessage(overview.error)}
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Card icon={<Table2 className="size-4" />} title={t('cloud.tables')} count={data.tables.length}>
                {data.tables.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('cloud.noTables')}</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {data.tables.map((table) => (
                      <li key={table.name} className="flex items-center gap-3 py-2 text-sm">
                        <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{table.name}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{t('cloud.columns', { count: table.columns })}</span>
                        <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{t('cloud.rows', { count: formatNumber(table.rows, locale) })}</span>
                        <span
                          className={cn('flex w-24 shrink-0 items-center justify-end gap-1 text-xs', table.rls ? 'text-success' : 'text-destructive')}
                          title={table.rls ? t('cloud.rlsOnHint') : t('cloud.rlsOffHint')}
                        >
                          {table.rls ? <ShieldCheck className="size-3.5" aria-hidden /> : <ShieldAlert className="size-3.5" aria-hidden />}
                          {table.rls ? t('cloud.rlsOn') : t('cloud.rlsOff')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <Card icon={<Users className="size-4" />} title={t('cloud.users')} count={formatNumber(data.users.count, locale)}>
              {data.users.recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('cloud.noUsers')}</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.users.recent.map((user) => (
                    <li key={`${user.email}-${user.createdAt}`} className="flex items-center gap-3 text-[13px]">
                      <span className="min-w-0 flex-1 truncate">{user.email || '—'}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(user.createdAt, locale)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card icon={<FolderClosed className="size-4" />} title={t('cloud.storage')} count={data.buckets.length}>
              {data.buckets.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('cloud.noBuckets')}</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.buckets.map((bucket) => (
                    <li key={bucket.name} className="flex items-center gap-3 text-[13px]">
                      <span className="min-w-0 flex-1 truncate font-mono">{bucket.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{bucket.public ? t('cloud.public') : t('cloud.private')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
