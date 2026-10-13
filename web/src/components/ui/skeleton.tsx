import type * as React from 'react';
import { cn } from '@/lib/utils';

/** Loading placeholder; size it with utilities (`h-4 w-32`). */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-foreground/[0.07] dark:bg-foreground/10', className)}
      {...props}
    />
  );
}
