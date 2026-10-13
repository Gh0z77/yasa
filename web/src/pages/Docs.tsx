import { useRef, type ReactNode } from 'react';
import { CodeXml, Hammer, KeyRound, MessagesSquare, MousePointerClick, type LucideIcon } from 'lucide-react';
import { PageHeading, PageShell } from '@/components/common/PageShell';
import { Kbd } from '@/components/ui/kbd';
import { useT } from '@/i18n';
import { useScrollReveal } from '@/lib/motion';

const SECTIONS = ['start', 'keys', 'modes', 'versions', 'publish', 'shortcuts', 'faq'] as const;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} data-reveal className="glass scroll-mt-6 rounded-3xl p-6 sm:p-8">
      <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight sm:text-2xl">
        {title}
      </h2>
      <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-foreground/80">{children}</div>
    </section>
  );
}

export default function Docs() {
  const t = useT('shell');
  const ref = useRef<HTMLDivElement>(null);
  useScrollReveal(ref);

  const modes: Array<{ icon: LucideIcon; title: string; text: string }> = [
    { icon: Hammer, title: t('docs.modes.buildTitle'), text: t('docs.modes.buildText') },
    { icon: MessagesSquare, title: t('docs.modes.chatTitle'), text: t('docs.modes.chatText') },
    { icon: MousePointerClick, title: t('docs.modes.selectTitle'), text: t('docs.modes.selectText') },
    { icon: CodeXml, title: t('docs.modes.codeTitle'), text: t('docs.modes.codeText') },
  ];

  const shortcuts: Array<{ keys: string[]; label: string }> = [
    { keys: ['Enter'], label: t('docs.shortcuts.send') },
    { keys: ['Shift', 'Enter'], label: t('docs.shortcuts.newline') },
    { keys: ['Alt', 'P'], label: t('docs.shortcuts.mode') },
    { keys: ['Ctrl', 'B'], label: t('docs.shortcuts.chat') },
    { keys: ['Ctrl', 'S'], label: t('docs.shortcuts.save') },
    { keys: ['↑'], label: t('docs.shortcuts.recall') },
    { keys: ['Esc'], label: t('docs.shortcuts.cancel') },
  ];

  const steps = [
    { title: t('docs.start.step1Title'), text: t('docs.start.step1Text') },
    { title: t('docs.start.step2Title'), text: t('docs.start.step2Text') },
    { title: t('docs.start.step3Title'), text: t('docs.start.step3Text') },
  ];

  const faq = [
    { q: t('docs.faq.q1'), a: t('docs.faq.a1') },
    { q: t('docs.faq.q2'), a: t('docs.faq.a2') },
    { q: t('docs.faq.q3'), a: t('docs.faq.a3') },
    { q: t('docs.faq.q4'), a: t('docs.faq.a4') },
  ];

  return (
    <PageShell footer>
      <PageHeading title={t('docs.title')} description={t('docs.subtitle')} />
      <div ref={ref} className="grid gap-8 xl:grid-cols-[1fr_220px]">
        <div className="min-w-0 space-y-5">
          <Section id="start" title={t('docs.start.title')}>
            <ol className="grid gap-4 md:grid-cols-3">
              {steps.map((step, index) => (
                <li key={step.title} className="glass-control rounded-2xl p-4">
                  <span className="bg-cta grid size-9 place-items-center rounded-xl text-sm font-semibold">{index + 1}</span>
                  <p className="mt-3 font-medium text-foreground">{step.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{step.text}</p>
                </li>
              ))}
            </ol>
          </Section>

          <Section id="keys" title={t('docs.keys.title')}>
            <p>{t('docs.keys.text')}</p>
            <p className="glass-control flex gap-3 rounded-2xl p-4">
              <KeyRound className="mt-0.5 size-5 shrink-0 text-[color:var(--brand-to)]" aria-hidden />
              <span>{t('docs.keys.gemini')}</span>
            </p>
            <p>{t('docs.keys.own')}</p>
          </Section>

          <Section id="modes" title={t('docs.modes.title')}>
            <ul className="grid gap-4 sm:grid-cols-2">
              {modes.map(({ icon: Icon, title, text }) => (
                <li key={title} className="glass-control rounded-2xl p-4">
                  <Icon className="size-5 text-[color:var(--brand-from)]" aria-hidden />
                  <p className="mt-3 font-medium text-foreground">{title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{text}</p>
                </li>
              ))}
            </ul>
          </Section>

          <Section id="versions" title={t('docs.versions.title')}>
            <p>{t('docs.versions.text')}</p>
          </Section>

          <Section id="publish" title={t('docs.publish.title')}>
            <p>{t('docs.publish.text')}</p>
          </Section>

          <Section id="shortcuts" title={t('docs.shortcuts.title')}>
            <dl className="divide-y divide-border">
              {shortcuts.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="text-sm">{item.label}</dt>
                  <dd className="flex shrink-0 items-center gap-1">
                    {item.keys.map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section id="faq" title={t('docs.faq.title')}>
            <dl className="space-y-4">
              {faq.map((item) => (
                <div key={item.q}>
                  <dt className="font-medium text-foreground">{item.q}</dt>
                  <dd className="mt-1 text-sm text-muted-foreground">{item.a}</dd>
                </div>
              ))}
            </dl>
          </Section>
        </div>

        <nav aria-label={t('docs.onThisPage')} className="hidden xl:block">
          <div className="glass sticky top-6 rounded-3xl p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t('docs.onThisPage')}</p>
            <ul className="mt-3 space-y-1">
              {SECTIONS.map((id) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    className="block rounded-lg px-2.5 py-1.5 text-sm text-foreground/75 outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/45"
                  >
                    {t(`docs.${id}.title`)}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>
      </div>
    </PageShell>
  );
}
