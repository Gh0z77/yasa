import { LoaderCircle } from 'lucide-react';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';

export interface SpinnerProps {
  className?: string;
  /** Accessible label; omit when the spinner is decorative (next to visible text). */
  label?: string;
}

/** Small inline loading indicator (inherits `currentColor`). */
export function Spinner({ className, label }: SpinnerProps) {
  return (
    <LoaderCircle
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('size-4 shrink-0 animate-spin', className)}
    />
  );
}

/** Centered spinner that fills its container — for route / panel loading states. */
export function PageSpinner({ className, label }: SpinnerProps) {
  const t = useT('common');
  return (
    <div className={cn('flex min-h-[40vh] w-full flex-1 items-center justify-center', className)}>
      <Spinner className="size-6 text-muted-foreground" label={label ?? t('status.loading')} />
    </div>
  );
}
