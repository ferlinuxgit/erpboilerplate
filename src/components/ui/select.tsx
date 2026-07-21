import * as React from "react";

import { cn } from "@/lib/utils";

type SelectProps = React.ComponentProps<"select">;

export function Select({ className, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        "flex h-8 w-full rounded-[1px] border border-window-dark-shadow bg-window-highlight px-2 py-1 font-mono text-[0.78rem] text-window-text shadow-[inset_1px_1px_0_var(--window-shadow),inset_-1px_-1px_0_var(--window-surface)] outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-55",
        className,
      )}
      {...props}
    />
  );
}
