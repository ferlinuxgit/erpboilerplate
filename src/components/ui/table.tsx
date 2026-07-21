import * as React from "react";

import { cn } from "@/lib/utils";

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return <table className={cn("w-full caption-bottom font-mono text-[0.75rem] tabular-nums", className)} {...props} />;
}

export function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("bg-window-panel [&_tr]:border-b [&_tr]:border-window-dark-shadow", className)} {...props} />;
}

export function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

export function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("border-b border-window-shadow hover:bg-window-highlight data-[state=selected]:bg-primary data-[state=selected]:text-primary-foreground", className)} {...props} />;
}

export function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return <th className={cn("h-8 border-r border-window-shadow px-2 text-left align-middle text-[0.65rem] font-bold uppercase tracking-[0.04em] text-window-muted last:border-r-0", className)} {...props} />;
}

export function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("border-r border-window-shadow/60 px-2 py-1.5 align-middle last:border-r-0", className)} {...props} />;
}
