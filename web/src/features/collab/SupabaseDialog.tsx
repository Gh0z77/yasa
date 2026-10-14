import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Check, ChevronDown, Copy, Database, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { Project, SupabaseFailure, SupabaseMigration, SupabaseStatus } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { SupabaseAccountForm, supabaseAccountKey, useSupabaseAccount, useSupabaseError, useSupabaseReturn } from './SupabaseAccount';
import { useWorkspace } from '@/features/workspace/store';
import { useErrorMessage, useT } from '@/i18n';
import { api, isApiError } from '@/lib/api';
import { qk } from '@/lib/queries';
import { copyToClipboard } from '@/lib/utils';

const supabaseKey = (projectId: string) => ['supabase', projectId] as const;
const sqlEditorUrl = (ref: string) => `https://supabase.com/dashboard/project/${ref}/sql/new`;

/**
 * The project's backend: connect a Supabase project, then apply the SQL migrations the AI writes — from here
 * when an access token was given, otherwise by copying them into Supabase's SQL editor.
 */
export function SupabaseDialog({ project }: { project: Project }) {
  const t = useT('shell');
  const errorMessage = useErrorMessage();
  const qc = useQueryClient();
  const uid = useId();
  const open = useWorkspace((s) => s.panels.supabase);
  const setPanel = useWorkspace((s) => s.setPanel);
  const justConnected = useSupabaseReturn();
  useEffect(() => {
    if (justConnected) setPanel('supabase', true);
  }, [justConnected, setPanel]);

  const status = useQuery({
    queryKey: supabaseKey(project.id),
    queryFn: ({ signal }) => api.supabase.status(project.id, { signal }),
    enabled: open,
  });

  const [url, setUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [dbUrl, setDbUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ path: string; message: string } | null>(null);

  useEffect(() => {
    if (!open) {
      setAnonKey('');
      setAccessToken('');
      setDbUrl('');
      setError(null);
      setFailure(null);
    }
  }, [open]);

  const explain = (err: unknown): string => {
    const code = isApiError(err) ? (err.details as { supabase?: SupabaseFailure } | null)?.supabase : undefined;
    return code ? t(`supabase.errors.${code}`) : errorMessage(err);
  };
  const store = (next: SupabaseStatus) => qc.setQueryData<SupabaseStatus>(supabaseKey(project.id), next);
  // Connecting rewrites files in the project (the client, package.json): reload them.
  const reloadProject = () => qc.invalidateQueries({ queryKey: qk.project(project.id) });

  const connect = useMutation({
    mutationFn: () => api.supabase.connect(project.id, { url: url.trim(), anonKey: anonKey.trim(), accessToken: accessToken.trim() || null, dbUrl: dbUrl.trim() || null }),
    onSuccess: (next) => {
      store(next);
      setError(null);
      setAnonKey('');
      setAccessToken('');
      setDbUrl('');
      void reloadProject();
      toast.success(t('supabase.connected'));
    },
    onError: (err) => setError(explain(err)),
  });
  const disconnect = useMutation({
    mutationFn: () => api.supabase.disconnect(project.id),
    onSuccess: store,
    onError: (err) => toast.error(explain(err)),
  });
  const apply = useMutation({
    mutationFn: () => api.supabase.apply(project.id),
    onSuccess: (result) => {
      store(result.status);
      setFailure(result.failed);
      if (result.applied.length > 0) toast.success(t('supabase.applied', { count: result.applied.length }));
    },
    onError: (err) => toast.error(explain(err)),
  });
  const mark = useMutation({
    mutationFn: (path: string) => api.supabase.mark(project.id, path),
    onSuccess: store,
    onError: (err) => toast.error(explain(err)),
  });

  const connection = status.data?.connection ?? null;
  const migrations = status.data?.migrations ?? [];
  const pending = migrations.filter((m) => !m.applied);
  const canConnect = url.trim().length > 10 && anonKey.trim().length >= 20;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canConnect && !connect.isPending) connect.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => setPanel('supabase', next)}>
      <DialogContent size="md">
        <DialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-foreground/[0.07]">
            <Database className="size-5" aria-hidden />
          </div>
          <DialogTitle>{t('supabase.title')}</DialogTitle>
          <DialogDescription>{t('supabase.description')}</DialogDescription>
        </DialogHeader>

        {status.isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </div>
        ) : status.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(status.error)}
          </p>
        ) : !connection ? (
          <ConnectChoices
            projectId={project.id}
            onLinked={(next) => {
              store(next);
              void reloadProject();
              toast.success(t('supabase.connected'));
            }}
            manual={
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`${uid}-url`}>{t('supabase.urlLabel')}</Label>
              <Input id={`${uid}-url`} name="supabase-url" autoComplete="off" spellCheck={false} placeholder="https://abcdefgh.supabase.co" value={url} onChange={(e) => setUrl(e.target.value)} className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${uid}-key`}>{t('supabase.keyLabel')}</Label>
              <Input id={`${uid}-key`} name="supabase-anon-key" autoComplete="off" spellCheck={false} placeholder="eyJhbGciOi…" value={anonKey} onChange={(e) => setAnonKey(e.target.value)} className="font-mono" />
              <p className="text-xs text-muted-foreground">{t('supabase.keyHint')}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${uid}-token`}>{t('supabase.tokenLabel')}</Label>
              <Input id={`${uid}-token`} type="password" name="supabase-access-token" autoComplete="off" spellCheck={false} placeholder="sbp_…" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} className="font-mono" />
              <p className="text-xs text-muted-foreground">
                {t('supabase.tokenHint')}{' '}
                <a href="https://supabase.com/dashboard/account/tokens" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-foreground underline-offset-4 hover:underline">
                  {t('supabase.tokenLink')}
                  <ArrowUpRight className="size-3" aria-hidden />
                </a>
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${uid}-db`}>{t('supabase.dbLabel')}</Label>
              <Input id={`${uid}-db`} type="password" name="supabase-db-url" autoComplete="off" spellCheck={false} placeholder="postgresql://postgres:…@db.….supabase.co:5432/postgres" value={dbUrl} onChange={(e) => setDbUrl(e.target.value)} className="font-mono" />
              <p className="text-xs text-muted-foreground">{t('supabase.dbHint')}</p>
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" loading={connect.isPending} disabled={!canConnect}>
              {t('supabase.connect')}
            </Button>
          </form>
            }
          />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <Check className="size-4 shrink-0 text-success" aria-hidden />
                <span className="truncate font-mono">{connection.url.replace('https://', '')}</span>
              </span>
              <button
                type="button"
                onClick={() => disconnect.mutate()}
                disabled={disconnect.isPending}
                className="shrink-0 rounded-sm text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/45"
              >
                {t('supabase.disconnect')}
              </button>
            </div>

            <div>
              <p className="text-[13px] font-medium">{t('supabase.migrations')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {migrations.length === 0 ? t('supabase.noMigrations') : connection.canRunSql ? t('supabase.migrationsAuto') : t('supabase.migrationsManual')}
              </p>
              {migrations.length > 0 ? (
                <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
                  {migrations.map((migration) => (
                    <MigrationRow
                      key={migration.path}
                      migration={migration}
                      manual={!connection.canRunSql}
                      busy={mark.isPending && mark.variables === migration.path}
                      onMark={() => mark.mutate(migration.path)}
                    />
                  ))}
                </ul>
              ) : null}
            </div>

            {failure ? (
              <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
                <p className="font-medium">{t('supabase.failed', { name: failure.path.split('/').pop() ?? failure.path })}</p>
                <p className="mt-1 break-words font-mono">{failure.message}</p>
              </div>
            ) : null}

            {pending.length > 0 ? (
              connection.canRunSql ? (
                <Button type="button" className="w-full" loading={apply.isPending} onClick={() => apply.mutate()}>
                  {t('supabase.apply', { count: pending.length })}
                </Button>
              ) : (
                <Button type="button" variant="outline" className="w-full" asChild>
                  <a href={sqlEditorUrl(connection.projectRef)} target="_blank" rel="noreferrer">
                    {t('supabase.openEditor')}
                    <ArrowUpRight className="size-4" aria-hidden />
                  </a>
                </Button>
              )
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MigrationRow({ migration, manual, busy, onMark }: { migration: SupabaseMigration; manual: boolean; busy: boolean; onMark(): void }) {
  const t = useT('shell');
  const [copied, setCopied] = useState(false);
  return (
    <li className="flex items-center gap-2 px-3 py-2">
      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={migration.name}>
        {migration.name}
      </span>
      {migration.applied ? (
        <span className="flex shrink-0 items-center gap-1 text-xs text-success">
          <Check className="size-3.5" aria-hidden />
          {t('supabase.appliedLabel')}
        </span>
      ) : (
        <>
          <span className="shrink-0 text-xs text-muted-foreground">{t('supabase.pendingLabel')}</span>
          {manual ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  void copyToClipboard(migration.sql).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1500);
                  });
                }}
              >
                {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                {t('supabase.copySql')}
              </Button>
              <Button type="button" size="sm" variant="outline" loading={busy} onClick={onMark}>
                {t('supabase.markDone')}
              </Button>
            </>
          ) : null}
        </>
      )}
    </li>
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * How an app gets its database: from the user's connected Supabase account (pick a project or create one), after
 * connecting that account, or — tucked away — by pasting a URL and key.
 */
function ConnectChoices({ projectId, onLinked, manual }: { projectId: string; onLinked(status: SupabaseStatus): void; manual: ReactNode }) {
  const t = useT('shell');
  const qc = useQueryClient();
  const explain = useSupabaseError();
  const account = useSupabaseAccount();
  const [ref, setRef] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const link = useMutation({
    mutationFn: (target: string) => api.supabase.link(projectId, target),
    onSuccess: (status) => {
      setError(null);
      onLinked(status);
    },
    onError: (err) => setError(explain(err)),
  });

  // A new project takes a minute or two to start: keep trying to link it until it answers.
  const create = useMutation({
    mutationFn: async () => {
      const created = await api.supabase.create(projectId);
      void qc.invalidateQueries({ queryKey: supabaseAccountKey });
      for (let attempt = 0; attempt < 60 && alive.current; attempt++) {
        try {
          return await api.supabase.link(projectId, created.ref);
        } catch (err) {
          const code = isApiError(err) ? (err.details as { supabase?: SupabaseFailure } | null)?.supabase : undefined;
          if (code !== 'not_ready') throw err;
          await sleep(5000);
        }
      }
      throw new Error(t('supabase.errors.not_ready'));
    },
    onSuccess: (status) => {
      setError(null);
      onLinked(status);
    },
    onError: (err) => setError(explain(err)),
  });

  const manualToggle = (
    <div className="border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setShowManual((v) => !v)}
        aria-expanded={showManual}
        className="flex items-center gap-1 rounded-sm text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/45"
      >
        <ChevronDown className={`size-3.5 transition-transform ${showManual ? 'rotate-180' : ''}`} aria-hidden />
        {t('supabase.manualToggle')}
      </button>
      {showManual ? <div className="mt-4">{manual}</div> : null}
    </div>
  );

  if (account.isPending) return <Skeleton className="h-24 w-full" />;

  if (!account.data?.connected) {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-[13px] font-medium">{t('supabase.accountTitle')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('supabase.accountDescription')}</p>
        </div>
        <SupabaseAccountForm />
        {manualToggle}
      </div>
    );
  }

  const projects = account.data.projects;
  const busy = link.isPending || create.isPending;
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[13px] font-medium">{t('supabase.pickTitle')}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('supabase.pickHint')}</p>
      </div>
      {projects.length > 0 ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            aria-label={t('supabase.pickPlaceholder')}
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45"
          >
            <option value="">{t('supabase.pickPlaceholder')}</option>
            {projects.map((p) => (
              <option key={p.ref} value={p.ref}>
                {p.name} · {p.region}
                {p.ready ? '' : ` (${t('supabase.starting')})`}
              </option>
            ))}
          </select>
          <Button type="button" loading={link.isPending} disabled={!ref || busy} onClick={() => link.mutate(ref)}>
            {t('supabase.link')}
          </Button>
        </div>
      ) : null}
      <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={() => create.mutate()}>
        {create.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
        {t('supabase.create')}
      </Button>
      {create.isPending ? <p className="text-xs text-muted-foreground">{t('supabase.creating')}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {manualToggle}
    </div>
  );
}
