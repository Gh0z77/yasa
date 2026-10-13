import { useCallback, useRef, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  CodeXml,
  History,
  MessagesSquare,
  MonitorSmartphone,
  MousePointerClick,
  Rocket,
  type LucideIcon,
} from 'lucide-react';
import { Logo } from '@/components/common/Logo';
import { PageShell } from '@/components/common/PageShell';
import { CommunityCard } from '@/features/home/CommunityCard';
import { HeroTitle } from '@/features/home/HeroTitle';
import { savePendingPrompt } from '@/features/home/pending';
import { ProjectGrid } from '@/features/home/ProjectCard';
import { PromptBox, type PromptBoxInput } from '@/features/home/PromptBox';
import { BuildStory } from '@/features/landing/BuildStory';
import { DotArt } from '@/features/landing/DotArt';
import { useT } from '@/i18n';
import { prefersReducedMotion, useHeroIntro, useScrollReveal } from '@/lib/motion';
import { useCommunity } from '@/lib/queries';
import { cn } from '@/lib/utils';

const FEATURES = [
  { icon: MessagesSquare, title: 'features.chatTitle', text: 'features.chatText' },
  { icon: MonitorSmartphone, title: 'features.previewTitle', text: 'features.previewText' },
  { icon: MousePointerClick, title: 'features.selectTitle', text: 'features.selectText' },
  { icon: CodeXml, title: 'features.codeTitle', text: 'features.codeText' },
  { icon: History, title: 'features.historyTitle', text: 'features.historyText' },
  { icon: Rocket, title: 'features.publishTitle', text: 'features.publishText' },
] as const satisfies ReadonlyArray<{ icon: LucideIcon; title: string; text: string }>;

/** Figures that are true of the product today (see README: free-model timings, providers, locales). */
const NUMBERS = [
  { value: '60', kicker: 'numbers.n1Kicker', label: 'numbers.n1Label', text: 'numbers.n1Text' },
  { value: '5', kicker: 'numbers.n2Kicker', label: 'numbers.n2Label', text: 'numbers.n2Text' },
  { value: '3', kicker: 'numbers.n3Kicker', label: 'numbers.n3Label', text: 'numbers.n3Text' },
  { value: '1', kicker: 'numbers.n4Kicker', label: 'numbers.n4Label', text: 'numbers.n4Text' },
] as const;

const POINTS = ['hero.point1', 'hero.point2', 'hero.point3'] as const;

const SHOWCASE_COUNT = 6;

/** Page grid of the public site: wider than the app container, with generous side margins. */
const WRAP = 'mx-auto w-full max-w-[84rem] px-5 sm:px-8 lg:px-12';
const focusRing = 'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45';
/** White card on a soft shadow: the building block of every section. */
const CARD = 'rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgb(10_10_10/0.04),0_18px_44px_-24px_rgb(10_10_10/0.2)]';

const two = (n: number) => String(n).padStart(2, '0');

