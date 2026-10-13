import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { FolderOpen, Plus, SearchX, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { ProjectSort } from '@shared/types';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeading, PageShell } from '@/components/common/PageShell';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ProjectCard, ProjectCardSkeleton, ProjectGrid } from '@/features/home/ProjectCard';
import { SearchField, useDebouncedValue } from '@/features/home/SearchField';
import { getLocale, useErrorMessage, useT } from '@/i18n';
import { useCreateProject, useProjects, useSharedProjects } from '@/lib/queries';
import { cn } from '@/lib/utils';

const SORTS = ['updated', 'created', 'name'] as const satisfies readonly ProjectSort[];
const SORT_LABELS = {
  updated: 'projects.sortUpdated',
  created: 'projects.sortCreated',
  name: 'projects.sortName',
} as const;

function isSort(value: string): value is ProjectSort {
  return (SORTS as readonly string[]).includes(value);
}

export default function Projects() {
  const t = useT('home');
  const ts = useT('shell');
  const tc = useT('common');
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ProjectSort>('updated');
  const query = useDebouncedValue(search.trim());

  const projects = useProjects(query ? { q: query, sort } : { sort });
  const shared = useSharedProjects();
  const createProject = useCreateProject();

  const create = () => {
    createProject.mutate(
      { locale: getLocale() },
      {
        onSuccess: ({ project }) => void navigate(`/project/${project.id}`),
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  const newProjectButton = (
    <Button variant="gradient" loading={createProject.isPending} onClick={create}>
      <Plus />
      {t('projects.new')}
    </Button>
  );

  const list = projects.data ?? [];
  const searching = query.length > 0;

  return (
    <PageShell footer>
      <PageHeading title={t('projects.title')} description={t('projects.description')} actions={newProjectButton} />

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchField
          value={search}
          onChange={setSearch}
          label={t('projects.searchLabel')}
          placeholder={t('projects.searchPlaceholder')}
          className="sm:max-w-sm sm:flex-1"
        />
        <div className="flex items-center gap-3 sm:ml-auto">
          {projects.data && !projects.isPlaceholderData ? (
            <span className="text-sm text-muted-foreground" aria-live="polite">
              {tc('count.projects', { count: list.length })}
            </span>
          ) : null}
          <Select value={sort} onValueChange={(value) => (isSort(value) ? setSort(value) : undefined)}>
            <SelectTrigger aria-label={t('projects.sortLabel')} className="ml-auto h-10 min-w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {SORTS.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(SORT_LABELS[value])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {projects.isPending ? (
        <ProjectGrid>
          {Array.from({ length: 6 }, (_, index) => (
            <ProjectCardSkeleton key={index} />
          ))}
        </ProjectGrid>
      ) : projects.isError ? (
        <EmptyState
          bordered
          icon={TriangleAlert}
          title={t('projects.errorTitle')}
          description={errorMessage(projects.error)}
          action={
            <Button variant="outline" onClick={() => void projects.refetch()}>
              {tc('actions.retry')}
            </Button>
          }
        />
      ) : list.length === 0 ? (
        searching ? (
          <EmptyState
            bordered
            icon={SearchX}
            title={t('projects.noResultsTitle')}
            description={t('projects.noResultsDescription', { query })}
            action={
              <Button variant="outline" onClick={() => setSearch('')}>
                {t('projects.clearSearch')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            bordered
            icon={FolderOpen}
            title={t('projects.emptyTitle')}
            description={t('projects.emptyDescription')}
            action={newProjectButton}
          />
        )
      ) : (
        <ProjectGrid className={cn('transition-opacity duration-200', projects.isPlaceholderData && 'opacity-60')}>
          {list.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </ProjectGrid>
      )}

      {shared.data && shared.data.length > 0 ? (
        <section aria-labelledby="shared-projects" className="mt-12">
          <h2 id="shared-projects" className="text-xl font-semibold tracking-tight">
            {ts('shared.title')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{ts('shared.description')}</p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shared.data.map((project) => (
              <li key={project.id}>
                <Link
                  to={`/project/${project.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 outline-none backdrop-blur-xl transition-colors hover:border-foreground/25 focus-visible:ring-[3px] focus-visible:ring-ring/45"
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-foreground/[0.06] text-xl" aria-hidden>
                    {project.emoji}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{project.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {ts('shared.by', { name: project.ownerName ?? '' })} · {ts(project.role === 'editor' ? 'members.editor' : 'members.viewer')}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </PageShell>
  );
}
