import { useEffect, useRef, useState } from 'react';
import { LogIn, Menu } from 'lucide-react';
import { Link, NavLink } from 'react-router';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { LanguageSwitcher } from './LanguageSwitcher';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';

const LINKS = [
  { to: '/templates', key: 'nav.templates' },
  { to: '/community', key: 'nav.community' },
  { to: '/docs', key: 'nav.docs' },
] as const;

const focusRing = 'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45';

/**
 * Top bar of the public site (guests): logo, the public pages, language/theme and the two account actions.
 * At the top of a page it lies flat on the background; once the page scrolls it lifts into a white floating
 * bar, and a thin orange line across the top of the window shows how far the page has been read.
 * The app sidebar only exists for signed-in users.
 */
export function MarketingHeader({ className }: { className?: string }) {
  const t = useT('shell');
  const tc = useT('common');
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const progressRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const update = () => {
      setScrolled(window.scrollY > 12);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (progressRef.current) progressRef.current.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  return (
    <header className={cn('sticky top-0 z-30 px-2.5 pt-2.5 sm:px-4', className)}>
      <span ref={progressRef} aria-hidden className="fixed inset-x-0 top-0 z-40 h-[3px] origin-left scale-x-0 bg-brand" />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-5 focus:top-5 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        {tc('nav.skipToContent')}
      </a>
      <div
        className={cn(
          'mx-auto flex h-14 w-full max-w-[86rem] items-center gap-2 rounded-2xl border px-4 transition-[background-color,border-color,box-shadow] duration-500 sm:h-[3.75rem] sm:px-6',
          scrolled ? 'border-border bg-card/90 shadow-[0_14px_40px_-22px_rgb(10_10_10/0.28)] backdrop-blur-xl' : 'border-transparent',
        )}
      >
        <Link to="/" aria-label={tc('nav.backToHome')} className={cn('-ml-1 rounded-lg p-1', focusRing)}>
          <Logo size={26} />
        </Link>

        <nav aria-label={tc('nav.main')} className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-2 text-sm transition-colors duration-300 hover:bg-foreground/[0.05]',
                  focusRing,
                  isActive ? 'font-medium text-foreground' : 'text-foreground/70 hover:text-foreground',
                )
              }
            >
              {t(link.key)}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
          <LanguageSwitcher />
          <ThemeToggle />
          <Link
            to="/login"
            aria-label={t('nav.login')}
            title={t('nav.login')}
            className={cn('hidden size-9 place-items-center rounded-full text-foreground/75 transition-colors duration-300 hover:bg-foreground/[0.06] hover:text-foreground sm:grid', focusRing)}
          >
            <LogIn className="size-[18px]" aria-hidden />
          </Link>
          <Link
            to="/signup"
            className={cn(
              'ml-1 hidden h-10 items-center rounded-full bg-primary px-5 font-serif text-[15px] italic text-primary-foreground transition-transform duration-300 hover:scale-[1.03] min-[420px]:inline-flex',
              focusRing,
            )}
          >
            {t('nav.startFree')}
          </Link>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label={t('nav.menu')}
            className={cn('ml-1 grid size-10 shrink-0 place-items-center rounded-full border border-border text-foreground md:hidden', focusRing)}
          >
            <Menu className="size-5" />
          </button>
        </div>
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="right" className="w-[300px] border-l border-border bg-background p-6 sm:max-w-[300px]">
          <SheetTitle className="sr-only">{t('nav.menu')}</SheetTitle>
          <SheetDescription className="sr-only">{tc('nav.main')}</SheetDescription>
          <Logo size={26} />
          <nav aria-label={tc('nav.main')} className="mt-8 flex flex-col">
            {LINKS.map((link, index) => (
              <NavLink
                key={link.to}
                to={link.to}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-baseline gap-4 border-b border-border py-4 font-display text-xl font-bold tracking-tight',
                    focusRing,
                    isActive ? 'text-foreground' : 'text-foreground/75',
                  )
                }
              >
                <span className="font-numeral text-base font-normal text-brand">{String(index + 1).padStart(2, '0')}</span>
                {t(link.key)}
              </NavLink>
            ))}
          </nav>
          <div className="mt-8 flex flex-col gap-3">
            <Link
              to="/signup"
              onClick={() => setMenuOpen(false)}
              className={cn('inline-flex h-12 items-center justify-center rounded-full bg-primary font-serif text-base italic text-primary-foreground', focusRing)}
            >
              {t('nav.startFree')}
            </Link>
            <Link
              to="/login"
              onClick={() => setMenuOpen(false)}
              className={cn('inline-flex h-12 items-center justify-center rounded-full border border-border text-base font-medium', focusRing)}
            >
              {t('nav.login')}
            </Link>
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}
