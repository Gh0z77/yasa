import { useRef, useState } from 'react';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { PageHeading, PageShell } from '@/components/common/PageShell';
import { savePendingPrompt } from '@/features/home/pending';
import { getLocale, useErrorMessage, useT } from '@/i18n';
import { useScrollReveal } from '@/lib/motion';
import { useCreateProject, useMe } from '@/lib/queries';

const TEMPLATES = [
  { key: 'landing', emoji: '🚀', tint: '#ecb672' },
  { key: 'shop', emoji: '🛒', tint: '#a9cb8c' },
  { key: 'menu', emoji: '🫖', tint: '#e59f7a' },
  { key: 'dashboard', emoji: '📊', tint: '#8fb8d9' },
  { key: 'todo', emoji: '✅', tint: '#a9cb8c' },
  { key: 'portfolio', emoji: '🎨', tint: '#d9a8d0' },
  { key: 'wedding', emoji: '💍', tint: '#f1c896' },
  { key: 'courses', emoji: '🎓', tint: '#8fb8d9' },
  { key: 'blog', emoji: '📝', tint: '#d9cf8f' },
] as const;

type TemplateKey = (typeof TEMPLATES)[number]['key'];

export default function Templates() {
  const t = useT('shell');
  const errorMessage = useErrorMessage();
  const navigate = useNavigate();
  const { data: user } = useMe();
  const createProject = useCreateProject();
  const [starting, setStarting] = useState<TemplateKey | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useScrollReveal(ref);

  const use = async (key: TemplateKey) => {
    const prompt = t(`templates.items.${key}.prompt`);
    if (!user) {
      savePendingPrompt(prompt);
      void navigate('/signup?next=/');
      return;
    }
    setStarting(key);
    try {
      const { project } = await createProject.mutateAsync({ prompt, locale: getLocale() });
      void navigate(`/project/${project.id}`);
    } catch (error) {
      toast.error(errorMessage(error));
      setStarting(null);
    }
  };

  return (
    <PageShell footer>
      <div ref={ref}>
        <PageHeading title={t('templates.title')} description={t('templates.subtitle')} />
        <ul data-reveal-group className="grid gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-3">
          {TEMPLATES.map(({ key, emoji, tint }) => {
            const busy = starting === key;
            return (
              <li key={key} data-reveal-item>
                <button
                  type="button"
                  disabled={starting !== null}
                  onClick={() => void use(key)}
                  className="glass group relative flex h-full w-full flex-col overflow-hidden rounded-3xl p-6 text-left outline-none transition-[border-color,transform] duration-300 hover:-translate-y-1 hover:border-[color:color-mix(in_oklab,var(--brand-to)_45%,transparent)] focus-visible:ring-[3px] focus-visible:ring-ring/45 disabled:pointer-events-none disabled:opacity-70"
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full opacity-25 blur-3xl transition-opacity duration-500 group-hover:opacity-50"
                    style={{ backgroundColor: tint }}
                  />
                  <span className="glass-control grid size-14 place-items-center rounded-2xl text-3xl" aria-hidden>
                    {emoji}
                  </span>
                  <span className="mt-5 text-lg font-semibold tracking-tight">{t(`templates.items.${key}.title`)}</span>
                  <span className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">{t(`templates.items.${key}.text`)}</span>
                  <span className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-[color:var(--brand-to)]">
                    {busy ? (
                      <>
                        <LoaderCircle className="size-4 animate-spin" aria-hidden />
                        {t('templates.creating')}
                      </>
                    ) : (
                      <>
                        {t('templates.use')}
                        <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
                      </>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </PageShell>
  );
}
