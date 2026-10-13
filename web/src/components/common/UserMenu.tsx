import { FolderOpen, Languages, LogOut, Settings, SunMoon, Users } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { Locale } from '@shared/types';
import { UserAvatar } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useErrorMessage, useLocale, useT } from '@/i18n';
import { useLogout, useMe } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { THEMES, useTheme, type Theme } from './ThemeProvider';
import { THEME_ICONS } from './ThemeToggle';

export interface UserMenuProps {
  className?: string;
  align?: 'start' | 'center' | 'end';
  /** Avatar size in px (default 32). */
  size?: number;
}

/** Avatar button with the account dropdown. Renders nothing for guests. */
export function UserMenu({ className, align = 'end', size = 32 }: UserMenuProps) {
  const t = useT('common');
  const errorMessage = useErrorMessage();
  const navigate = useNavigate();
  const { data: user } = useMe();
  const logout = useLogout();
  const { theme, setTheme } = useTheme();
  const { locale, setLocale, locales } = useLocale();

  if (!user) return null;

  const onLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        toast.success(t('userMenu.loggedOut'));
        void navigate('/', { replace: true });
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('userMenu.open')}
        className={cn(
          'rounded-full outline-none transition-shadow hover:ring-4 hover:ring-foreground/8 focus-visible:ring-[3px] focus-visible:ring-ring/45 data-[state=open]:ring-4 data-[state=open]:ring-foreground/8',
          className,
        )}
      >
        <UserAvatar name={user.name} seed={user.id} style={{ width: size, height: size }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-64">
        <div className="flex items-center gap-3 px-2 py-2">
          <UserAvatar name={user.name} seed={user.id} className="size-9" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link to="/projects">
              <FolderOpen />
              {t('userMenu.projects')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/community">
              <Users />
              {t('nav.community')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/settings">
              <Settings />
              {t('userMenu.settings')}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <SunMoon />
              {t('userMenu.theme')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
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
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Languages />
              {t('userMenu.language')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={locale} onValueChange={(v) => setLocale(v as Locale)}>
                {locales.map((l) => (
                  <DropdownMenuRadioItem key={l.code} value={l.code} lang={l.code}>
                    {l.nativeName}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={logout.isPending}
          onSelect={(e) => {
            e.preventDefault();
            onLogout();
          }}
        >
          <LogOut />
          {t('userMenu.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
