import { useRef, type ReactNode } from 'react';
import { BookOpen, ChevronDown, FolderOpen, House, LayoutGrid, LogIn, LogOut, Settings, SquarePlus, Users, type LucideIcon } from 'lucide-react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { UserAvatar } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useErrorMessage, useT } from '@/i18n';
import { useStaggerIn } from '@/lib/motion';
import { CreditsMeter } from './CreditsMeter';
import { useLogout, useMe } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { Logo } from './Logo';

/** Ask the prompt box on the current page to take focus (see PromptBox). */
export const FOCUS_PROMPT_EVENT = 'yasa:focus-prompt';

interface NavItem {
  key: 'home' | 'create' | 'templates' | 'projects' | 'community' | 'docs';
  to: string;
  icon: LucideIcon;
  end?: boolean;
  action?: 'create';
}

const NAV: NavItem[] = [
  { key: 'home', to: '/', icon: House, end: true },
  { key: 'create', to: '/', icon: SquarePlus, action: 'create' },
  { key: 'templates', to: '/templates', icon: LayoutGrid },
  { key: 'projects', to: '/projects', icon: FolderOpen },
  { key: 'community', to: '/community', icon: Users },
  { key: 'docs', to: '/docs', icon: BookOpen },
];

const itemBase =
  'group/nav flex w-full items-center gap-3.5 rounded-2xl border border-transparent px-3.5 py-3 text-left text-[15px] font-medium outline-none transition-all duration-200 focus-visible:ring-[3px] focus-visible:ring-ring/45';
const itemIdle = 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground';
const itemActive = 'nav-active text-foreground';

/** Sidebar content shared by the floating desktop panel and the mobile drawer. */
export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const t = useT('shell');
  const tc = useT('common');
  const errorMessage = useErrorMessage();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: user } = useMe();
  const logout = useLogout();
  const ref = useRef<HTMLDivElement>(null);
  // The desktop panel remounts with every page, so its entrance plays once; the mobile drawer replays on open.
  useStaggerIn(ref, '[data-nav-item]', [], { x: -18 }, onNavigate ? undefined : 'sidebar');

  const focusPrompt = () => {
    onNavigate?.();
    const fire = () => window.dispatchEvent(new CustomEvent(FOCUS_PROMPT_EVENT));
    if (location.pathname === '/') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      fire();
    } else {
      void Promise.resolve(navigate('/')).then(() => window.setTimeout(fire, 120));
    }
  };

  const onLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        toast.success(tc('userMenu.loggedOut'));
        onNavigate?.();
        void navigate('/', { replace: true });
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  return (
    <div ref={ref} className="flex h-full min-h-0 flex-col">
      <Link
        to="/"
        onClick={onNavigate}
        aria-label={tc('nav.backToHome')}
        className="mx-1 mb-6 mt-1 inline-flex w-fit rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45"
      >
        <Logo size={40} textClassName="!text-[26px] font-semibold tracking-tight" />
      </Link>

      <nav aria-label={tc('nav.main')} className="scrollbar-none -mx-1 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-1 pb-2">
        {NAV.map((item) => {
          const Icon = item.icon;
          const content = (
            <>
              <Icon className="size-[22px] shrink-0 transition-transform duration-200 group-hover/nav:scale-110" strokeWidth={1.75} aria-hidden />
              <span className="truncate">{t(`nav.${item.key}`)}</span>
            </>
          );
          if (item.action === 'create') {
            return (
              <button key={item.key} type="button" data-nav-item onClick={focusPrompt} className={cn(itemBase, itemIdle)}>
                {content}
              </button>
            );
          }
          return (
            <NavLink
              key={item.key}
              to={item.to}
              end={item.end}
              data-nav-item
              onClick={onNavigate}
              className={({ isActive }) => cn(itemBase, isActive ? itemActive : itemIdle)}
            >
              {content}
            </NavLink>
          );
        })}
      </nav>

      {user ? <CreditsMeter className="mt-3" /> : null}
      <div className="mt-3" data-nav-item>
        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="glass-control flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45">
              <UserAvatar name={user.name} seed={user.id} className="size-10 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium text-foreground">{user.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
              </span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-60">
              <DropdownMenuItem asChild>
                <Link to="/settings" onClick={onNavigate}>
                  <Settings />
                  {t('nav.settings')}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/projects" onClick={onNavigate}>
                  <FolderOpen />
                  {t('nav.projects')}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onLogout}>
                <LogOut />
                {tc('nav.logout')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Link
            to="/login"
            onClick={onNavigate}
            className="glass-control flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-foreground/10 text-foreground">
              <LogIn className="size-[18px]" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium text-foreground">{t('nav.guest')}</span>
              <span className="block truncate text-xs text-muted-foreground">{t('nav.guestHint')}</span>
            </span>
          </Link>
        )}
      </div>
    </div>
  );
}

/** Floating glass sidebar (desktop only; the mobile drawer lives in AppHeader). */
export function AppSidebar({ children }: { children?: ReactNode }) {
  return (
    <aside className="glass fixed bottom-4 left-4 top-4 z-30 hidden w-[272px] rounded-[28px] p-4 lg:block">
      <SidebarContent />
      {children}
    </aside>
  );
}
