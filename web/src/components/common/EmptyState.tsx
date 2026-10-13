import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  /** A lucide icon component (rendered in a soft tile) … */
  icon?: LucideIcon;
  /** … or any custom visual (emoji, illustration) instead of `icon`. */
  visual?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Buttons / links shown under the text. */
  action?: ReactNode;
  /** `sm` for panels and drawers, `default` for pages. */
  size?: 'sm' | 'default';
  /** Draw a dashed frame around it. */
  bordered?: boolean;
  className?: string;
}

export function EmptyState({ icon: Icon, visual, title, description, action, size = 'default', bordered = false, className }: EmptyStateProps) {
  const small = size === 'sm';
  return (
    <div
      className={cn(
        'flex w-full flex-col items-center justify-center text-center',
        small ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-16',
        bordered && 'rounded-3xl border border-dashed border-border bg-card backdrop-blur-xl',
        className,
      )}
    >
      {visual ??
        (Icon ? (
          <div
            className={cn(
              'flex items-center justify-center rounded-2xl border border-border bg-background text-muted-foreground shadow-xs',
              small ? 'mb-1 size-10' : 'mb-2 size-14',
            )}
          >
            <Icon className={small ? 'size-5' : 'size-6'} aria-hidden="true" />
          </div>
        ) : null)}
      <h3 className={cn('font-semibold tracking-tight text-foreground', small ? 'text-sm' : 'text-lg')}>{title}</h3>
      {description ? (
        <p className={cn('max-w-sm text-balance text-muted-foreground', small ? 'text-xs' : 'text-sm')}>{description}</p>
      ) : null}
      {action ? <div className={cn('flex flex-wrap items-center justify-center gap-2', small ? 'mt-2' : 'mt-3')}>{action}</div> : null}
    </div>
  );
}
