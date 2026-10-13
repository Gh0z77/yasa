import type * as React from 'react';
import { cn } from '@/lib/utils';

/** Shared field chrome for Input / Textarea / SelectTrigger. */
export const fieldClasses = [
  'w-full min-w-0 rounded-lg border border-input bg-background text-foreground shadow-xs outline-none',
  'transition-[color,border-color,box-shadow,background-color] duration-150',
  'placeholder:text-muted-foreground/80 selection:bg-brand-from/25',
  'hover:border-foreground/25',
  'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30',
  'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
  'aria-invalid:border-destructive aria-invalid:ring-destructive/25',
  'dark:bg-input/20',
].join(' ');

export function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldClasses,
        'h-9 px-3 py-1 text-sm',
        'file:mr-3 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
        className,
      )}
      {...props}
    />
  );
}
