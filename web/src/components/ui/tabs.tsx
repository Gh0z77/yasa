import type * as React from 'react';
import { Tabs as TabsPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

export function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col gap-4', className)} {...props} />;
}

export interface TabsListProps extends React.ComponentProps<typeof TabsPrimitive.List> {
  /** `segmented` = pill switcher (default); `underline` = page-level tabs with a bottom border. */
  variant?: 'segmented' | 'underline';
}

export function TabsList({ className, variant = 'segmented', ...props }: TabsListProps) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(
        'group/tabs-list inline-flex w-fit max-w-full items-center text-muted-foreground',
        variant === 'segmented'
          ? 'h-9 gap-0.5 rounded-lg bg-muted p-[3px]'
          : 'scrollbar-none h-10 w-full justify-start gap-5 overflow-x-auto border-b border-border',
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 text-sm font-medium whitespace-nowrap outline-none select-none',
        'transition-[color,background-color,box-shadow,border-color] duration-150 hover:text-foreground',
        'focus-visible:ring-[3px] focus-visible:ring-ring/45 disabled:pointer-events-none disabled:opacity-50',
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // segmented
        'group-data-[variant=segmented]/tabs-list:h-full group-data-[variant=segmented]/tabs-list:flex-1 group-data-[variant=segmented]/tabs-list:rounded-md group-data-[variant=segmented]/tabs-list:px-3',
        'group-data-[variant=segmented]/tabs-list:data-[state=active]:bg-background group-data-[variant=segmented]/tabs-list:data-[state=active]:text-foreground group-data-[variant=segmented]/tabs-list:data-[state=active]:shadow-sm',
        'dark:group-data-[variant=segmented]/tabs-list:data-[state=active]:bg-accent',
        // underline
        'group-data-[variant=underline]/tabs-list:-mb-px group-data-[variant=underline]/tabs-list:h-10 group-data-[variant=underline]/tabs-list:rounded-none group-data-[variant=underline]/tabs-list:border-b-2 group-data-[variant=underline]/tabs-list:border-transparent group-data-[variant=underline]/tabs-list:px-0.5',
        'group-data-[variant=underline]/tabs-list:data-[state=active]:border-foreground group-data-[variant=underline]/tabs-list:data-[state=active]:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45', className)}
      {...props}
    />
  );
}
