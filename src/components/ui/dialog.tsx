import * as React from "react";

import { cn } from "@/lib/utils";

type DialogProps = {
  children: React.ReactNode;
  open: boolean;
  onClose: () => void;
  title: string;
};

export function Dialog({ children, onClose, open, title }: DialogProps) {
  const titleId = React.useId();
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <button aria-label="Cerrar diálogo" className="absolute inset-0" onClick={onClose} type="button" />
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className={cn("relative w-full max-w-lg rounded-lg border bg-background p-4 shadow-lg")}
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
