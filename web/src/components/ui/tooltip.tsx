import type * as React from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

/** Mounted once at the app root (main.tsx). */
export function TooltipProvider({ delayDuration = 250, skipDelayDuration = 300, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={skipDelayDuration} {...props} />;
}

export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          'z-[60] w-fit max-w-64 origin-(--radix-tooltip-content-transform-origin) rounded-md bg-foreground px-2 py-1 text-xs leading-snug font-medium text-background shadow-md',
          'animate-in fade-in-0 zoom-in-95 duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          'flex items-center gap-1.5 text-balance',
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export interface HintProps {
  /** Tooltip text (or node). When empty the child is rendered untouched. */
  label: React.ReactNode;
  children: React.ReactElement;
  side?: React.ComponentProps<typeof TooltipPrimitive.Content>['side'];
  align?: React.ComponentProps<typeof TooltipPrimitive.Content>['align'];
  /** Keyboard shortcut shown after the label, e.g. "⌘S". */
  shortcut?: string;
  delayDuration?: number;
  disabled?: boolean;
}

/** One-line tooltip: `<Hint label="Reload"><Button size="icon">…</Button></Hint>`. */
export function Hint({ label, children, side, align, shortcut, delayDuration, disabled }: HintProps) {
  if (!label || disabled) return children;
  return (
    <Tooltip delayDuration={delayDuration}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} align={align}>
        <span>{label}</span>
        {shortcut ? <span className="text-background/60">{shortcut}</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}
