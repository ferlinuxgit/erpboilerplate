"use client";

import { useEffect, useId, useRef } from "react";

import { Button } from "@/components/ui/button";

export type DestructiveActionDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  isSubmitting?: boolean;
  errorMessage?: string | null;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export function DestructiveActionDialog({
  cancelLabel = "Cancelar",
  confirmLabel,
  description,
  errorMessage,
  isSubmitting = false,
  onCancel,
  onConfirm,
  open,
  title,
}: DestructiveActionDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelButtonRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const describedBy = errorMessage ? `${descriptionId} ${errorId}` : descriptionId;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !isSubmitting) {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <div
        aria-describedby={describedBy}
        aria-labelledby={titleId}
        aria-modal="true"
        className="w-full max-w-md rounded-xl border bg-background p-5 shadow-xl"
        role="dialog"
      >
        <div className="space-y-2">
          <h2 className="text-lg font-semibold" id={titleId}>
            {title}
          </h2>
          <p className="text-sm text-muted-foreground" id={descriptionId}>
            {description}
          </p>
        </div>
        {errorMessage ? (
          <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" id={errorId} role="alert">
            {errorMessage}
          </p>
        ) : null}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={cancelButtonRef} type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            {cancelLabel}
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={isSubmitting}>
            {isSubmitting ? "Eliminando..." : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
