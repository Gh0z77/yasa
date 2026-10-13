import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { SearchX, TriangleAlert, Users } from 'lucide-react';
import type { CommunitySort } from '@shared/types';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeading, PageShell } from '@/components/common/PageShell';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CommunityCard, CommunityCardSkeleton } from '@/features/home/CommunityCard';
import { ProjectGrid } from '@/features/home/ProjectCard';
import { SearchField, useDebouncedValue } from '@/features/home/SearchField';
import { useErrorMessage, useT } from '@/i18n';
import { useCommunityInfinite, useMe } from '@/lib/queries';
import { cn } from '@/lib/utils';

function isSort(value: string): value is CommunitySort {
  return value === 'recent' || value === 'popular';
}

export default function Community() {
  const t = useT('home');
  const tc = useT('common');
  const errorMessage = useErrorMessage();
  const { data: user } = useMe();

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<CommunitySort>('recent');
  const query = useDebouncedValue(search.trim());

  const community = useCommunityInfinite(query ? { q: query, sort } : { sort });
  const list = useMemo(() => community.data?.pages.flat() ?? [], [community.data]);
  const searching = query.length > 0;

  return (
    <PageShell footer>
      <PageHeading title={t('community.title')} description={t('community.description')} />

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchField
          value={search}
          onChange={setSearch}
          label={t('community.searchLabel')}
          placeholder={t('community.searchPlaceholder')}
          className="sm:max-w-sm sm:flex-1"
        />
        <Tabs value={sort} onValueChange={(value) => (isSort(value) ? setSort(value) : undefined)} className="sm:ml-auto">
          <TabsList aria-label={t('community.sortLabel')} className="w-full sm:w-auto">
            <TabsTrigger value="recent" className="flex-1 sm:flex-none">
              {t('community.sortRecent')}
            </TabsTrigger>
            <TabsTrigger value="popular" className="flex-1 sm:flex-none">
              {t('community.sortPopular')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {community.isPending ? (
        <ProjectGrid>
          {Array.from({ length: 6 }, (_, index) => (
            <CommunityCardSkeleton key={index} />
          ))}
        </ProjectGrid>
      ) : community.isError ? (
        <EmptyState
          bordered
          icon={TriangleAlert}
          title={t('community.errorTitle')}
          description={errorMessage(community.error)}
          action={
            <Button variant="outline" onClick={() => void community.refetch()}>
              {tc('actions.retry')}
            </Button>
          }
        />
      ) : list.length === 0 ? (
        searching ? (
          <EmptyState
            bordered
            icon={SearchX}
            title={t('community.noResultsTitle')}
            description={t('community.noResultsDescription', { query })}
            action={
              <Button variant="outline" onClick={() => setSearch('')}>
                {t('community.clearSearch')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            bordered
            icon={Users}
            title={t('community.emptyTitle')}
            description={t('community.emptyDescription')}
            action={
              <Button asChild>
                <Link to={user ? '/' : '/signup'}>{tc('nav.getStarted')}</Link>
              </Button>
            }
          />
        )
      ) : (
        <>
          <ProjectGrid className={cn('transition-opacity duration-200', community.isFetching && !community.isFetchingNextPage && 'opacity-80')}>
            {list.map((project) => (
              <CommunityCard key={project.id} project={project} />
            ))}
          </ProjectGrid>
          {community.hasNextPage ? (
            <div className="mt-8 flex justify-center">
              <Button variant="outline" loading={community.isFetchingNextPage} onClick={() => void community.fetchNextPage()}>
                {t('community.loadMore')}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </PageShell>
  );
}
