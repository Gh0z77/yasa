import { useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Eye, EyeOff, TriangleAlert } from 'lucide-react';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';
import { LogoMark, Logo } from '@/components/common/Logo';
import { SceneBackground } from '@/components/common/SceneBackground';
import { ThemeToggle } from '@/components/common/ThemeToggle';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT } from '@/i18n';
import { useStaggerIn } from '@/lib/motion';
import { cn } from '@/lib/utils';

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Full-page frame of the Login / Signup pages: slim top bar, brand glow, one centered card. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  bare = false,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  /** Line under the card (link to the other auth page). */
  footer?: ReactNode;
  /** Only the frame (scene, top bar, centring): the child brings its own card. */
  bare?: boolean;
}) {
  const tc = useT('common');
  const rootRef = useRef<HTMLDivElement>(null);
  useStaggerIn(rootRef, '[data-auth-card]', [], { y: 36 });
  return (
    <div ref={rootRef} className="relative isolate flex min-h-dvh flex-col overflow-hidden text-foreground">
      <SceneBackground dim />

      <header className="container-page flex h-14 items-center justify-between sm:h-16">
        <Link
          to="/"
          aria-label={tc('nav.backToHome')}
          className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45"
        >
          <Logo size={26} />
        </Link>
        <div className="flex items-center gap-1">
          <LanguageSwitcher mode="compact" align="end" />
          <ThemeToggle />
        </div>
      </header>

      <main id="main" className="flex flex-1 items-center justify-center px-4 pb-16 pt-6 sm:pt-10">
        {bare ? (
          <div data-auth-card className="flex w-full justify-center">
            {children}
          </div>
        ) : (
        <div className="w-full max-w-md">
          <div data-auth-card className="glass-strong rounded-[1.75rem] p-6 sm:p-8">
            <div className="mb-6 flex flex-col items-center text-center sm:mb-8">
              <LogoMark size={44} className="mb-4" />
              <h1 className="text-[1.75rem] font-extrabold leading-tight tracking-[-0.035em]">{title}</h1>
              <p className="mt-1.5 text-pretty text-sm text-muted-foreground">{subtitle}</p>
            </div>
            {children}
          </div>
          <p className="mt-6 text-center text-sm text-muted-foreground">{footer}</p>
        </div>
        )}
      </main>
    </div>
  );
}

/** Inline link used in the auth footers and notes. */
export function AuthLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/45"
    >
      {children}
    </Link>
  );
}

/** Server-side error shown above the form. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="mb-5 flex animate-fade-in items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-sm text-destructive"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0">{message}</span>
    </div>
  );
}

export interface FormFieldProps extends Omit<ComponentProps<typeof Input>, 'id'> {
  label: string;
  /** Validation message; shown (and announced) when set. */
  error?: string | null;
  hint?: string;
  /** Rendered on the label row, right-aligned (e.g. "Forgot password?"). */
  labelAction?: ReactNode;
}

/** Labelled input with an inline validation message. `type="password"` gets a show / hide toggle. */
export function FormField({ label, error, hint, labelAction, type = 'text', className, ...inputProps }: FormFieldProps) {
  const t = useT('auth');
  const id = useId();
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === 'password';
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {labelAction}
      </div>
      <div className="relative">
        <Input
          id={id}
          type={isPassword && revealed ? 'text' : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn('h-10', isPassword && 'pr-10', className)}
          {...inputProps}
        />
        {isPassword ? (
          <button
            type="button"
            onClick={() => setRevealed((value) => !value)}
            aria-label={revealed ? t('fields.hidePassword') : t('fields.showPassword')}
            aria-pressed={revealed}
            className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/45"
          >
            {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        ) : null}
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
