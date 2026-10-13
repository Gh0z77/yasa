import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { LIMITS } from '@shared/constants';
import type { Project } from '@shared/types';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useErrorMessage, useT } from '@/i18n';
import { useDeleteProject, useUpdateProject } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useWorkspace } from './store';

const EMOJIS = [
  '✨', '🚀', '🎨', '🛒', '📚', '📝', '✅', '📊', '💬', '🎵', '🎮', '📷',
  '🍕', '☕', '🫖', '🍰', '🏠', '🏢', '🏥', '🎓', '💼', '💰', '🧮', '⏱️',
  '🌍', '✈️', '🚗', '🏋️', '⚽', '🌱', '🐾', '❤️', '⭐', '🔥', '⚡', '🔔',
  '🗓️', '📦', '🧩', '🛠️', '🔒', '🤖', '🧠', '💡', '🎁', '💍', '🕌', '🌙',
];

export function ProjectSettingsDialog({ project, isOwner }: { project: Project; isOwner: boolean }) {
  const t = useT('workspace');
  const tc = useT('common');
  const errorMessage = useErrorMessage();
  const navigate = useNavigate();
  const open = useWorkspace((s) => s.panels.settings);
  const setPanel = useWorkspace((s) => s.setPanel);
  const update = useUpdateProject();
  const remove = useDeleteProject();
  const generating = useWorkspace((s) => s.generating);

  const [name, setName] = useState(project.name);
  const [emoji, setEmoji] = useState(project.emoji);
  const [description, setDescription] = useState(project.description);
  const [instructions, setInstructions] = useState(project.customInstructions);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(project.name);
    setEmoji(project.emoji);
    setDescription(project.description);
    setInstructions(project.customInstructions);
  }, [open, project.customInstructions, project.description, project.emoji, project.name]);

  const close = () => setPanel('settings', false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    update.mutate(
      { id: project.id, name: name.trim(), emoji: emoji.trim() || '✨', description: description.trim(), customInstructions: instructions },
      {
        onSuccess: () => {
          toast.success(t('settings.saved'));
          close();
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => setPanel('settings', v)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{t('settings.title')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="project-emoji">{t('settings.emoji')}</Label>
                <Input
                  id="project-emoji"
                  value={emoji}
                  onChange={(e) => setEmoji([...e.target.value].slice(-2).join(''))}
                  disabled={!isOwner}
                  className="w-16 text-center text-lg"
                  aria-label={t('settings.emoji')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="project-name">{t('settings.name')}</Label>
                <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.projectNameMax} disabled={!isOwner} required />
              </div>
            </div>

            {isOwner ? (
              <div className="grid grid-cols-8 gap-1 sm:grid-cols-12" role="listbox" aria-label={t('settings.emoji')}>
                {EMOJIS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    role="option"
                    aria-selected={emoji === item}
                    onClick={() => setEmoji(item)}
                    className={cn('grid aspect-square place-items-center rounded-lg text-lg transition hover:bg-muted', emoji === item && 'bg-muted ring-2 ring-ring')}
                  >
                    {item}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="project-description">{t('settings.description')}</Label>
              <Input
                id="project-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={LIMITS.descriptionMax}
                placeholder={t('settings.descriptionPlaceholder')}
                disabled={!isOwner}
              />
            </div>

            {isOwner ? (
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <Label htmlFor="project-instructions">{t('settings.instructions')}</Label>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {instructions.length}/{LIMITS.customInstructionsMax}
                  </span>
                </div>
                <Textarea
                  id="project-instructions"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  maxLength={LIMITS.customInstructionsMax}
                  rows={5}
                  placeholder={t('settings.instructionsPlaceholder')}
                />
                <p className="text-[12px] text-muted-foreground">{t('settings.instructionsHint')}</p>
              </div>
            ) : null}

            {isOwner ? (
              <div className="rounded-xl border border-destructive/30 p-3">
                <p className="text-[13px] font-medium text-destructive">{t('settings.danger')}</p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[12.5px] text-muted-foreground">{t('settings.deleteHint')}</p>
                  <Button type="button" size="sm" variant="destructive" disabled={generating} onClick={() => setConfirmDelete(true)}>
                    {t('settings.delete')}
                  </Button>
                </div>
              </div>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close}>
                {isOwner ? tc('actions.cancel') : tc('actions.close')}
              </Button>
              {isOwner ? (
                <Button type="submit" loading={update.isPending} disabled={!name.trim()}>
                  {tc('actions.save')}
                </Button>
              ) : null}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={tc('confirm.deleteTitle', { name: project.name })}
        description={tc('confirm.deleteDescription')}
        confirmLabel={tc('actions.delete')}
        destructive
        onConfirm={async () => {
          try {
            await remove.mutateAsync(project.id);
            toast.success(t('settings.deleted'));
            close();
            void navigate('/projects');
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </>
  );
}
