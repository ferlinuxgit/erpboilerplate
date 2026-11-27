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

async function postAction<T>(url: string, fallback: string, body: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getCsrfHeader() },
    body: JSON.stringify(body),
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
/** Aviso previo a la emisión (ver `issueWarnings`): ninguno bloquea; el de VIES pide confirmación. */
export type IssueWarningView = { code: string; message: string; requiresConfirmation?: boolean };

export function IssueConfirmDialog({
  confirmDisabled = false,
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
  /** Falta una confirmación expresa (p. ej. la del NIF-IVA): no deja emitir todavía. */
  confirmDisabled?: boolean;
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
      {summary ? <div className="rounded-surface border border-window-dark-shadow bg-window-panel p-3 text-sm" data-testid="invoice-issue-summary">{summary}</div> : null}
      {error ? <InlineAlert data-testid="invoice-issue-error" role="alert" tone="danger">{error}</InlineAlert> : null}
      <DialogFooter>
        <Button disabled={pending} id={cancelId} onClick={onClose} type="button" variant="outline">
          Seguir editando
        </Button>
        <SubmitButton data-testid="invoice-issue-confirm" disabled={confirmDisabled} onClick={onConfirm} pending={pending} pendingLabel="Emitiendo…" type="button">
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
  warnings = [],
}: {
  invoiceId: string;
  isCreditNote?: boolean;
  size?: "default" | "sm";
  /** Se muestra como opción del menú "Más" del listado. */
  asMenuItem?: boolean;
  summary?: ReactNode;
  /** Avisos que se enseñan en la confirmación; los que piden confirmación añaden una casilla. */
  warnings?: IssueWarningView[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const noun = isCreditNote ? "rectificativa" : "factura";
  const needsViesConfirmation = warnings.some((warning) => warning.code === "VIES" && warning.requiresConfirmation);
  const confirmId = useId();

  async function issue() {
    setPending(true);
    setError(null);
    try {
      const issued = await postAction<{ number: string }>(`/api/invoices/${invoiceId}/issue`, `No se pudo emitir la ${noun}.`, needsViesConfirmation && confirmed ? { confirmVies: true } : {});
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

  const openDialog = () => { setError(null); setConfirmed(false); setOpen(true); };
  const fullSummary = warnings.length > 0 ? (
    <div className="space-y-2">
      {summary}
      <ul className="space-y-1 text-xs" data-testid="invoice-issue-warnings">
        {warnings.map((warning) => <li key={warning.code}><strong>Aviso:</strong> {warning.message}</li>)}
      </ul>
      {needsViesConfirmation ? (
        <label className="flex cursor-pointer items-start gap-2 text-xs font-medium" htmlFor={confirmId}>
          <input checked={confirmed} className="mt-0.5 accent-primary" data-testid="invoice-issue-confirm-vies" id={confirmId} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />
          <span>Confirmo que he comprobado que el NIF-IVA del cliente es válido para operaciones intracomunitarias y quiero emitir la factura sin IVA.</span>
        </label>
      ) : null}
    </div>
  ) : summary;

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
        confirmDisabled={needsViesConfirmation && !confirmed}
        error={error}
        isCreditNote={isCreditNote}
        onClose={() => setOpen(false)}
        onConfirm={() => void issue()}
        open={open}
        pending={pending}
        summary={fullSummary}
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
