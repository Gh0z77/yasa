import * as React from "react";

import { cn } from "@/lib/utils";

/** Loading placeholder. Size it with utilities: <Skeleton className="h-4 w-40" /> */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
