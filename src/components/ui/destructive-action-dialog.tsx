"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { InlineAlert } from "@/components/ui/page";

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
  return (
    <Dialog
      description={description}
      initialFocusId="destructive-action-cancel"
      onClose={() => { if (!isSubmitting) onCancel(); }}
      open={open}
      size="sm"
      title={title}
    >
      {errorMessage ? <InlineAlert role="alert" tone="danger">{errorMessage}</InlineAlert> : null}
      <DialogFooter>
        <Button disabled={isSubmitting} id="destructive-action-cancel" onClick={onCancel} type="button" variant="outline">
          {cancelLabel}
        </Button>
        <Button disabled={isSubmitting} onClick={onConfirm} type="button" variant="destructive">
          {isSubmitting ? "Procesando…" : confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
