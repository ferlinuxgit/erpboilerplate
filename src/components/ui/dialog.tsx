"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DialogProps = {
  children: React.ReactNode;
  className?: string;
  description?: React.ReactNode;
  initialFocusId?: string;
  open: boolean;
  onClose: () => void;
  size?: "sm" | "md" | "lg" | "xl";
  title: string;
};

const sizeClasses = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function Dialog({ children, className, description, initialFocusId, onClose, open, size = "md", title }: DialogProps) {
  const titleId = React.useId();
  const descriptionId = React.useId();
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const initialElement = initialFocusId ? document.getElementById(initialFocusId) : null;
    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(focusableSelector);
    requestAnimationFrame(() => {
      (initialElement instanceof HTMLElement ? initialElement : firstFocusable ?? closeButtonRef.current)?.focus();
    });
    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [initialFocusId, open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-2"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
          return;
        }

        if (event.key !== "Tab") {
          return;
        }

        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
          .filter((element) => element.getClientRects().length > 0);
        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <button aria-label="Cerrar diálogo" className="absolute inset-0" onClick={onClose} type="button" />
      <div
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={cn(
          "relative flex max-h-[calc(100dvh-0.5rem)] w-full flex-col overflow-hidden rounded-t-[2px] border border-window-dark-shadow bg-window-surface shadow-[inset_1px_1px_0_var(--window-highlight),inset_-1px_-1px_0_var(--window-shadow),8px_8px_0_rgba(0,0,0,0.35)] sm:max-h-[calc(100dvh-1rem)] sm:rounded-[2px]",
          sizeClasses[size],
          className,
        )}
        ref={dialogRef}
        role="dialog"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-window-dark-shadow bg-chrome-active px-2 py-1 text-chrome-active-foreground">
          <div className="min-w-0 space-y-0.5">
            <h2 className="font-mono text-sm font-bold" id={titleId}>{title}</h2>
            {description ? <p className="text-xs text-chrome-active-foreground/80" id={descriptionId}>{description}</p> : null}
          </div>
          <Button aria-label="Cerrar diálogo" onClick={onClose} ref={closeButtonRef} size="icon" type="button" variant="ghost">
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="min-h-0 overflow-y-auto p-3">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function DialogFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mt-3 flex flex-col-reverse gap-1.5 border-t border-window-shadow pt-2 sm:flex-row sm:justify-end", className)}>{children}</div>;
}
