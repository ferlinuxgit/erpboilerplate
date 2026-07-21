import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-[1px] border border-window-dark-shadow bg-window-highlight px-2 py-1 font-mono text-[0.78rem] text-window-text shadow-[inset_1px_1px_0_var(--window-shadow),inset_-1px_-1px_0_var(--window-surface)] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs file:font-bold file:text-foreground placeholder:text-window-muted/75 focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-55 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/25",
        className
      )}
      {...props}
    />
  )
}

export { Input }
