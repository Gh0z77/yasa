import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowRight, FlaskConical, FolderOpen, LoaderCircle, Sparkles, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/common/EmptyState';
import { PageShell } from '@/components/common/PageShell';
import { Button } from '@/components/ui/button';
import { CommunityCard } from '@/features/home/CommunityCard';
import { HeroTitle } from '@/features/home/HeroTitle';
import { takePendingPrompt } from '@/features/home/pending';
import { ProjectCard, ProjectCardSkeleton, ProjectGrid } from '@/features/home/ProjectCard';
import { PromptBox, type PromptBoxInput } from '@/features/home/PromptBox';
import { ConnectAiDialog } from '@/features/settings/ConnectAiDialog';
import { getLocale, useErrorMessage, useT } from '@/i18n';
import { useHeroIntro, useScrollReveal } from '@/lib/motion';
import { useCommunity, useCreateProject, useMe, useModels, useProjects } from '@/lib/queries';

const RECENT_COUNT = 6;
const NAME_SLOT = '\u0000';

// StrictMode runs mount effects twice: never start two projects from one pending prompt.
let pendingInFlight = false;

function firstName(fullName: string | undefined): string {
  return fullName?.trim().split(/\s+/)[0] ?? '';
}

export default function Home() {
  const t = useT('home');
  const tc = useT('common');
  const ts = useT('shell');
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();

  const { data: user } = useMe();
  const models = useModels();
  const createProject = useCreateProject();
  const projects = useProjects({ sort: 'updated' });
  const community = useCommunity({ sort: 'popular' });

  const heroRef = useRef<HTMLElement>(null);
  const sectionsRef = useRef<HTMLDivElement>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [autoStarting, setAutoStarting] = useState(false);

  const { mutateAsync: createProjectAsync } = createProject;
  const start = useCallback(
    async ({ prompt, attachmentIds, model }: PromptBoxInput) => {
      try {
        const { project } = await createProjectAsync({
          prompt,
          attachmentIds,
          locale: getLocale(),
          ...(model ? { model } : {}),
        });
        // The server has already started the first generation; the workspace attaches to it.
        void navigate(`/project/${project.id}`);
      } catch (error) {
        toast.error(errorMessage(error));
      }
    },
    [createProjectAsync, errorMessage, navigate],
  );

  // A guest typed a prompt on the landing page and has just signed up: build it right away (once).
  useEffect(() => {
    if (pendingInFlight) return;
    const prompt = takePendingPrompt();
    if (!prompt) return;
    pendingInFlight = true;
    setAutoStarting(true);
    void start({ prompt, attachmentIds: [], model: null }).finally(() => {
      pendingInFlight = false;
      setAutoStarting(false);
    });
    // Runs once per mount on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useHeroIntro(heroRef, [user?.id]);
  useScrollReveal(sectionsRef, [projects.isPending, community.data?.length]);

  const name = firstName(user?.name);
  const [titleBefore, titleAfter] = t('greeting.title', { name: NAME_SLOT }).split(NAME_SLOT);
  const demoMode = models.data?.defaultModel?.startsWith('mock:') ?? false;

  const recent = projects.data?.slice(0, RECENT_COUNT) ?? [];
  const showcase = community.data?.slice(0, RECENT_COUNT) ?? [];

  return (
    <PageShell contained={false} footer>
      <section ref={heroRef} className="relative">
        <div className="container-page flex min-h-[calc(100dvh-5rem)] flex-col items-center justify-center pb-14 pt-6 text-center sm:pb-20">
          <p data-hero="badge" className="glass inline-flex max-w-full items-center gap-2.5 rounded-full px-4 py-2 text-sm font-medium text-foreground/90">
            <Sparkles className="size-4 shrink-0 text-[color:var(--brand-to)]" aria-hidden />
            <span className="truncate">{ts('badge')}</span>
          </p>
          {name ? (
            <HeroTitle className="mt-7 max-w-4xl" before={titleBefore} accent={name} after={titleAfter} />
          ) : (
            <HeroTitle className="mt-7 max-w-4xl" before={t('greeting.titleNoName')} />
          )}
          <p data-hero="sub" className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-foreground/75 sm:text-lg">
            {t('greeting.subtitle')}
          </p>
          <div data-hero="prompt" className="mt-8 w-full max-w-4xl sm:mt-10">
            {demoMode ? (
              <div className="mb-4 flex justify-center">
                <div className="glass inline-flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-2xl px-3.5 py-2 text-sm sm:rounded-full">
                  <FlaskConical className="size-4 shrink-0 text-warning" aria-hidden />
                  <span className="text-muted-foreground">{t('demo.text')}</span>
                  <button
                    type="button"
                    onClick={() => setConnectOpen(true)}
                    className="inline-flex items-center gap-1 rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/45"
                  >
                    {t('demo.action')}
                    <ArrowRight className="size-3.5" aria-hidden />
                  </button>
                </div>
              </div>
            ) : null}

            <PromptBox onSubmit={start} busy={createProject.isPending || autoStarting} autoFocus />

            <p
              role="status"
              aria-live="polite"
              className="mt-4 flex min-h-5 items-center justify-center gap-2 text-sm text-muted-foreground"
            >
              {autoStarting ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" aria-hidden />
                  {t('pending.creating')}
                </>
              ) : null}
            </p>
          </div>
        </div>
      </section>

      <div ref={sectionsRef} className="container-page flex flex-col gap-14 pb-16 sm:gap-20 sm:pb-24">
        <section aria-labelledby="home-recent" data-reveal>
          <SectionHeading
            id="home-recent"
            title={t('recent.title')}
            subtitle={t('recent.subtitle')}
            action={
              recent.length > 0 ? (
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/projects">
                    {tc('actions.viewAll')}
                    <ArrowRight />
                  </Link>
                </Button>
              ) : null
            }
          />

          {projects.isPending ? (
            <ProjectGrid>
              {Array.from({ length: 3 }, (_, index) => (
                <ProjectCardSkeleton key={index} />
              ))}
            </ProjectGrid>
          ) : projects.isError ? (
            <EmptyState
              bordered
              icon={TriangleAlert}
              title={t('recent.errorTitle')}
              description={errorMessage(projects.error)}
              action={
                <Button variant="outline" onClick={() => void projects.refetch()}>
                  {tc('actions.retry')}
                </Button>
              }
            />
          ) : recent.length === 0 ? (
            <EmptyState bordered icon={FolderOpen} title={t('recent.emptyTitle')} description={t('recent.emptyDescription')} />
          ) : (
            <ProjectGrid>
              {recent.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </ProjectGrid>
          )}
        </section>

        {showcase.length > 0 ? (
          <section aria-labelledby="home-community" data-reveal>
            <SectionHeading
              id="home-community"
              title={t('communitySection.title')}
              subtitle={t('communitySection.subtitle')}
              action={
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/community">
                    {tc('actions.viewAll')}
                    <ArrowRight />
                  </Link>
                </Button>
              }
            />
            <ProjectGrid>
              {showcase.map((project) => (
                <CommunityCard key={project.id} project={project} loginNext="/" />
              ))}
            </ProjectGrid>
          </section>
        ) : null}
      </div>

      <ConnectAiDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </PageShell>
  );
}

function SectionHeading({ id, title, subtitle, action }: { id: string; title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4 sm:mb-6">
      <div className="min-w-0">
        <h2 id={id} className="text-xl font-semibold tracking-tight sm:text-2xl">
          {title}
        </h2>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
