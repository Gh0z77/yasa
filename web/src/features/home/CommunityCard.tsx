import { Link, useNavigate } from 'react-router';
import { ExternalLink, Eye, GitFork } from 'lucide-react';
import { toast } from 'sonner';
import type { CommunityProject } from '@shared/types';
import { loginUrl } from '@/components/common/ProtectedRoute';
import { UserAvatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorMessage, useLocale, useT } from '@/i18n';
import { formatNumber } from '@/lib/format';
import { useMe, useRemixProject } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { ProjectCover, projectCardFrame, stretchedLink } from './ProjectCard';

export interface CommunityCardProps {
  project: CommunityProject;
  /** Where a guest returns after logging in to remix (default "/community"). */
  loginNext?: string;
  /** Hide the action row (used in compact showcases). */
  hideActions?: boolean;
  className?: string;
}

/** Public project card: owner, remix count, "Open app" / "Remix" / "View". */
export function CommunityCard({ project, loginNext = '/community', hideActions = false, className }: CommunityCardProps) {
  const t = useT('home');
  const tc = useT('common');
  const { locale } = useLocale();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const { data: user } = useMe();
  const remixProject = useRemixProject();

  const name = project.name.trim() || t('card.untitled');
  const href = `/project/${project.id}`;
  const remixes = tc('count.remixes', { count: project.remixCount });

  const remix = () => {
    if (!user) {
      toast.info(t('community.loginToRemix'));
      void navigate(loginUrl(loginNext));
      return;
    }
    remixProject.mutate(project.id, {
      onSuccess: ({ project: copy }) => {
        toast.success(t('community.remixed'));
        void navigate(`/project/${copy.id}`);
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  };

  return (
    <article className={cn(projectCardFrame, className)}>
      <ProjectCover id={project.id} emoji={project.emoji} />

      <div className="flex flex-1 flex-col gap-3 border-t border-border/60 p-3.5 sm:p-4">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold leading-6 sm:text-base">
            <Link to={href} className={stretchedLink} title={name}>
              {name}
            </Link>
          </h3>
          {project.description ? (
            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{project.description}</p>
          ) : null}
        </div>

        <div className="mt-auto flex items-center gap-2 text-xs text-muted-foreground sm:text-sm">
          <UserAvatar name={project.ownerName} seed={project.ownerId} className="size-5 text-[9px]" />
          <span className="min-w-0 flex-1 truncate">{t('community.by', { name: project.ownerName })}</span>
          <span className="inline-flex shrink-0 items-center gap-1 tabular-nums" title={remixes}>
            <GitFork className="size-3.5" aria-hidden />
            <span aria-hidden>{formatNumber(project.remixCount, locale, { compact: true })}</span>
            <span className="sr-only">{remixes}</span>
          </span>
        </div>

        {hideActions ? null : (
          <div className="relative z-10 flex flex-wrap items-center gap-2">
            <Button size="sm" loading={remixProject.isPending} onClick={remix} title={t('community.remixHint')}>
              <GitFork />
              {t('community.remix')}
            </Button>
            {project.publishedUrl ? (
              <Button size="sm" variant="outline" asChild>
                <a href={project.publishedUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink />
                  {t('community.openApp')}
                </a>
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" asChild className="ml-auto text-muted-foreground hover:text-foreground">
              <Link to={href}>
                <Eye />
                {t('community.view')}
              </Link>
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}

export function CommunityCardSkeleton({ hideActions = false, className }: { hideActions?: boolean; className?: string }) {
  return (
    <div className={cn('flex flex-col overflow-hidden rounded-3xl border border-border bg-card backdrop-blur-xl', className)}>
      <Skeleton className="aspect-[16/10] w-full rounded-none" />
      <div className="flex flex-col gap-3 border-t border-border/60 p-3.5 sm:p-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        {hideActions ? null : <Skeleton className="h-8 w-28" />}
      </div>
    </div>
  );
}
