import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Check, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { Locale } from '@shared/types';
import { useTheme, type Theme } from '@/components/common/ThemeProvider';
import { translate, useLocale, useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { SettingsCard } from './SettingsCard';

interface Choice<V extends string> {
  value: V;
  title: string;
  hint?: string;
  visual: ReactNode;
  lang?: string;
}

/** Selectable cards with radio-group semantics (arrow keys move the selection). */
function ChoiceCards<V extends string>({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: V;
  choices: readonly Choice<V>[];
  onChange: (value: V) => void;
}) {
  const refs = useRef(new Map<V, HTMLButtonElement>());

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % choices.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + choices.length) % choices.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = choices.length - 1;
    else return;
    event.preventDefault();
    const target = choices[next];
    if (!target) return;
    onChange(target.value);
    refs.current.get(target.value)?.focus();
  }

  return (
    <div role="radiogroup" aria-label={label} className="grid gap-3 sm:grid-cols-3">
      {choices.map((choice, index) => {
        const selected = choice.value === value;
        return (
          <button
            key={choice.value}
            ref={(el) => {
              if (el) refs.current.set(choice.value, el);
              else refs.current.delete(choice.value);
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(choice.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              'group relative flex min-w-0 items-center gap-3 rounded-xl border p-3 text-left outline-none transition-colors sm:flex-col sm:items-start sm:p-4',
              'focus-visible:ring-[3px] focus-visible:ring-ring/45',
              selected
                ? 'border-primary bg-primary/5 shadow-sm'
                : 'border-border bg-background hover:border-foreground/20 hover:bg-muted/60',
            )}
          >
            <span
              className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-lg border text-sm font-semibold transition-colors',
                selected ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground',
              )}
            >
              {choice.visual}
            </span>
            <span className="min-w-0 flex-1">
              <span lang={choice.lang} className="block truncate text-sm font-medium text-foreground">
                {choice.title}
              </span>
              {choice.hint && choice.hint !== choice.title ? <span className="block truncate text-xs text-muted-foreground">{choice.hint}</span> : null}
            </span>
            <span
              aria-hidden="true"
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors sm:absolute sm:right-3 sm:top-3',
                selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-transparent',
              )}
            >
              <Check className="size-3" strokeWidth={3} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

const THEME_ICONS: Record<Theme, LucideIcon> = { light: Sun, dark: Moon, system: Monitor };
const THEME_ORDER: readonly Theme[] = ['light', 'dark', 'system'];

export function AppearanceSection() {
  const t = useT('settings');
  const { theme, setTheme } = useTheme();
  const { locale, setLocale, locales } = useLocale();

  const themeChoices = THEME_ORDER.map((value) => {
    const Icon = THEME_ICONS[value];
    return {
      value,
      title: t(`appearance.theme.${value}`),
      hint: t(`appearance.theme.${value}Hint`),
      visual: <Icon className="size-5" aria-hidden="true" />,
    } satisfies Choice<Theme>;
  });

  const languageChoices = locales.map(
    (info) =>
      ({
        value: info.code,
        title: info.nativeName,
        hint: t(`appearance.language.names.${info.code}`),
        visual: <span aria-hidden="true">{info.short}</span>,
        lang: info.code,
      }) satisfies Choice<Locale>,
  );

  function changeLocale(next: Locale) {
    if (next === locale) return;
    setLocale(next);
    toast.success(translate(next, 'settings', 'appearance.language.saved'));
  }

  return (
    <div className="space-y-6">
      <SettingsCard title={t('appearance.theme.title')} description={t('appearance.theme.description')}>
        <ChoiceCards label={t('appearance.theme.title')} value={theme} choices={themeChoices} onChange={setTheme} />
      </SettingsCard>
      <SettingsCard title={t('appearance.language.title')} description={t('appearance.language.description')}>
        <ChoiceCards label={t('appearance.language.title')} value={locale} choices={languageChoices} onChange={changeLocale} />
      </SettingsCard>
    </div>
  );
}
