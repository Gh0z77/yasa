import { useEffect, useState } from 'react';
import { Code2, Eye, MessageSquare } from 'lucide-react';
import { useParams } from 'react-router';
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from 'react-resizable-panels';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { EmptyState } from '@/components/common/EmptyState';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChatPanel } from '@/features/chat/ChatPanel';
import { CodePanel } from '@/features/code/CodePanel';
import { HistoryDrawer } from '@/features/history/HistoryDrawer';
import { PreviewPanel } from '@/features/preview/PreviewPanel';
import { CloudPanel } from '@/features/collab/CloudPanel';
import { SupabaseDialog } from '@/features/collab/SupabaseDialog';
import { GithubDialog } from '@/features/github/GithubDialog';
import { PublishDialog } from '@/features/publish/PublishDialog';
import { ShareDialog } from '@/features/publish/ShareDialog';
import { ProjectSettingsDialog } from '@/features/workspace/ProjectSettingsDialog';
import { TopBar } from '@/features/workspace/TopBar';
import { useWorkspace } from '@/features/workspace/store';
import { useErrorMessage, useT } from '@/i18n';
import { useProject } from '@/lib/queries';
import { cn } from '@/lib/utils';
import NotFound from './NotFound';

type MobileTab = 'chat' | 'preview' | 'code';

function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)');
    const onChange = () => setDesktop(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return desktop;
}

