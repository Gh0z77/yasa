import { useEffect, useId, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Check, GitBranch, Lock } from 'lucide-react';
import { toast } from 'sonner';
import type { GithubFailure, GithubProjectResponse, Project } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useWorkspace } from '@/features/workspace/store';
import { useErrorMessage, useLocale, useT } from '@/i18n';
import { api, isApiError } from '@/lib/api';
import { relativeTime } from '@/lib/format';

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';
const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;

const githubKey = (projectId: string) => ['github', projectId] as const;

/** Push the project to a GitHub repository of the user's own: connect a token, create the repo, then sync. */
export function GithubDialog({ project }: { project: Project }) {
  const t = useT('shell');
  const { locale } = useLocale();
  const errorMessage = useErrorMessage();
  const qc = useQueryClient();
  const uid = useId();
  const open = useWorkspace((s) => s.panels.github);
  const setPanel = useWorkspace((s) => s.setPanel);

  const status = useQuery({
    queryKey: githubKey(project.id),
    queryFn: ({ signal }) => api.github.project(project.id, { signal }),
    enabled: open,
  });

  const [token, setToken] = useState('');
  const [repo, setRepo] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const suggested = status.data?.suggestedRepo;
  useEffect(() => {
    if (suggested) setRepo((current) => current || suggested);
  }, [suggested]);
  useEffect(() => {
    if (!open) {
      setToken('');
      setError(null);
    }
  }, [open]);

  /** GitHub-specific failures have their own wording; everything else uses the generic message. */
  const explain = (err: unknown): string => {
    const failure = isApiError(err) ? (err.details as { github?: GithubFailure } | null)?.github : undefined;
    return failure ? t(`github.errors.${failure}`) : errorMessage(err);
  };
  const setData = (patch: Partial<GithubProjectResponse>) =>
    qc.setQueryData<GithubProjectResponse>(githubKey(project.id), (old) => (old ? { ...old, ...patch } : old));

  const connect = useMutation({
    mutationFn: () => api.github.connect(token.trim()),
    onSuccess: ({ connection }) => {
      setData({ connection });
      setToken('');
      setError(null);
    },
    onError: (err) => setError(explain(err)),
  });
  const push = useMutation({
    mutationFn: (first: boolean) => api.github.push(project.id, first ? { repo: repo.trim(), private: isPrivate } : {}),
    onSuccess: ({ link, created, files }) => {
      setData({ link });
      setError(null);
      toast.success(created ? t('github.created', { repo: link.repo }) : t('github.pushed', { count: files }));
    },
    onError: (err) => setError(explain(err)),
  });
  const disconnect = useMutation({
    mutationFn: () => api.github.disconnect(),
    onSuccess: () => setData({ connection: null }),
    onError: (err) => toast.error(explain(err)),
  });
  const unlink = useMutation({
    mutationFn: () => api.github.unlink(project.id),
    onSuccess: () => setData({ link: null }),
    onError: (err) => toast.error(explain(err)),
  });

  const { connection, link } = status.data ?? { connection: null, link: null };
  const repoValid = REPO_NAME.test(repo.trim());

  const submitToken = (event: FormEvent) => {
    event.preventDefault();
    if (token.trim().length >= 20 && !connect.isPending) connect.mutate();
  };
  const submitRepo = (event: FormEvent) => {
    event.preventDefault();
    if (repoValid && !push.isPending) push.mutate(true);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => setPanel('github', next)}>
      <DialogContent size="sm">
        <DialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-foreground/[0.07]">
            <GitBranch className="size-5" aria-hidden />
          </div>
          <DialogTitle>{t('github.title')}</DialogTitle>
          <DialogDescription>{t('github.description')}</DialogDescription>
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
          // Step 1: connect an account.
          <form onSubmit={submitToken} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`${uid}-token`}>{t('github.tokenLabel')}</Label>
              <Input
                id={`${uid}-token`}
                type="password"
                name="github-token"
                autoComplete="off"
                spellCheck={false}
                placeholder="github_pat_…"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  if (error) setError(null);
                }}
                aria-invalid={error ? true : undefined}
              />
              <p className="text-xs text-muted-foreground">
                {t('github.tokenHint')}{' '}
                <a href={TOKEN_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-foreground underline-offset-4 hover:underline">
                  {t('github.tokenLink')}
                  <ArrowUpRight className="size-3" aria-hidden />
                </a>
              </p>
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" loading={connect.isPending} disabled={token.trim().length < 20}>
              {t('github.connect')}
            </Button>
          </form>
        ) : !link ? (
          // Step 2: create the repository with the first push.
          <form onSubmit={submitRepo} className="space-y-4">
            <AccountRow login={connection.login} onDisconnect={() => disconnect.mutate()} busy={disconnect.isPending} label={t('github.disconnect')} />
            <div className="space-y-2">
              <Label htmlFor={`${uid}-repo`}>{t('github.repoLabel')}</Label>
              <div className="flex items-center gap-2">
                <span className="shrink-0 font-mono text-sm text-muted-foreground">{connection.login}/</span>
                <Input
                  id={`${uid}-repo`}
                  name="github-repo"
                  autoComplete="off"
                  spellCheck={false}
                  value={repo}
                  onChange={(e) => {
                    setRepo(e.target.value);
                    if (error) setError(null);
                  }}
                  aria-invalid={repo && !repoValid ? true : undefined}
                  className="font-mono"
                />
              </div>
              {repo && !repoValid ? (
                <p className="text-xs text-destructive">{t('github.repoInvalid')}</p>
              ) : (
                <p className="text-xs text-muted-foreground">{t('github.repoHint')}</p>
              )}
            </div>
            <label className="flex items-center justify-between gap-4 rounded-xl border border-border px-3.5 py-3">
              <span className="flex items-center gap-2.5 text-sm">
                <Lock className="size-4 text-muted-foreground" aria-hidden />
                {t('github.private')}
              </span>
              <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
            </label>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" loading={push.isPending} disabled={!repoValid}>
              {t('github.createAndPush')}
            </Button>
          </form>
        ) : (
          // Step 3: keep the repository in sync.
          <div className="space-y-4">
            <AccountRow login={connection.login} onDisconnect={() => disconnect.mutate()} busy={disconnect.isPending} label={t('github.disconnect')} />
            <div className="rounded-xl border border-border px-3.5 py-3">
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center gap-1 font-mono text-sm font-medium underline-offset-4 hover:underline"
              >
                <span className="truncate">
                  {link.repo}
                  <span className="text-muted-foreground"> · {link.branch}</span>
                </span>
                <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />
              </a>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                {link.pushedAt ? (
                  <>
                    <Check className="size-3.5 text-success" aria-hidden />
                    {t('github.lastPush', { when: relativeTime(link.pushedAt, locale) })}
                    {link.lastCommitUrl ? (
                      <a href={link.lastCommitUrl} target="_blank" rel="noreferrer" className="font-mono underline-offset-4 hover:underline">
                        {link.lastCommitSha?.slice(0, 7)}
                      </a>
                    ) : null}
                  </>
                ) : (
                  t('github.neverPushed')
                )}
              </p>
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="button" className="w-full" loading={push.isPending} onClick={() => push.mutate(false)}>
              {t('github.push')}
            </Button>
            <button
              type="button"
              onClick={() => unlink.mutate()}
              disabled={unlink.isPending}
              className="mx-auto block rounded-sm text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/45"
            >
              {t('github.unlink')}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AccountRow({ login, onDisconnect, busy, label }: { login: string; onDisconnect(): void; busy: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        <Check className="size-4 shrink-0 text-success" aria-hidden />
        <span className="truncate font-mono">{login}</span>
      </span>
      <button
        type="button"
        onClick={onDisconnect}
        disabled={busy}
        className="shrink-0 rounded-sm text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/45"
      >
        {label}
      </button>
    </div>
  );
}
