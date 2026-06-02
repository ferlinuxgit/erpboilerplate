import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

const toneClasses: Record<StatusTone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  danger: "border-red-200 bg-red-50 text-red-800",
  info: "border-sky-200 bg-sky-50 text-sky-800",
};

type StatusBadgeProps = {
  children: ReactNode;
  tone?: StatusTone;
  className?: string;
};

export function StatusBadge({ children, className, tone = "neutral" }: StatusBadgeProps) {
  return (
    <span className={cn("inline-flex w-fit items-center rounded-md border px-2 py-0.5 text-xs font-medium", toneClasses[tone], className)}>
      {children}
    </span>
  );
}
