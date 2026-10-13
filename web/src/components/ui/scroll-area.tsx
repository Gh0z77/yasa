import type * as React from 'react';
import { cn } from '@/lib/utils';

export interface ScrollAreaProps extends React.ComponentProps<'div'> {
  /** Scroll axis. Default: vertical. */
  orientation?: 'vertical' | 'horizontal' | 'both';
  /** Hide the scrollbar entirely (still scrollable). */
  hideScrollbar?: boolean;
}

/**
 * Styled native overflow container (SPEC §11.2): keeps native momentum scrolling, keyboard scrolling and
 * `scrollIntoView`, with the thin themed scrollbar from globals.css. Give it a bounded height (`h-64`, `flex-1 min-h-0`).
 */
export function ScrollArea({ className, orientation = 'vertical', hideScrollbar = false, ...props }: ScrollAreaProps) {
  return (
    <div
      data-slot="scroll-area"
      className={cn(
        'relative min-h-0 min-w-0 overscroll-contain',
        orientation === 'vertical' && 'overflow-x-hidden overflow-y-auto',
        orientation === 'horizontal' && 'overflow-x-auto overflow-y-hidden',
        orientation === 'both' && 'overflow-auto',
        hideScrollbar ? 'scrollbar-none' : 'scrollbar-thin',
        className,
      )}
      {...props}
    />
  );
}
