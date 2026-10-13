import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SettingsCardProps {
  title: ReactNode;
  description?: ReactNode;
  /** Right side of the header (badge, small action). */
  aside?: ReactNode;
  /** Bottom bar, usually the submit button. */
  footer?: ReactNode;
  tone?: 'default' | 'danger';
  children?: ReactNode;
  className?: string;
}

/** A titled block of the Settings page. */
export function SettingsCard({ title, description, aside, footer, tone = 'default', children, className }: SettingsCardProps) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        'rounded-3xl border bg-card text-card-foreground shadow-sm backdrop-blur-xl',
        tone === 'danger' ? 'border-destructive/40' : 'border-border',
        className,
      )}
    >
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="min-w-0 space-y-1">
          <h2 id={titleId} className={cn('text-base font-semibold leading-tight', tone === 'danger' && 'text-destructive')}>
            {title}
          </h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </div>
      {children ? <div className="px-4 pb-4 sm:px-6 sm:pb-6">{children}</div> : null}
      {footer ? (
        <div
          className={cn(
            'flex flex-wrap items-center justify-end gap-2 rounded-b-xl border-t px-4 py-3 sm:px-6',
            tone === 'danger' ? 'border-destructive/30 bg-destructive/5' : 'border-border bg-muted/40',
          )}
        >
          {footer}
        </div>
      ) : null}
    </section>
  );
}

/** Small inline validation message tied to a field through `aria-describedby`. */
export function FieldError({ id, children }: { id: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {children}
    </p>
  );
}
