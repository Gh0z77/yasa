import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useT } from '@/i18n';
import { useMe } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { AppHeader } from './AppHeader';
import { AppSidebar } from './AppSidebar';
import { Logo } from './Logo';
import { MarketingHeader } from './MarketingHeader';
import { SceneBackground } from './SceneBackground';

export interface PageShellProps {
  children: ReactNode;
  /** Replace the default `<AppHeader />`, or pass `null` to render no header. */
  header?: ReactNode | null;
  /** Footer node; `true` renders the default `<AppFooter />`. */
  footer?: ReactNode | boolean;
  /** Wrap children in the standard page container with vertical padding (default true). */
  contained?: boolean;
  className?: string;
  /** Classes for `<main>`. */
  mainClassName?: string;
}

const SIGNED_IN_HINT = 'yasa:signed-in';

/** Whether the last visit was signed in: picks the frame while the session request is still in flight. */
function readSignedInHint(): boolean {
  try {
    return localStorage.getItem(SIGNED_IN_HINT) === '1';
  } catch {
    return false;
  }
}

/**
 * The cinematic frame: scene photo behind everything, then `<main id="main">` and an optional footer.
 * Signed-in users get the app chrome (floating glass sidebar, drawer on small screens, controls on the top
 * right); guests get the public site chrome (a floating top bar with the public pages and account actions).
 */
export function PageShell({ children, header, footer = false, contained = true, className, mainClassName }: PageShellProps) {
  const { data: user, isPending } = useMe();
  const signedIn = isPending ? readSignedInHint() : Boolean(user);

  useEffect(() => {
    if (isPending) return;
    try {
      if (user) localStorage.setItem(SIGNED_IN_HINT, '1');
      else localStorage.removeItem(SIGNED_IN_HINT);
    } catch {
      /* storage blocked */
    }
  }, [user, isPending]);

  if (!signedIn) {
    return (
      <div className={cn('relative isolate flex min-h-dvh flex-col text-foreground', className)}>
        <SceneBackground />
        {header === undefined ? <MarketingHeader /> : header}
        <main id="main" tabIndex={-1} className={cn('flex-1 outline-none', contained && 'container-page pb-12 pt-8 sm:pb-16 sm:pt-10', mainClassName)}>
          {children}
        </main>
        {footer === true ? <AppFooter /> : footer || null}
      </div>
    );
  }

  return (
    <div className={cn('relative isolate min-h-dvh text-foreground', className)}>
      <SceneBackground />
      <AppSidebar />
      <div className="flex min-h-dvh flex-col lg:pl-[304px]">
        {header === undefined ? <AppHeader /> : header}
        <main id="main" tabIndex={-1} className={cn('flex-1 outline-none', contained && 'container-page pb-12 pt-2 sm:pb-16', mainClassName)}>
          {children}
        </main>
        {footer === true ? <AppFooter /> : footer || null}
      </div>
    </div>
  );
}

export interface PageHeadingProps {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned controls (buttons, search). */
  actions?: ReactNode;
  className?: string;
}

/** Title row used at the top of Projects / Community / Settings / Templates. */
export function PageHeading({ title, description, actions, className }: PageHeadingProps) {
  return (
    <div className={cn('mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        <h1 className="text-3xl font-extrabold tracking-[-0.035em] sm:text-[2.75rem] sm:leading-none">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Minimal footer: logo, copyright and optional links. Language and theme controls live in the top bar. */
export function AppFooter({ className, children }: { className?: string; children?: ReactNode }) {
  const t = useT('common');
  return (
    <footer className={cn('border-t border-border/60', className)}>
      <div className="container-page flex flex-col items-center justify-between gap-4 py-6 sm:flex-row">
        <div className="flex items-center gap-3">
          <Link to="/" aria-label={t('nav.backToHome')} className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45">
            <Logo size={22} />
          </Link>
          <span className="text-xs text-muted-foreground">{t('footer.rights', { year: new Date().getFullYear() })}</span>
        </div>
        {children}
      </div>
    </footer>
  );
}
