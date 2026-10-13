import { useEffect, useMemo, useState } from 'react';
import { diffLines } from 'diff';
import { ChevronRight, Download, ExternalLink, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { versionPreviewUrl } from '@shared/paths';
import type { Project, VersionFileDiff, VersionSummary } from '@shared/types';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Spinner } from '@/components/common/Spinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useWorkspace } from '@/features/workspace/store';
import { useErrorMessage, useLocale, useT } from '@/i18n';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useCreateVersion, useRestoreVersion, useVersionDiff, useVersions } from '@/lib/queries';
import { cn } from '@/lib/utils';

const CONTEXT = 3;

interface Row {
  kind: 'add' | 'del' | 'ctx' | 'gap';
  text: string;
}

/** Unified rows with collapsed unchanged regions. */
function diffRows(before: string, after: string, gapLabel: (n: number) => string): Row[] {
  const rows: Row[] = [];
  const parts = diffLines(before, after);
  parts.forEach((part, index) => {
    const lines = part.value.replace(/\n$/, '').split('\n');
    if (part.added) for (const text of lines) rows.push({ kind: 'add', text });
    else if (part.removed) for (const text of lines) rows.push({ kind: 'del', text });
    else {
      const first = index === 0;
      const last = index === parts.length - 1;
      const head = first ? 0 : CONTEXT;
      const tail = last ? 0 : CONTEXT;
      if (lines.length <= head + tail + 1) {
        for (const text of lines) rows.push({ kind: 'ctx', text });
      } else {
        for (const text of lines.slice(0, head)) rows.push({ kind: 'ctx', text });
        rows.push({ kind: 'gap', text: gapLabel(lines.length - head - tail) });
        for (const text of lines.slice(lines.length - tail)) rows.push({ kind: 'ctx', text });
      }
    }
  });
  return rows;
}

function FileDiff({ diff }: { diff: VersionFileDiff }) {
  const t = useT('workspace');
  const [open, setOpen] = useState(true);
  const rows = useMemo(
    () => (diff.encoding === 'base64' ? [] : diffRows(diff.before ?? '', diff.after ?? '', (n) => t('history.unchanged', { count: n }))),
    [diff, t],
  );
  const added = rows.filter((r) => r.kind === 'add').length;
  const removed = rows.filter((r) => r.kind === 'del').length;
  const variant = diff.status === 'added' ? 'success' : diff.status === 'deleted' ? 'destructive' : 'secondary';

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 bg-muted/50 px-3 py-2 text-left hover:bg-muted">
        <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{diff.path}</span>
        <span className="shrink-0 font-mono text-[11px]">
          {added ? <span className="text-success">+{added} </span> : null}
          {removed ? <span className="text-destructive">−{removed}</span> : null}
        </span>
        <Badge variant={variant} className="shrink-0 text-[10px]">{t(`history.${diff.status}`)}</Badge>
      </button>
      {open ? (
        diff.encoding === 'base64' ? (
          <p className="px-3 py-2 text-[12px] text-muted-foreground">{t('history.binary')}</p>
        ) : (
          <div className="scrollbar-thin max-h-96 overflow-auto font-mono text-[11.5px] leading-relaxed">
            {rows.map((row, i) =>
              row.kind === 'gap' ? (
                <div key={i} className="border-y border-border/60 bg-muted/40 px-3 py-0.5 text-center font-sans text-[11px] text-muted-foreground">{row.text}</div>
              ) : (
                <div
                  key={i}
                  className={cn(
                    'flex whitespace-pre px-1',
                    row.kind === 'add' && 'bg-success/10 text-foreground',
                    row.kind === 'del' && 'bg-destructive/10 text-foreground',
                    row.kind === 'ctx' && 'text-muted-foreground',
                  )}
                >
                  <span className={cn('w-4 shrink-0 select-none text-center', row.kind === 'add' && 'text-success', row.kind === 'del' && 'text-destructive')}>
                    {row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '}
                  </span>
                  <span className="min-w-0">{row.text || ' '}</span>
                </div>
              ),
            )}
          </div>
        )
      ) : null}
    </div>
  );
}

