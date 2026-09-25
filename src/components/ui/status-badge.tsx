import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

const toneClasses: Record<StatusTone, string> = {
  neutral: "border-window-dark-shadow bg-window-panel text-window-muted",
  success: "border-success/70 bg-success/10 text-success-text",
  warning: "border-warning/70 bg-warning/10 text-warning-text",
  danger: "border-destructive/70 bg-destructive/10 text-danger-text",
  info: "border-info/70 bg-info/10 text-info-text",
};

type StatusBadgeProps = {
  children: ReactNode;
  tone?: StatusTone;
  className?: string;
};

export function StatusBadge({
  children,
  className,
  tone = "neutral",
}: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-[1px] border px-1.5 py-0.5 font-mono text-xs leading-4 font-bold uppercase tracking-[0.02em] shadow-[inset_1px_1px_0_rgba(255,255,255,0.45)]",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
