import { Languages } from 'lucide-react';
import type { Locale } from '@shared/types';
import { Button, type ButtonProps } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLocale, useT } from '@/i18n';
import { cn } from '@/lib/utils';

export interface LanguageSwitcherProps {
  /** `compact` = icon + "EN" (headers); `full` = icon + native name (footers, settings). */
  mode?: 'compact' | 'full';
  className?: string;
  variant?: ButtonProps['variant'];
  align?: 'start' | 'center' | 'end';
}

export function LanguageSwitcher({ mode = 'compact', className, variant = 'ghost', align = 'end' }: LanguageSwitcherProps) {
  const t = useT('common');
  const { locale, setLocale, locales } = useLocale();
  const current = locales.find((l) => l.code === locale) ?? locales[0]!;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size="sm"
          aria-label={`${t('language.change')}: ${current.nativeName}`}
          className={cn('gap-1.5 px-2 text-muted-foreground hover:text-foreground', className)}
        >
          <Languages className="size-4" />
          <span className="text-xs font-medium">{mode === 'full' ? current.nativeName : current.short}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-40">
        <DropdownMenuRadioGroup value={locale} onValueChange={(v) => setLocale(v as Locale)}>
          {locales.map((l) => (
            <DropdownMenuRadioItem key={l.code} value={l.code} lang={l.code}>
              <span className="w-6 text-xs font-medium text-muted-foreground">{l.short}</span>
              {l.nativeName}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