export function HistoryDrawer({ project, isOwner }: { project: Project; isOwner: boolean }) {
  const t = useT('workspace');
  const tc = useT('common');
  const { locale } = useLocale();
  const errorMessage = useErrorMessage();
  const open = useWorkspace((s) => s.panels.history);
  const setPanel = useWorkspace((s) => s.setPanel);
  const generating = useWorkspace((s) => s.generating);
  const versions = useVersions(project.id, { enabled: open });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<VersionSummary | null>(null);
  const restore = useRestoreVersion(project.id);
  const createVersion = useCreateVersion(project.id);

  const list = versions.data ?? [];
  const selected = list.find((v) => v.id === selectedId) ?? null;
  const diff = useVersionDiff(project.id, open ? selectedId : null);

  useEffect(() => {
    if (open && !selectedId && list.length > 0) setSelectedId(list[0].id);
    if (!open) setSelectedId(null);
  }, [open, list, selectedId]);

  const doRestore = async (version: VersionSummary) => {
    try {
      const { files } = await restore.mutateAsync(version.id);
      const store = useWorkspace.getState();
      store.setFiles(files);
      store.setBuild(null);
      store.reloadPreview();
      toast.success(t('history.restored', { n: version.number }));
      setSelectedId(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={(v) => setPanel('history', v)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-3xl">
          <SheetHeader className="border-b border-border px-5 py-4">
            <SheetTitle>{t('history.title')}</SheetTitle>
            <SheetDescription>{t('history.description')}</SheetDescription>
          </SheetHeader>

          {isOwner && project.hasUncommittedChanges ? (
            <div className="flex flex-wrap items-center gap-3 border-b border-border bg-warning/5 px-5 py-2.5 text-[13px]">
              <span className="min-w-0 flex-1">{t('history.unsaved')}</span>
              <Button
                size="sm"
                variant="outline"
                loading={createVersion.isPending}
                disabled={generating}
                onClick={() =>
                  createVersion.mutate(undefined, {
                    onSuccess: () => toast.success(t('history.savedVersion')),
                    onError: (err) => toast.error(errorMessage(err)),
                  })
                }
              >
                <Save className="size-3.5" />
                {t('history.saveVersion')}
              </Button>
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            {/* version list */}
            <div className="scrollbar-thin max-h-56 shrink-0 overflow-y-auto border-b border-border md:max-h-none md:w-72 md:border-b-0 md:border-r">
              {versions.isPending ? (
                <div className="space-y-2 p-3">
                  {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
                </div>
              ) : list.length === 0 ? (
                <p className="p-5 text-center text-[13px] text-muted-foreground">{t('history.empty')}</p>
              ) : (
                <ul className="p-2">
                  {list.map((version) => {
                    const active = version.id === selectedId;
                    return (
                      <li key={version.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(version.id)}
                          aria-current={active ? 'true' : undefined}
                          className={cn('w-full rounded-lg px-3 py-2 text-left transition', active ? 'bg-muted' : 'hover:bg-muted/60')}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[12px] font-semibold">v{version.number}</span>
                            {version.buildOk === false ? <span className="size-1.5 rounded-full bg-destructive" title={t('history.broken')} /> : null}
                            <Badge variant="outline" className="text-[10px]">{t(`history.sources.${version.source}`)}</Badge>
                            {version.id === project.currentVersionId ? <Badge variant="secondary" className="text-[10px]">{t('history.current')}</Badge> : null}
                            {version.id === project.publishedVersionId ? <Badge variant="success" className="text-[10px]">{t('history.live')}</Badge> : null}
                          </div>
                          <p className="mt-1 line-clamp-2 text-[13px]">{version.summary}</p>
                          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                            {relativeTime(version.createdAt, locale)} · {tc('count.files', { count: version.filesChanged })}
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* details */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {!selected ? (
                <p className="grid flex-1 place-items-center p-6 text-center text-[13px] text-muted-foreground">{t('history.selectHint')}</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
                    <p className="min-w-0 flex-1 truncate text-[13px] font-medium">
                      v{selected.number} · {selected.summary}
                    </p>
                    <Button size="sm" variant="ghost" asChild>
                      <a href={versionPreviewUrl(project.previewUrl, selected.number)} target="_blank" rel="noreferrer">
                        <ExternalLink className="size-3.5" />
                        {t('history.preview')}
                      </a>
                    </Button>
                    <Button size="sm" variant="ghost" asChild>
                      <a href={api.projects.downloadUrl(project.id, selected.id)}>
                        <Download className="size-3.5" />
                        {t('history.download')}
                      </a>
                    </Button>
                    {isOwner && selected.id !== project.currentVersionId ? (
                      <Button size="sm" disabled={generating || restore.isPending} title={generating ? t('history.restoreBlocked') : undefined} onClick={() => setConfirm(selected)}>
                        <RotateCcw className="size-3.5" />
                        {t('history.restore')}
                      </Button>
                    ) : null}
                  </div>
                  <div className="scrollbar-thin min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                    {diff.isPending ? (
                      <div className="grid place-items-center py-10"><Spinner /></div>
                    ) : diff.isError ? (
                      <p className="text-[13px] text-destructive">{errorMessage(diff.error)}</p>
                    ) : (diff.data ?? []).length === 0 ? (
                      <p className="py-8 text-center text-[13px] text-muted-foreground">{t('history.noChanges')}</p>
                    ) : (
                      (diff.data ?? []).map((d) => <FileDiff key={d.path} diff={d} />)
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(v) => {
          if (!v) setConfirm(null);
        }}
        title={t('history.restoreTitle', { n: confirm?.number ?? 0 })}
        description={t('history.restoreDescription')}
        confirmLabel={tc('actions.restore')}
        onConfirm={async () => {
          if (confirm) await doRestore(confirm);
        }}
      />
    </>
  );
}
