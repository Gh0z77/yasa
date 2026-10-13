import { Check, Cloud, CodeXml, Database, Download, Eye, GitBranch, GitFork, History, PanelLeft, Rocket, Share2 } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { Project } from '@shared/types';
import { LogoMark } from '@/components/common/Logo';
import { loginUrl } from '@/components/common/ProtectedRoute';
import { UserMenu } from '@/components/common/UserMenu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/tooltip';
import { useErrorMessage, useT } from '@/i18n';
import { api } from '@/lib/api';
import { useMe, useRemixProject } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useWorkspace } from './store';

export function TopBar(props: { project: Project; isOwner: boolean; canEdit: boolean; onToggleChat(): void }) {
  const { project, isOwner, canEdit } = props;
  const t = useT('workspace');
  const errorMessage = useErrorMessage();
  const navigate = useNavigate();
  const location = useLocation();
  const me = useMe();
  const remix = useRemixProject();
  const view = useWorkspace((s) => s.view);
  const setPanel = useWorkspace((s) => s.setPanel);

  const isPublished = Boolean(project.publishedSlug);
  const upToDate = isPublished && project.publishedVersionId === project.currentVersionId && !project.hasUncommittedChanges;

  const doRemix = () => {
    if (!me.data) {
      void navigate(loginUrl(location.pathname));
      return;
    }
    remix.mutate(project.id, {
      onSuccess: ({ project: copy }) => {
        toast.success(t('topbar.remixed'));
        void navigate(`/project/${copy.id}`);
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  const iconButton = 'grid size-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground';

  return (
    <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-background px-2 sm:px-3">
      <Hint label={t('topbar.back')}>
        <Link to="/" aria-label={t('topbar.back')} className="grid size-8 shrink-0 place-items-center rounded-lg transition hover:bg-muted">
          <LogoMark className="size-6" />
        </Link>
      </Hint>

      <Hint label={t('topbar.toggleChat')} shortcut="Ctrl+B">
        <button type="button" onClick={props.onToggleChat} aria-label={t('topbar.toggleChat')} className={cn(iconButton, 'hidden md:grid')}>
          <PanelLeft className="size-4" />
        </button>
      </Hint>

      <button
        type="button"
        onClick={() => setPanel('settings', true)}
        title={t('topbar.rename')}
        className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium transition hover:bg-muted"
      >
        <span aria-hidden className="text-base leading-none">{project.emoji}</span>
        <span className="truncate">{project.name}</span>
      </button>
      {!isOwner ? (
        <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex">
          {canEdit ? t('topbar.sharedEditor') : t('topbar.readOnly')}
        </Badge>
      ) : null}

      <div className="flex-1" />

      {/* Preview | Code */}
      <div className="hidden items-center rounded-lg bg-muted p-0.5 md:flex" role="group">
        {([
          { id: 'preview', label: t('tabs.preview'), icon: Eye },
          { id: 'code', label: t('tabs.code'), icon: CodeXml },
          ...(isOwner ? [{ id: 'cloud', label: t('tabs.cloud'), icon: Cloud } as const] : []),
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-pressed={view === id}
            onClick={() => useWorkspace.getState().setView(id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium transition',
              view === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" />
            <span className="hidden lg:inline">{label}</span>
          </button>
        ))}
      </div>

      <div className="flex-1" />

      <Hint label={t('topbar.history')}>
        <button type="button" onClick={() => setPanel('history', true)} aria-label={t('topbar.history')} className={iconButton}>
          <History className="size-4" />
        </button>
      </Hint>
      <Hint label={t('topbar.download')}>
        <a href={api.projects.downloadUrl(project.id)} aria-label={t('topbar.download')} className={iconButton}>
          <Download className="size-4" />
        </a>
      </Hint>

      {isOwner ? (
        <>
          <Hint label={t('topbar.supabase')}>
            <button type="button" onClick={() => setPanel('supabase', true)} aria-label={t('topbar.supabase')} className={iconButton}>
              <Database className="size-4" />
            </button>
          </Hint>
          <Hint label={t('topbar.github')}>
            <button type="button" onClick={() => setPanel('github', true)} aria-label={t('topbar.github')} className={iconButton}>
              <GitBranch className="size-4" />
            </button>
          </Hint>
          <Hint label={t('topbar.share')}>
            <button type="button" onClick={() => setPanel('share', true)} aria-label={t('topbar.share')} className={iconButton}>
              <Share2 className="size-4" />
            </button>
          </Hint>
          <Button size="sm" variant={upToDate ? 'outline' : 'gradient'} onClick={() => setPanel('publish', true)} className="relative ml-1 shrink-0">
            {upToDate ? <Check className="size-3.5 text-success" /> : <Rocket className="size-3.5" />}
            <span className="hidden sm:inline">{upToDate ? t('topbar.published') : isPublished ? t('topbar.update') : t('topbar.publish')}</span>
            {isPublished && !upToDate ? <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-warning ring-2 ring-background" /> : null}
          </Button>
        </>
      ) : (
        <Hint label={t('topbar.remixHint')}>
          <Button size="sm" variant="gradient" onClick={doRemix} loading={remix.isPending} className="ml-1 shrink-0">
            <GitFork className="size-3.5" />
            {t('topbar.remix')}
          </Button>
        </Hint>
      )}

      <div className="ml-1 shrink-0">
        {me.data ? (
          <UserMenu />
        ) : (
          <Button size="sm" variant="ghost" asChild>
            <Link to={loginUrl(location.pathname)}>{t('topbar.login')}</Link>
          </Button>
        )}
      </div>
    </header>
  );
}
