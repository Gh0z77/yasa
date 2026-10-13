import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { THEMES, useTheme, type Theme } from './ThemeProvider';

export const THEME_ICONS: Record<Theme, LucideIcon> = { light: Sun, dark: Moon, system: Monitor };

export interface ThemeToggleProps {
  className?: string;
  size?: ButtonProps['size'];
  variant?: ButtonProps['variant'];
  align?: 'start' | 'center' | 'end';
}

/** Icon button with a Light / Dark / System menu. */
export function ThemeToggle({ className, size = 'icon', variant = 'ghost', align = 'end' }: ThemeToggleProps) {
  const t = useT('common');
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} aria-label={t('theme.toggle')} className={cn('text-muted-foreground hover:text-foreground', className)}>
          <Sun className="size-4 scale-100 rotate-0 transition-transform duration-300 dark:scale-0 dark:-rotate-90" />
          <Moon className="absolute size-4 scale-0 rotate-90 transition-transform duration-300 dark:scale-100 dark:rotate-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-36">
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          {THEMES.map((value) => {
            const Icon = THEME_ICONS[value];
            return (
              <DropdownMenuRadioItem key={value} value={value}>
                <Icon />
                {t(`theme.${value}`)}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
