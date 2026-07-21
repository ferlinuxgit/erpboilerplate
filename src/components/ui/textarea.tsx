import * as React from "react";

import { cn } from "@/lib/utils";

type TextareaProps = React.ComponentProps<"textarea">;

export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        "flex min-h-20 w-full rounded-[1px] border border-window-dark-shadow bg-window-highlight px-2 py-1.5 font-mono text-[0.78rem] text-window-text shadow-[inset_1px_1px_0_var(--window-shadow),inset_-1px_-1px_0_var(--window-surface)] outline-none placeholder:text-window-muted/75 focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-55",
        className,
      )}
      {...props}
    />
  );
}
