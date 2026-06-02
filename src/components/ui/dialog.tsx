import * as React from "react";

import { cn } from "@/lib/utils";

type DialogProps = {
  children: React.ReactNode;
  initialFocusId?: string;
  open: boolean;
  onClose: () => void;
  title: string;
};

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function Dialog({ children, initialFocusId, onClose, open, title }: DialogProps) {
  const titleId = React.useId();
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const initialElement = initialFocusId ? document.getElementById(initialFocusId) : null;
    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(focusableSelector);
    requestAnimationFrame(() => {
      (initialElement instanceof HTMLElement ? initialElement : firstFocusable ?? closeButtonRef.current)?.focus();
    });
  }, [initialFocusId, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
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
        aria-labelledby={titleId}
        aria-modal="true"
        className={cn("relative w-full max-w-lg rounded-lg border bg-background p-4 shadow-lg")}
        ref={dialogRef}
        role="dialog"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold" id={titleId}>{title}</h2>
          <button ref={closeButtonRef} className="text-sm text-muted-foreground hover:text-foreground" onClick={onClose} type="button">
            Cerrar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