function WorkspaceSkeleton() {
  return (
    <div className="flex h-dvh flex-col bg-background">
      <div className="flex h-12 items-center gap-3 border-b border-border px-3">
        <Skeleton className="size-7 rounded-lg" />
        <Skeleton className="h-5 w-40" />
        <div className="flex-1" />
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-[32%] min-w-72 flex-col gap-4 border-r border-border p-4 md:flex">
          <Skeleton className="ml-auto h-10 w-2/3 rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
          <div className="flex-1" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
        <div className="flex-1 p-4">
          <Skeleton className="size-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

export default function Workspace() {
  const { id = '' } = useParams();
  const t = useT('workspace');
  const tc = useT('common');
  const errorMessage = useErrorMessage();
  const query = useProject(id);
  const isDesktop = useIsDesktop();
  const view = useWorkspace((s) => s.view);
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat');
  const chatRef = usePanelRef();
  const layout = useDefaultLayout({ id: 'yasa:workspace', storage: localStorage });

  const data = query.data;

  // Keep the store in step with the server, but never clobber files while the AI is writing them.
  useEffect(() => {
    if (!data) return;
    const store = useWorkspace.getState();
    if (store.projectId === data.project.id && store.generating) return;
    store.reset(data.project.id, data.files, data.canEdit);
  }, [data]);

  useEffect(
    () => () => {
      useWorkspace.setState({ projectId: null, generating: false, liveFile: null, selectMode: false, selectedElement: null });
    },
    [id],
  );

  useEffect(() => {
    if (!data) return;
    const previous = document.title;
    document.title = `${data.project.emoji} ${data.project.name} — Yasa`;
    return () => {
      document.title = previous;
    };
  }, [data?.project.emoji, data?.project.name, data]);

  // Ctrl/Cmd+B toggles the chat panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'b') {
        const panel = chatRef.current;
        if (!panel) return;
        e.preventDefault();
        if (panel.isCollapsed()) panel.expand();
        else panel.collapse();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chatRef]);

  // The code view follows the store on mobile too.
  useEffect(() => {
    if (!isDesktop) setMobileTab((tab) => (tab === 'chat' ? tab : view === 'cloud' ? 'preview' : view));
  }, [isDesktop, view]);

  if (query.isPending) return <WorkspaceSkeleton />;
  if (query.isError || !data) {
    const status = query.error?.status;
    if (status === 404 || status === 403) return <NotFound title={t('notFoundTitle')} description={t('notFoundDescription')} />;
    return (
      <div className="grid h-dvh place-items-center bg-background p-6">
        <EmptyState
          title={t('loadFailed')}
          description={query.error ? errorMessage(query.error) : undefined}
          action={<Button onClick={() => void query.refetch()}>{tc('actions.retry')}</Button>}
        />
      </div>
    );
  }

  const { project, isOwner, canEdit } = data;
  // Editors of a shared project work like the owner; owner-only tools stay behind `isOwner`.
  const readOnly = !canEdit;

  const chat = (
    <ErrorBoundary variant="panel">
      <ChatPanel projectId={project.id} readOnly={readOnly} />
    </ErrorBoundary>
  );
  const right = (activeView: 'preview' | 'code' | 'cloud') => (
    <>
      <div className={cn('h-full', activeView !== 'preview' && 'hidden')}>
        <ErrorBoundary variant="panel">
          <PreviewPanel projectId={project.id} previewUrl={project.previewUrl} readOnly={readOnly} />
        </ErrorBoundary>
      </div>
      <div className={cn('h-full', activeView !== 'code' && 'hidden')}>
        <ErrorBoundary variant="panel">
          <CodePanel projectId={project.id} readOnly={readOnly} />
        </ErrorBoundary>
      </div>
      {isOwner ? (
        <div className={cn('h-full', activeView !== 'cloud' && 'hidden')}>
          <ErrorBoundary variant="panel">
            <CloudPanel projectId={project.id} active={activeView === 'cloud'} />
          </ErrorBoundary>
        </div>
      ) : null}
    </>
  );

  const mobileTabs: Array<{ id: MobileTab; label: string; icon: typeof Eye }> = [
    { id: 'chat', label: t('tabs.chat'), icon: MessageSquare },
    { id: 'preview', label: t('tabs.preview'), icon: Eye },
    { id: 'code', label: t('tabs.code'), icon: Code2 },
  ];

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <TopBar project={project} isOwner={isOwner} canEdit={canEdit} onToggleChat={() => (chatRef.current?.isCollapsed() ? chatRef.current.expand() : chatRef.current?.collapse())} />

      {isDesktop ? (
        <Group orientation="horizontal" className="min-h-0 flex-1" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
          <Panel id="chat" panelRef={chatRef} defaultSize="32" minSize={300} maxSize="60" collapsible collapsedSize={0}>
            {chat}
          </Panel>
          <Separator className="group relative w-px bg-border outline-none transition-colors hover:bg-ring data-[separator=active]:bg-ring">
            <span className="absolute inset-y-0 -left-1 -right-1" />
          </Separator>
          <Panel id="main" minSize="30">
            {right(view)}
          </Panel>
        </Group>
      ) : (
        <>
          <div className="min-h-0 flex-1">
            <div className={cn('h-full', mobileTab !== 'chat' && 'hidden')}>{chat}</div>
            <div className={cn('h-full', mobileTab === 'chat' && 'hidden')}>{right(mobileTab === 'code' ? 'code' : 'preview')}</div>
          </div>
          <nav className="grid shrink-0 grid-cols-3 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]">
            {mobileTabs.map(({ id: tab, label, icon: Icon }) => (
              <button
                key={tab}
                type="button"
                aria-current={mobileTab === tab ? 'page' : undefined}
                onClick={() => {
                  setMobileTab(tab);
                  if (tab !== 'chat') useWorkspace.getState().setView(tab);
                }}
                className={cn('flex flex-col items-center gap-0.5 py-2 text-[11px]', mobileTab === tab ? 'font-medium text-foreground' : 'text-muted-foreground')}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </nav>
        </>
      )}

      {isOwner ? (
        <>
          <PublishDialog project={project} />
          <ShareDialog project={project} />
          <GithubDialog project={project} />
          <SupabaseDialog project={project} />
        </>
      ) : null}
      <ProjectSettingsDialog project={project} isOwner={isOwner} />
      <HistoryDrawer project={project} isOwner={isOwner} />
    </div>
  );
}
