import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Check, CircleCheck, Copy, ExternalLink, LoaderCircle, Rocket, Send, TriangleAlert, WandSparkles } from 'lucide-react';
import { toast } from 'sonner';
import { slugError, slugify } from '@shared/slug';
import type { BuildErrorInfo, PreviewError, Project } from '@shared/types';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { DomainsSection } from '@/features/collab/DomainsSection';
import { useWorkspace } from '@/features/workspace/store';
import { useErrorMessage, useT } from '@/i18n';
import { api, isApiError } from '@/lib/api';
import { usePublish, useUnpublish } from '@/lib/queries';
import { cn, copyToClipboard } from '@/lib/utils';

/** http://pv-abc.localhost:3000/ → { prefix: 'http://', suffix: '.localhost:3000' } */
function hostParts(previewUrl: string): { prefix: string; suffix: string } {
  try {
    const url = new URL(previewUrl);
    const dot = url.host.indexOf('.');
    return { prefix: `${url.protocol}//`, suffix: dot === -1 ? '' : url.host.slice(dot) };
  } catch {
    return { prefix: 'https://', suffix: '' };
  }
}

type Availability = 'idle' | 'checking' | 'available' | 'taken';

export function PublishDialog({ project }: { project: Project }) {
  const t = useT('workspace');
  const tc = useT('common');
  const errorMessage = useErrorMessage();
  const open = useWorkspace((s) => s.panels.publish);
  const setPanel = useWorkspace((s) => s.setPanel);
  const generating = useWorkspace((s) => s.generating);
  const publish = usePublish(project.id);
  const unpublish = useUnpublish(project.id);

  const [slug, setSlug] = useState('');
  const [availability, setAvailability] = useState<Availability>('idle');
  const [reason, setReason] = useState<string | null>(null);
  const [buildErrors, setBuildErrors] = useState<BuildErrorInfo[]>([]);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const [copied, setCopied] = useState(false);

  const { prefix, suffix } = useMemo(() => hostParts(project.previewUrl), [project.previewUrl]);
  const isPublished = Boolean(project.publishedSlug);
  const upToDate = isPublished && project.publishedVersionId === project.currentVersionId && !project.hasUncommittedChanges;
  const localError = slug ? slugError(slug) : null;

  // Prefill with the current slug or a free one derived from the name.
  useEffect(() => {
    if (!open) return;
    setBuildErrors([]);
    if (project.publishedSlug) {
      setSlug(project.publishedSlug);
      return;
    }
    let cancelled = false;
    const base = slugify(project.name);
    void (async () => {
      for (const candidate of [base, `${base}-2`, `${base}-3`, `${base.slice(0, 34)}-${Math.random().toString(36).slice(2, 6)}`]) {
        try {
          const res = await api.publish.slugAvailable(candidate, project.id);
          if (cancelled) return;
          if (res.available) {
            setSlug(candidate);
            return;
          }
        } catch {
          break;
        }
      }
      if (!cancelled) setSlug(base);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Debounced availability check.
  useEffect(() => {
    if (!open || !slug || localError) {
      setAvailability('idle');
      setReason(null);
      return;
    }
    if (slug === project.publishedSlug) {
      setAvailability('available');
      return;
    }
    setAvailability('checking');
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api.publish
        .slugAvailable(slug, project.id, { signal: controller.signal })
        .then((res) => {
          setAvailability(res.available ? 'available' : 'taken');
          setReason(res.available ? null : (res.reason ?? null));
        })
        .catch(() => setAvailability('idle'));
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [localError, open, project.id, project.publishedSlug, slug]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!slug || localError || availability === 'taken') return;
    setBuildErrors([]);
    publish.mutate(
      { slug },
      {
        onSuccess: () => toast.success(t('publish.success')),
        onError: (err) => {
          const details = isApiError(err) ? (err.details as { errors?: BuildErrorInfo[] } | null) : null;
          if (details?.errors?.length) setBuildErrors(details.errors);
          else toast.error(errorMessage(err));
        },
      },
    );
  };

  const fixWithAi = () => {
    const runtimeErrors: PreviewError[] = buildErrors.slice(0, 10).map((e) => ({
      kind: 'build',
      message: e.message,
      stack: e.lineText,
      source: e.file,
      line: e.line,
      column: e.column,
      timestamp: Date.now(),
    }));
    useWorkspace.getState().queueChat({ message: t('publish.fixRequest'), intent: 'fix', runtimeErrors });
    setPanel('publish', false);
  };

  const liveUrl = project.publishedUrl;

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => setPanel('publish', v)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rocket className="size-4" />
              {t('publish.title')}
            </DialogTitle>
            <DialogDescription>{t('publish.description')}</DialogDescription>
          </DialogHeader>

          {liveUrl ? (
            <div className="rounded-xl border border-border bg-muted/40 p-3">
              <p className="text-[12px] text-muted-foreground">{t('publish.liveAt')}</p>
              <a href={liveUrl} target="_blank" rel="noreferrer" className="mt-0.5 block truncate font-mono text-[13px] font-medium underline-offset-4 hover:underline">
                {liveUrl}
              </a>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void copyToClipboard(liveUrl).then(() => {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1500);
                    });
                  }}
                >
                  {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                  {t('publish.copy')}
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={liveUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-3.5" />
                    {t('publish.open')}
                  </a>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a
                    href={`https://t.me/share/url?url=${encodeURIComponent(liveUrl)}&text=${encodeURIComponent(t('publish.telegramText', { name: project.name }))}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Send className="size-3.5" />
                    {t('publish.telegram')}
                  </a>
                </Button>
              </div>
              <p className={cn('mt-3 flex items-center gap-1.5 text-[12.5px]', upToDate ? 'text-success' : 'text-warning')}>
                {upToDate ? <CircleCheck className="size-3.5" /> : <TriangleAlert className="size-3.5" />}
                {upToDate
                  ? t('publish.upToDate')
                  : t('publish.behind', { live: project.publishedVersionNumber ?? '?', latest: project.currentVersionNumber ?? '?' })}
              </p>
            </div>
          ) : null}

          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="publish-slug">{t('publish.address')}</Label>
              <div className={cn('flex items-center rounded-lg border bg-background font-mono text-[13px] focus-within:ring-2 focus-within:ring-ring/40', localError || availability === 'taken' ? 'border-destructive' : 'border-input')}>
                <span className="shrink-0 pl-3 text-muted-foreground">{prefix}</span>
                <input
                  id="publish-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40))}
                  spellCheck={false}
                  autoComplete="off"
                  aria-invalid={Boolean(localError) || availability === 'taken'}
                  className="h-9 min-w-0 flex-1 bg-transparent px-0.5 outline-none"
                />
                <span className="shrink-0 truncate pr-3 text-muted-foreground">{suffix}</span>
              </div>
              <p className="flex min-h-4 items-center gap-1.5 text-[12px]">
                {localError ? (
                  <span className="text-destructive">{localError}</span>
                ) : availability === 'checking' ? (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <LoaderCircle className="size-3 animate-spin" />
                    {t('publish.checking')}
                  </span>
                ) : availability === 'taken' ? (
                  <span className="text-destructive">{reason ?? t('publish.taken')}</span>
                ) : availability === 'available' && slug !== project.publishedSlug ? (
                  <span className="inline-flex items-center gap-1.5 text-success">
                    <Check className="size-3" />
                    {t('publish.available')}
                  </span>
                ) : null}
              </p>
            </div>

            {buildErrors.length > 0 ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-[13px]" role="alert">
                <p className="font-medium">{t('publish.buildFailed')}</p>
                <ul className="mt-1.5 space-y-1">
                  {buildErrors.slice(0, 4).map((e, i) => (
                    <li key={i} className="break-words font-mono text-[11.5px] text-muted-foreground">
                      {e.file ? <span className="text-foreground">{e.file}{e.line ? `:${e.line}` : ''} </span> : null}
                      {e.message}
                    </li>
                  ))}
                </ul>
                <Button type="button" size="sm" variant="gradient" className="mt-2.5" onClick={fixWithAi}>
                  <WandSparkles className="size-3.5" />
                  {tc('terms.fixWithAi')}
                </Button>
              </div>
            ) : null}

            <p className="text-[12px] text-muted-foreground">{t('publish.note')}</p>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              {isPublished ? (
                <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmUnpublish(true)}>
                  {t('publish.unpublish')}
                </Button>
              ) : (
                <span />
              )}
              <Button
                type="submit"
                variant="gradient"
                loading={publish.isPending}
                disabled={generating || !slug || Boolean(localError) || availability === 'taken' || availability === 'checking' || (upToDate && slug === project.publishedSlug)}
              >
                <Rocket className="size-4" />
                {publish.isPending ? t('publish.publishing') : isPublished ? t('publish.update') : t('publish.button')}
              </Button>
            </div>
          </form>
          {isPublished ? <DomainsSection project={project} enabled={open} /> : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmUnpublish}
        onOpenChange={setConfirmUnpublish}
        title={t('publish.unpublishTitle')}
        description={t('publish.unpublishDescription')}
        confirmLabel={t('publish.unpublish')}
        destructive
        onConfirm={async () => {
          try {
            await unpublish.mutateAsync();
            toast.success(t('publish.unpublished'));
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </>
  );
}
