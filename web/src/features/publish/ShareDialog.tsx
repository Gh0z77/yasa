import { useState } from 'react';
import { Check, Copy, Globe, Link2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { Project } from '@shared/types';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { MembersSection } from '@/features/collab/MembersSection';
import { useWorkspace } from '@/features/workspace/store';
import { useErrorMessage, useT } from '@/i18n';
import { useRotatePreviewToken, useUpdateProject } from '@/lib/queries';
import { copyToClipboard } from '@/lib/utils';

function CopyField({ id, value, label }: { id: string; value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <input id={id} readOnly value={value} onFocus={(e) => e.currentTarget.select()} className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-muted/40 px-3 font-mono text-[12px] outline-none" />
      <Button
        type="button"
        size="icon"
        variant="outline"
        aria-label={label}
        title={label}
        onClick={() => {
          void copyToClipboard(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
      </Button>
    </div>
  );
}

export function ShareDialog({ project }: { project: Project }) {
  const t = useT('workspace');
  const tc = useT('common');
  const errorMessage = useErrorMessage();
  const open = useWorkspace((s) => s.panels.share);
  const setPanel = useWorkspace((s) => s.setPanel);
  const update = useUpdateProject();
  const rotate = useRotatePreviewToken(project.id);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmPublic, setConfirmPublic] = useState(false);

  const isPublic = project.visibility === 'public';
  const projectLink = `${window.location.origin}/project/${project.id}`;

  const setVisibility = async (visibility: 'public' | 'private') => {
    try {
      await update.mutateAsync({ id: project.id, visibility });
      toast.success(visibility === 'public' ? t('share.nowPublic') : t('share.nowPrivate'));
      // Going private rotates the preview link on the server: show the new one.
      if (visibility === 'private') useWorkspace.getState().reloadPreview();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => setPanel('share', v)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{t('share.title')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="share-preview" className="flex items-center gap-1.5">
                <Link2 className="size-3.5" />
                {t('share.previewLink')}
              </Label>
              <CopyField id="share-preview" value={project.previewUrl} label={tc('actions.copyLink')} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12px] text-muted-foreground">{t('share.previewHint')}</p>
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmReset(true)}>
                  <RefreshCw className="size-3.5" />
                  {t('share.reset')}
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-border p-3">
              <div className="flex items-start gap-3">
                <Globe className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <Label htmlFor="share-public" className="text-[13px]">{t('share.visibility')}</Label>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">{t('share.visibilityHint')}</p>
                </div>
                <Switch
                  id="share-public"
                  checked={isPublic}
                  disabled={update.isPending}
                  onCheckedChange={(checked) => {
                    if (checked) setConfirmPublic(true);
                    else void setVisibility('private');
                  }}
                />
              </div>
              {isPublic ? (
                <div className="mt-3 space-y-1.5">
                  <Label htmlFor="share-project" className="text-[12px] text-muted-foreground">{t('share.projectLink')}</Label>
                  <CopyField id="share-project" value={projectLink} label={tc('actions.copyLink')} />
                </div>
              ) : null}
            </div>

            <MembersSection project={project} enabled={open} />
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={t('share.resetTitle')}
        description={t('share.resetDescription')}
        confirmLabel={t('share.reset')}
        destructive
        onConfirm={async () => {
          try {
            await rotate.mutateAsync();
            toast.success(t('share.resetDone'));
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
      <ConfirmDialog
        open={confirmPublic}
        onOpenChange={setConfirmPublic}
        title={t('share.publicTitle')}
        description={t('share.publicDescription')}
        confirmLabel={t('share.makePublic')}
        onConfirm={() => setVisibility('public')}
      />
    </>
  );
}
