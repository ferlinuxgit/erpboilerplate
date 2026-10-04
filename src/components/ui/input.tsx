import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, inputMode, onWheel, ...props }: React.ComponentProps<"input">) {
  const isNumber = type === "number"

  return (
    <input
      type={type}
      data-slot="input"
      // Numeric fields: decimal keypad on mobile and no accidental value
      // changes when the page is scrolled with the pointer over the field.
      inputMode={inputMode ?? (isNumber ? "decimal" : undefined)}
      onWheel={onWheel ?? (isNumber ? (event) => event.currentTarget.blur() : undefined)}
      className={cn(
        // 16px on small screens prevents iOS Safari from zooming on focus.
        "h-8 w-full min-w-0 rounded-control border border-window-dark-shadow bg-window-highlight px-2 py-1 font-mono text-control text-window-text shadow-sunken outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs file:font-bold file:text-foreground placeholder:text-window-muted/75 focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-55 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/25 max-sm:min-h-9 pointer-coarse:min-h-10 max-sm:text-base",
        className
      )}
      {...props}
    />
  )
}

export { Input }
