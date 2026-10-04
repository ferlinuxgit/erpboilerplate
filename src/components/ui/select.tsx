import * as React from "react";

import { cn } from "@/lib/utils";

type SelectProps = React.ComponentProps<"select">;

export function Select({ className, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        "flex h-8 w-full rounded-control border border-window-dark-shadow bg-window-highlight px-2 py-1 font-mono text-control text-window-text shadow-sunken outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-55 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/25 max-sm:min-h-9 pointer-coarse:min-h-10 max-sm:text-base",
        className,
      )}
      {...props}
    />
  );
}
