import { useEffect, useId, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { Copy, Ellipsis, FolderOpen, Globe, Pencil, Rocket, Trash } from 'lucide-react';
import { toast } from 'sonner';
import { LIMITS } from '@shared/constants';
import type { ProjectSummary } from '@shared/types';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorMessage, useLocale, useT } from '@/i18n';
import { relativeTime } from '@/lib/format';
import { useDeleteProject, useDuplicateProject, useUpdateProject } from '@/lib/queries';
import { cn, hashString } from '@/lib/utils';

const FALLBACK_EMOJI = '✨';

/** Deterministic cover art: the brand gradient rotated in angle and hue by a hash of the project id. */
function coverStyle(id: string): CSSProperties {
  const seed = Math.abs(hashString(id));
  const angle = seed % 360;
  const hue = (seed >>> 4) % 360;
  const mid = 35 + ((seed >>> 9) % 30);
  return {
    backgroundImage: `linear-gradient(${angle}deg, var(--brand-from) 0%, var(--brand-via) ${mid}%, var(--brand-to) 100%)`,
    filter: `hue-rotate(${hue}deg)`,
  };
}

export function ProjectCover({
  id,
  emoji,
  className,
  children,
}: {
  id: string;
  emoji: string;
  className?: string;
  /** Overlays (badges) rendered above the art. */
  children?: ReactNode;
}) {
  return (
    <div className={cn('relative aspect-[16/10] overflow-hidden bg-card', className)}>
      <div
        aria-hidden
        className="absolute inset-0 opacity-45 transition-opacity duration-300 group-hover:opacity-60 dark:opacity-35 dark:group-hover:opacity-50"
        style={coverStyle(id)}
      />
      <div aria-hidden className="absolute inset-0 bg-grid opacity-20" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-card/50 to-transparent" />
      <span
        aria-hidden
        className="absolute inset-0 flex select-none items-center justify-center text-5xl drop-shadow-md transition-transform duration-300 ease-out group-hover:scale-110 sm:text-6xl"
      >
        {emoji || FALLBACK_EMOJI}
      </span>
      {children}
    </div>
  );
}

/** Shared frame of project cards (own projects and community). */
export const projectCardFrame =
  'group relative flex flex-col overflow-hidden rounded-3xl border border-border bg-card text-card-foreground shadow-xs backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-[color:color-mix(in_oklab,var(--brand-to)_45%,transparent)] hover:shadow-lg focus-within:border-foreground/15';

/** Link whose hit area covers the whole card (put inside a `relative` card). */
export const stretchedLink =
  'rounded-sm outline-none after:absolute after:inset-0 after:rounded-2xl after:content-[""] focus-visible:after:ring-[3px] focus-visible:after:ring-ring/45';

export function ProjectCard({ project, className }: { project: ProjectSummary; className?: string }) {
  const t = useT('home');
  const tc = useT('common');
  const { locale } = useLocale();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();

  const duplicateProject = useDuplicateProject();
  const deleteProject = useDeleteProject();

  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const name = project.name.trim() || t('card.untitled');
  const href = `/project/${project.id}`;

  const duplicate = () => {
    duplicateProject.mutate(project.id, {
      onSuccess: () => toast.success(t('card.duplicated', { name })),
      onError: (error) => toast.error(errorMessage(error)),
    });
  };

  const remove = async () => {
    try {
      await deleteProject.mutateAsync(project.id);
      toast.success(t('card.deleted'));
    } catch (error) {
      toast.error(errorMessage(error));
      throw error; // keeps the confirm dialog open
    }
  };

  return (
    <article className={cn(projectCardFrame, className)}>
      <ProjectCover id={project.id} emoji={project.emoji}>
        {project.publishedUrl || project.visibility === 'public' ? (
          <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
            {project.publishedUrl ? (
              <Badge variant="success" className="backdrop-blur-sm">
                <Rocket />
                {tc('terms.published')}
              </Badge>
            ) : null}
            {project.visibility === 'public' ? (
              <Badge variant="secondary" className="backdrop-blur-sm">
                <Globe />
                {tc('terms.public')}
              </Badge>
            ) : null}
          </div>
        ) : null}
      </ProjectCover>

      <div className="flex items-start gap-2 border-t border-border/60 p-3.5 sm:p-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold leading-6 sm:text-base">
            <Link to={href} className={stretchedLink} title={name}>
              {name}
            </Link>
          </h3>
          <p className="truncate text-xs text-muted-foreground sm:text-sm">
            {t('card.updated', { time: relativeTime(project.updatedAt, locale) })}
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('card.menu')}
              className="relative z-10 -mr-1 shrink-0 text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={() => void navigate(href)}>
              <FolderOpen />
              {t('card.open')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
              <Pencil />
              {tc('actions.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={duplicateProject.isPending} onSelect={duplicate}>
              <Copy />
              {tc('actions.duplicate')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
              <Trash />
              {tc('actions.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <RenameProjectDialog project={project} open={renameOpen} onOpenChange={setRenameOpen} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        destructive
        title={t('card.deleteTitle', { name })}
        description={t('card.deleteDescription')}
        confirmLabel={tc('actions.delete')}
        onConfirm={remove}
      />
    </article>
  );
}

function RenameProjectDialog({
  project,
  open,
  onOpenChange,
}: {
  project: ProjectSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT('home');
  const tc = useT('common');
  const errorMessage = useErrorMessage();
  const updateProject = useUpdateProject();
  const fieldId = useId();

  const [value, setValue] = useState(project.name);
  const [touched, setTouched] = useState(false);

  // Start from the current name every time the dialog opens.
  useEffect(() => {
    if (open) {
      setValue(project.name);
      setTouched(false);
    }
  }, [open, project.name]);

  const trimmed = value.trim();
  const error =
    trimmed.length === 0
      ? t('rename.required')
      : trimmed.length > LIMITS.projectNameMax
        ? t('rename.tooLong', { max: LIMITS.projectNameMax })
        : null;
  const showError = touched && error !== null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (error || updateProject.isPending) return;
    if (trimmed === project.name) {
      onOpenChange(false);
      return;
    }
    updateProject.mutate(
      { id: project.id, name: trimmed },
      {
        onSuccess: () => {
          toast.success(t('card.renamed'));
          onOpenChange(false);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (updateProject.isPending && !next ? undefined : onOpenChange(next))}>
      <DialogContent size="sm">
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{t('rename.title')}</DialogTitle>
            <DialogDescription>{t('rename.description')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor={fieldId}>{t('rename.label')}</Label>
            <Input
              id={fieldId}
              autoFocus
              value={value}
              maxLength={LIMITS.projectNameMax + 20}
              placeholder={t('rename.placeholder')}
              aria-invalid={showError}
              aria-describedby={showError ? `${fieldId}-error` : undefined}
              onChange={(event) => setValue(event.target.value)}
              onBlur={() => setTouched(true)}
              onFocus={(event) => event.target.select()}
            />
            {showError ? (
              <p id={`${fieldId}-error`} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={updateProject.isPending} onClick={() => onOpenChange(false)}>
              {tc('actions.cancel')}
            </Button>
            <Button type="submit" loading={updateProject.isPending}>
              {tc('actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col overflow-hidden rounded-3xl border border-border bg-card backdrop-blur-xl', className)}>
      <Skeleton className="aspect-[16/10] w-full rounded-none" />
      <div className="flex flex-col gap-2 border-t border-border/60 p-3.5 sm:p-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
      </div>
    </div>
  );
}

/** Responsive grid shared by Home, Projects and Community. */
export function ProjectGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3', className)}>{children}</div>;
}
