import type * as React from 'react';
import { Progress as ProgressPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

export interface ProgressProps extends React.ComponentProps<typeof ProgressPrimitive.Root> {
  /** Classes for the filled bar (e.g. `bg-brand-gradient`, `bg-destructive`). */
  indicatorClassName?: string;
}

export function Progress({ className, indicatorClassName, value, max = 100, ...props }: ProgressProps) {
  const percent = value == null ? null : Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      max={max}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-secondary', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          'h-full w-full flex-1 rounded-full bg-primary transition-transform duration-300 ease-out',
          percent === null && 'animate-pulse',
          indicatorClassName,
        )}
        style={{ transform: `translateX(-${100 - (percent ?? 100)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