/** Public site for guests: what Yasa is, a scroll-driven walk through one build, the figures and a first prompt. */
export default function Landing() {
  const t = useT('landing');
  const tc = useT('common');
  const ts = useT('shell');
  const navigate = useNavigate();
  const community = useCommunity({ sort: 'popular' });
  const showcase = community.data?.slice(0, SHOWCASE_COUNT) ?? [];
  const hasShowcase = showcase.length > 0;

  const heroRef = useRef<HTMLElement>(null);
  const aboutRef = useRef<HTMLDivElement>(null);
  const introRef = useRef<HTMLDivElement>(null);
  const sectionsRef = useRef<HTMLDivElement>(null);
  useHeroIntro(heroRef);
  useScrollReveal(aboutRef);
  useScrollReveal(introRef);
  useScrollReveal(sectionsRef, [showcase.length]);

  // Guests cannot build yet: keep only the text and continue after signup (Home picks it up).
  const start = useCallback(
    ({ prompt }: PromptBoxInput) => {
      savePendingPrompt(prompt);
      void navigate('/signup?next=/');
    },
    [navigate],
  );

  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }, []);

  return (
    <PageShell
      contained={false}
      footer={
        <footer className="relative px-2.5 pb-2.5 sm:px-4 sm:pb-4">
          <div className="relative mx-auto max-w-[86rem] overflow-hidden rounded-3xl border border-border bg-card/70">
            <div aria-hidden className="brand-glow absolute inset-0 opacity-70" />
            <div className="relative grid gap-12 px-6 py-12 sm:px-10 sm:py-14 lg:grid-cols-12">
              <div className="lg:col-span-5">
                <Link to="/" aria-label={tc('nav.backToHome')} className={cn('inline-flex rounded-md', focusRing)}>
                  <Logo size={30} />
                </Link>
                <p className="mt-5 max-w-xs text-pretty text-[15px] leading-relaxed text-muted-foreground">{t('footer.tagline')}</p>
              </div>
              <nav aria-label={t('footer.nav')} className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3 lg:col-span-7">
                <FooterColumn title={t('footer.product')}>
                  <FooterButton onClick={() => scrollTo('how')}>{t('footer.how')}</FooterButton>
                  <FooterButton onClick={() => scrollTo('features')}>{t('footer.features')}</FooterButton>
                  <FooterLink to="/templates">{ts('nav.templates')}</FooterLink>
                </FooterColumn>
                <FooterColumn title={t('footer.resources')}>
                  <FooterLink to="/docs">{ts('nav.docs')}</FooterLink>
                  <FooterLink to="/community">{tc('nav.community')}</FooterLink>
                </FooterColumn>
                <FooterColumn title={t('footer.account')}>
                  <FooterLink to="/login">{tc('nav.login')}</FooterLink>
                  <FooterLink to="/signup">{ts('nav.startFree')}</FooterLink>
                </FooterColumn>
              </nav>
            </div>
            <p className="relative border-t border-border px-6 py-5 text-[13px] text-muted-foreground sm:px-10">
              {tc('footer.rights', { year: new Date().getFullYear() })}
            </p>
          </div>
        </footer>
      }
    >
      {/* Hero: a poster. The headline carries the page; a ball of points turns beside it. */}
      <section ref={heroRef} className="relative">
        <div className={cn(WRAP, 'flex min-h-[calc(100svh-4.25rem)] flex-col')}>
          <div className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-12 lg:py-16">
            <div className="lg:col-span-8">
              <p data-hero="badge" className="eyebrow flex items-center gap-3 text-foreground/55">
                <span aria-hidden className="size-1.5 rounded-full bg-brand" />
                {ts('badge')}
              </p>

              <HeroTitle variant="editorial" className="mt-7" before={t('hero.titleStart')} accent={t('hero.titleAccent')} />

              <p data-hero="sub" className="mt-8 max-w-lg text-pretty text-lg leading-relaxed text-muted-foreground">
                {t('hero.subtitle')}
              </p>

              <div data-hero="prompt" className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-4">
                <Link
                  to="/signup"
                  className={cn(
                    'group inline-flex h-14 items-center gap-3.5 rounded-full bg-primary pl-7 pr-2.5 font-serif text-lg italic text-primary-foreground transition-transform duration-300 hover:scale-[1.02]',
                    focusRing,
                  )}
                >
                  {t('hero.ctaPrimary')}
                  <span className="grid size-9 place-items-center rounded-full bg-brand text-white transition-transform duration-500 ease-out group-hover:rotate-45">
                    <ArrowUpRight className="size-[18px]" aria-hidden />
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => scrollTo('how')}
                  className={cn('group inline-flex items-center gap-2 rounded-sm py-1 text-[15px] font-medium text-foreground/75 transition-colors duration-300 hover:text-foreground', focusRing)}
                >
                  {t('hero.ctaSecondary')}
                  <ArrowDown className="size-4 transition-transform duration-500 ease-out group-hover:translate-y-1" aria-hidden />
                </button>
              </div>
            </div>

            <div data-hero="note" className="relative mx-auto hidden aspect-square w-full max-w-[26rem] lg:col-span-4 lg:block">
              <DotArt variant="sphere" />
            </div>
          </div>

          <div data-hero="note" className="flex flex-wrap items-center justify-between gap-x-10 gap-y-3 border-t border-border py-5 text-[13px] text-muted-foreground">
            <ul className="flex flex-wrap gap-x-7 gap-y-2">
              {POINTS.map((key) => (
                <li key={key} className="flex items-center gap-2.5">
                  <span aria-hidden className="size-1.5 rounded-full bg-brand" />
                  {t(key)}
                </li>
              ))}
            </ul>
            <p className="eyebrow text-foreground/45">{t('hero.note')}</p>
          </div>
        </div>
      </section>

      {/* The name, stippled */}
      <div aria-hidden className={cn(WRAP, 'pt-10 sm:pt-16')}>
        <div className="h-[26vw] max-h-[19rem] min-h-[6.5rem]">
          <DotArt variant="word" text="Yasa" />
        </div>
      </div>

      {/* 01 — What it is, and what is inside */}
      <section id="features" ref={aboutRef} aria-labelledby="landing-about" className="scroll-mt-24">
        <div className={cn(WRAP, 'grid gap-x-10 gap-y-12 pb-24 pt-20 sm:pb-36 sm:pt-28 lg:grid-cols-12')}>
          <div data-reveal className="lg:col-span-4">
            <SectionMark index={1} eyebrow={t('about.eyebrow')} />
            <h2 id="landing-about" className="mt-6 text-balance text-4xl font-extrabold leading-[0.98] tracking-[-0.04em] sm:text-5xl lg:text-[3.5rem]">
              {t('about.title')}
            </h2>
          </div>
          <div className="lg:col-span-8">
            <p data-reveal className="max-w-2xl text-pretty text-lg leading-relaxed text-foreground/80 sm:text-xl">
              {t('about.lead')}
            </p>
            <ul data-reveal-group className="mt-10 grid gap-4 sm:grid-cols-2">
              {FEATURES.map(({ icon: Icon, title, text }, index) => (
                <li key={title} data-reveal-item className={cn(CARD, 'dot-corner p-6 sm:p-7')}>
                  <div className="flex items-start justify-between">
                    <span className="font-numeral text-5xl leading-none text-brand">{two(index + 1)}</span>
                    <Icon className="relative z-[1] size-5 text-foreground/35" strokeWidth={1.5} aria-hidden />
                  </div>
                  <h3 className="mt-6 text-xl font-medium tracking-[-0.015em]">{t(title)}</h3>
                  <p className="mt-2 text-pretty text-[15px] leading-relaxed text-muted-foreground">{t(text)}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 02 — The build, scrubbed by scroll */}
      <div id="how" ref={introRef} className={cn(WRAP, 'scroll-mt-24 pb-2')}>
        <div data-reveal>
          <SectionMark index={2} eyebrow={t('story.eyebrow')} />
          <div className="mt-6 flex flex-wrap items-end justify-between gap-x-12 gap-y-5">
            <h2 id="landing-how" className="max-w-3xl text-balance text-4xl font-extrabold leading-[0.98] tracking-[-0.04em] sm:text-5xl lg:text-[3.5rem]">
              {t('story.title')}
            </h2>
            <p className="max-w-xs text-pretty text-[15px] leading-relaxed text-muted-foreground">{t('story.subtitle')}</p>
          </div>
          <Rule />
        </div>
      </div>
      <BuildStory />

      <div ref={sectionsRef} className="relative">
        {/* 03 — Figures */}
        <section aria-labelledby="landing-numbers">
          <div className={cn(WRAP, 'pb-24 pt-10 sm:pb-36 sm:pt-16')}>
            <div data-reveal>
              <SectionMark index={3} eyebrow={t('numbers.eyebrow')} />
              <h2 id="landing-numbers" className="mt-6 text-balance text-4xl font-extrabold leading-[0.98] tracking-[-0.04em] sm:text-5xl lg:text-[3.5rem]">
                {t('numbers.title')}
              </h2>
              <Rule />
            </div>
            <ul data-reveal-group className="mt-12 grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-4">
              {NUMBERS.map((item) => (
                <li key={item.label} data-reveal-item>
                  <p className="eyebrow font-medium text-brand">{t(item.kicker)}</p>
                  <p className="mt-2 font-numeral text-[7rem] leading-[0.9] sm:text-[8.5rem]">{item.value}</p>
                  <p className="eyebrow mt-4 font-semibold text-foreground">{t(item.label)}</p>
                  <p className="mt-3 max-w-[16rem] text-pretty text-[15px] leading-relaxed text-muted-foreground">{t(item.text)}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 04 — Community showcase (hidden until there is something to show) */}
        {hasShowcase ? (
          <section aria-labelledby="landing-showcase">
            <div className={cn(WRAP, 'pb-24 sm:pb-36')}>
              <div data-reveal>
                <SectionMark index={4} eyebrow={t('showcase.eyebrow')} />
                <div className="mt-6 flex flex-wrap items-end justify-between gap-x-12 gap-y-5">
                  <div>
                    <h2 id="landing-showcase" className="text-balance text-4xl font-extrabold leading-[0.98] tracking-[-0.04em] sm:text-5xl lg:text-[3.5rem]">
                      {t('showcase.title')}
                    </h2>
                    <p className="mt-4 max-w-md text-pretty text-[15px] leading-relaxed text-muted-foreground">{t('showcase.subtitle')}</p>
                  </div>
                  <Link
                    to="/community"
                    className={cn(
                      'group inline-flex h-10 items-center gap-2 rounded-full border border-foreground/20 bg-card px-5 text-sm font-medium transition-colors duration-300 hover:border-foreground/45',
                      focusRing,
                    )}
                  >
                    {t('showcase.viewAll')}
                    <ArrowRight className="size-4 transition-transform duration-500 ease-out group-hover:translate-x-1" aria-hidden />
                  </Link>
                </div>
                <Rule />
              </div>
              <div data-reveal className="mt-12">
                <ProjectGrid>
                  {showcase.map((project) => (
                    <CommunityCard key={project.id} project={project} />
                  ))}
                </ProjectGrid>
              </div>
            </div>
          </section>
        ) : null}

        {/* First prompt */}
        <section aria-labelledby="landing-cta">
          <div className={cn(WRAP, 'pb-20 sm:pb-28')}>
            <div data-reveal className={cn(CARD, 'relative overflow-hidden rounded-3xl')}>
              <div aria-hidden className="brand-glow absolute inset-0" />
              <div className="relative grid gap-10 p-6 sm:p-10 lg:grid-cols-12 lg:gap-12 lg:p-14">
                <div className="lg:col-span-5">
                  <SectionMark index={hasShowcase ? 5 : 4} eyebrow={t('hero.ctaPrimary')} />
                  <h2 id="landing-cta" className="mt-6 text-balance text-4xl font-extrabold leading-[0.98] tracking-[-0.04em] sm:text-5xl">
                    {t('cta.title')}
                  </h2>
                  <p className="mt-5 max-w-sm text-pretty text-lg leading-relaxed text-muted-foreground">{t('cta.subtitle')}</p>
                  <p className="mt-8 flex items-center gap-2.5 text-[13px] text-muted-foreground">
                    <span aria-hidden className="size-1.5 rounded-full bg-brand" />
                    {t('hero.note')}
                  </p>
                </div>
                <div className="lg:col-span-7 lg:self-center">
                  <PromptBox guest onSubmit={start} />
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </PageShell>
  );
}

/** The mark above every section heading: a short vertical hairline, the section number and its label. */
function SectionMark({ index, eyebrow }: { index: number; eyebrow: string }) {
  return (
    <div>
      <span aria-hidden className="block h-10 w-px bg-foreground/25" />
      <p className="eyebrow mt-4 flex items-center gap-2.5">
        <span className="font-semibold text-foreground">{two(index)}</span>
        <span className="text-foreground/45">{eyebrow}</span>
      </p>
    </div>
  );
}

/** Hairline under a heading whose first stretch is drawn in the brand colour. */
function Rule() {
  return (
    <div aria-hidden className="mt-8 h-px bg-border">
      <span className="block h-[2px] w-[min(46%,34rem)] -translate-y-px bg-brand" />
    </div>
  );
}

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-sm font-semibold">{title}</p>
      <ul className="mt-4 space-y-2.5 text-sm">{Array.isArray(children) ? children.map((child, index) => <li key={index}>{child}</li>) : <li>{children}</li>}</ul>
    </div>
  );
}

const footerItem = 'rounded-sm text-foreground/65 transition-colors duration-300 hover:text-foreground';

function FooterLink({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className={cn(footerItem, focusRing)}>
      {children}
    </Link>
  );
}

function FooterButton({ onClick, children }: { onClick(): void; children: string }) {
  return (
    <button type="button" onClick={onClick} className={cn(footerItem, focusRing)}>
      {children}
    </button>
  );
}
