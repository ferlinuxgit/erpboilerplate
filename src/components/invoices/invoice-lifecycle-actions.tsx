"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
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

/**
 * "Emitir factura": confirma (acción irreversible) y emite el borrador. Tras emitir la factura
 * tiene número definitivo, se contabiliza y ya no se puede editar.
 */
export function IssueInvoiceButton({ invoiceId, isCreditNote = false, size = "default" }: { invoiceId: string; isCreditNote?: boolean; size?: "default" | "sm" }) {
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
      toast.success(`${isCreditNote ? "Rectificativa" : "Factura"} ${issued.number} emitida.`);
      router.refresh();
    } catch (issueError) {
      const message = errorMessage(issueError, `No se pudo emitir la ${noun}.`);
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button data-testid="invoice-issue-button" onClick={() => { setError(null); setOpen(true); }} size={size} type="button">
        Emitir {noun}
      </Button>
      <Dialog
        description={`Se asignará el número definitivo de la serie, se guardarán los datos fiscales actuales del cliente y de tu empresa y se contabilizará. Después no podrás cambiar cliente, fechas, líneas ni importes: para corregirla tendrás que crear una factura rectificativa.`}
        initialFocusId="invoice-issue-cancel"
        onClose={() => { if (!pending) setOpen(false); }}
        open={open}
        size="sm"
        title={`¿Emitir la ${noun}?`}
      >
        {error ? <InlineAlert data-testid="invoice-issue-error" role="alert" tone="danger">{error}</InlineAlert> : null}
        <DialogFooter>
          <Button disabled={pending} id="invoice-issue-cancel" onClick={() => setOpen(false)} type="button" variant="outline">
            Seguir editando
          </Button>
          <SubmitButton data-testid="invoice-issue-confirm" onClick={() => void issue()} pending={pending} pendingLabel="Emitiendo…" type="button">
            Emitir ahora
          </SubmitButton>
        </DialogFooter>
      </Dialog>
    </>
  );
}

/** "Duplicar": crea un borrador nuevo con las mismas líneas y cliente, con fecha de hoy. */
export function DuplicateInvoiceButton({ invoiceId, size = "default", variant = "outline" }: { invoiceId: string; size?: "default" | "sm"; variant?: "outline" | "secondary" }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function duplicate() {
    setPending(true);
    try {
      const created = await postAction<{ id: string }>(`/api/invoices/${invoiceId}/duplicate`, "No se pudo duplicar la factura.");
      toast.success("Borrador creado a partir de la factura. Revisa fechas e importes y emítelo.");
      router.push(`/invoices/${created.id}/edit`);
      router.refresh();
    } catch (duplicateError) {
      toast.error(errorMessage(duplicateError, "No se pudo duplicar la factura."));
    } finally {
      setPending(false);
    }
  }

  return (
    <SubmitButton data-testid="invoice-duplicate-button" onClick={() => void duplicate()} pending={pending} pendingLabel="Duplicando…" size={size} type="button" variant={variant}>
      Duplicar
    </SubmitButton>
  );
}
