"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { InlineAlert } from "@/components/ui/page";
import { getCsrfHeader } from "@/lib/csrf-client";

async function postAction<T>(url: string, fallback: string): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getCsrfHeader() },
    body: JSON.stringify({}),
  });
  if (!response.ok) throw new Error(await readApiError(response, fallback));
  return (await response.json()) as T;
}

export function issueDialogDescription(isCreditNote: boolean) {
  return isCreditNote
    ? "Se asignará el número definitivo de la serie de rectificativas, se contabilizará y reducirá lo pendiente de la factura original. Después no podrás cambiarla."
    : "Se asignará el número definitivo de la serie, se guardarán los datos fiscales actuales del cliente y de tu empresa y se contabilizará. Después no podrás cambiar cliente, fechas, líneas ni importes: para corregirla tendrás que crear una factura rectificativa.";
}

/**
 * Confirmación única de emisión (irreversible), compartida por la ficha, el listado, el formulario
 * de nueva factura, la edición de borradores y las rectificativas. Enter nunca emite sin pasar por aquí.
 */
export function IssueConfirmDialog({
  error,
  isCreditNote = false,
  onClose,
  onConfirm,
  open,
  pending,
  summary,
}: {
  open: boolean;
  pending: boolean;
  error?: string | null;
  isCreditNote?: boolean;
  /** Resumen concreto (cliente, total, vencimiento) para saber exactamente qué se emite. */
  summary?: ReactNode;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const cancelId = useId();
  const noun = isCreditNote ? "rectificativa" : "factura";
  return (
    <Dialog
      description={issueDialogDescription(isCreditNote)}
      initialFocusId={cancelId}
      onClose={() => { if (!pending) onClose(); }}
      open={open}
      size="sm"
      title={`¿Emitir la ${noun}?`}
    >
      {summary ? <div className="rounded-[2px] border border-window-dark-shadow bg-window-panel p-3 text-sm" data-testid="invoice-issue-summary">{summary}</div> : null}
      {error ? <InlineAlert data-testid="invoice-issue-error" role="alert" tone="danger">{error}</InlineAlert> : null}
      <DialogFooter>
        <Button disabled={pending} id={cancelId} onClick={onClose} type="button" variant="outline">
          Seguir editando
        </Button>
        <SubmitButton data-testid="invoice-issue-confirm" onClick={onConfirm} pending={pending} pendingLabel="Emitiendo…" type="button">
          Emitir ahora
        </SubmitButton>
      </DialogFooter>
    </Dialog>
  );
}

/**
 * "Emitir factura": confirma (acción irreversible) y emite el borrador. Tras emitir la factura
 * tiene número definitivo, se contabiliza y ya no se puede editar.
 */
export function IssueInvoiceButton({
  asMenuItem = false,
  invoiceId,
  isCreditNote = false,
  size = "default",
  summary,
}: {
  invoiceId: string;
  isCreditNote?: boolean;
  size?: "default" | "sm";
  /** Se muestra como opción del menú "Más" del listado. */
  asMenuItem?: boolean;
  summary?: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noun = isCreditNote ? "rectificativa" : "factura";

  async function issue() {
    setPending(true);
    setError(null);
    try {
      const issued = await postAction<{ number: string }>(`/api/invoices/${invoiceId}/issue`, `No se pudo emitir la ${noun}.`);
      setOpen(false);
      toast.success(`${isCreditNote ? "Rectificativa" : "Factura"} ${issued.number} emitida correctamente.`);
      router.refresh();
    } catch (issueError) {
      const message = errorMessage(issueError, `No se pudo emitir la ${noun}.`);
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  const openDialog = () => { setError(null); setOpen(true); };

  return (
    <>
      {asMenuItem ? (
        <DropdownMenuItem data-testid={`invoice-issue-menu-${invoiceId}`} onClick={openDialog}>
          Emitir {noun}…
        </DropdownMenuItem>
      ) : (
        <Button data-testid="invoice-issue-button" onClick={openDialog} size={size} type="button">
          Emitir {noun}
        </Button>
      )}
      <IssueConfirmDialog
        error={error}
        isCreditNote={isCreditNote}
        onClose={() => setOpen(false)}
        onConfirm={() => void issue()}
        open={open}
        pending={pending}
        summary={summary}
      />
    </>
  );
}

/** "Duplicar": crea un borrador nuevo con las mismas líneas y cliente, con fecha de hoy. */
export function DuplicateInvoiceButton({
  asMenuItem = false,
  invoiceId,
  size = "default",
  variant = "outline",
}: {
  invoiceId: string;
  size?: "default" | "sm";
  variant?: "outline" | "secondary";
  asMenuItem?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function duplicate() {
    setPending(true);
    try {
      const created = await postAction<{ id: string }>(`/api/invoices/${invoiceId}/duplicate`, "No se pudo duplicar la factura.");
      toast.success("Borrador creado a partir de la factura, con fecha de hoy. Revisa fechas e importes y emítelo.");
      router.push(`/invoices/${created.id}/edit`);
      router.refresh();
    } catch (duplicateError) {
      toast.error(errorMessage(duplicateError, "No se pudo duplicar la factura."));
    } finally {
      setPending(false);
    }
  }

  if (asMenuItem) {
    return (
      <DropdownMenuItem data-testid={`invoice-duplicate-menu-${invoiceId}`} disabled={pending} onClick={() => void duplicate()}>
        {pending ? "Duplicando…" : "Duplicar"}
      </DropdownMenuItem>
    );
  }

  return (
    <SubmitButton data-testid="invoice-duplicate-button" onClick={() => void duplicate()} pending={pending} pendingLabel="Duplicando…" size={size} type="button" variant={variant}>
      Duplicar
    </SubmitButton>
  );
}
