import { useState, type ReactNode } from 'react';
import { ArrowRight, Menu } from 'lucide-react';
import { Link } from 'react-router';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useT } from '@/i18n';
import { useMe } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { SidebarContent } from './AppSidebar';
import { LanguageSwitcher } from './LanguageSwitcher';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';

export interface AppHeaderProps {
  className?: string;
  /** Extra controls rendered before the account area (right side). */
  actions?: ReactNode;
  /** Kept for compatibility with older callers; the bar always spans the content column. */
  wide?: boolean;
}

/**
 * Top bar of the cinematic shell: on desktop only the floating controls on the right (language, theme and,
 * for guests, Log in + Start for free); on small screens also the logo and the drawer with the sidebar.
 */
export function AppHeader({ className, actions }: AppHeaderProps) {
  const t = useT('shell');
  const tc = useT('common');
  const { data: user, isPending } = useMe();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className={cn('relative z-20 flex h-16 items-center gap-2 px-4 sm:h-20 sm:px-6 lg:px-8', className)}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        {tc('nav.skipToContent')}
      </a>

      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        aria-label={t('nav.menu')}
        className="glass-control grid size-10 shrink-0 place-items-center rounded-xl text-foreground lg:hidden"
      >
        <Menu className="size-5" />
      </button>
      <Link to="/" aria-label={tc('nav.backToHome')} className="rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45 lg:hidden">
        <Logo size={30} />
      </Link>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2.5">
        {actions}
        <LanguageSwitcher />
        <ThemeToggle />
        {!user && !isPending ? (
          <>
            <Link
              to="/login"
              className="glass-control hidden h-11 items-center rounded-xl px-5 text-[15px] font-medium text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45 sm:inline-flex"
            >
              {t('nav.login')}
            </Link>
            <Link
              to="/signup"
              className="bg-cta inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold outline-none transition-transform duration-200 hover:-translate-y-0.5 focus-visible:ring-[3px] focus-visible:ring-ring/45 sm:h-11 sm:px-5 sm:text-[15px]"
            >
              {t('nav.startFree')}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </>
        ) : null}
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="glass w-[292px] border-0 p-4 sm:max-w-[292px]">
          <SheetTitle className="sr-only">{t('nav.menu')}</SheetTitle>
          <SheetDescription className="sr-only">{tc('nav.main')}</SheetDescription>
          <SidebarContent onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>
    </header>
  );
}
