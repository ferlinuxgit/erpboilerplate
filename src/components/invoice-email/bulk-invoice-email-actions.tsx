"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { InlineAlert } from "@/components/ui/page";
import { getCsrfHeader } from "@/lib/csrf-client";

type BulkResult = { invoiceId: string; number: string | null; ok: boolean; message: string };

type Mode = "email" | "remind";

const copy: Record<Mode, { button: string; title: string; description: string; confirm: string; url: string }> = {
  email: {
    button: "Enviar por email",
    title: "Enviar facturas por email",
    description: "Cada factura se envía en PDF al email de facturación de su cliente, con tu plantilla de «Envío de factura». Los borradores y los clientes sin email se omiten.",
    confirm: "Enviar",
    url: "/api/invoice-emails/bulk",
  },
  remind: {
    button: "Recordar cobro",
    title: "Enviar recordatorios de cobro",
    description: "A cada factura vencida se le envía el siguiente recordatorio (amable, firme o último aviso). Se omiten las no vencidas, las cobradas y los clientes excluidos.",
    confirm: "Enviar recordatorios",
    url: "/api/dunning/remind",
  },
};

/** Acción en bloque sobre las facturas seleccionadas: enviarlas o reclamar su cobro. */
export function BulkInvoiceEmailButton({
  invoiceIds,
  mode,
  onDone,
}: {
  invoiceIds: string[];
  mode: Mode;
  onDone?: () => void;
}) {
  const router = useRouter();
  const cancelId = useId();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [results, setResults] = useState<BulkResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const text = copy[mode];

  async function run() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(text.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ invoiceIds }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo completar el envío."));
      const data = (await response.json()) as { results: BulkResult[]; sent: number; failed: number };
      setResults(data.results);
      if (data.sent > 0) toast.success(`${data.sent} ${data.sent === 1 ? "email enviado" : "emails enviados"}.`);
      if (data.failed > 0) toast.warning(`${data.failed} sin enviar. Revisa el detalle.`);
      router.refresh();
    } catch (runError) {
      setError(errorMessage(runError, "No se pudo completar el envío."));
    } finally {
      setPending(false);
    }
  }

  function close() {
    if (pending) return;
    setOpen(false);
    if (results) onDone?.();
    setResults(null);
    setError(null);
  }

  return (
    <>
      <Button disabled={invoiceIds.length === 0} onClick={() => setOpen(true)} size="sm" type="button" variant="outline">
        {text.button} ({invoiceIds.length})
      </Button>
      <Dialog description={text.description} initialFocusId={cancelId} onClose={close} open={open} size="md" title={text.title}>
        {results ? (
          <ul className="max-h-72 space-y-1 overflow-y-auto text-sm" data-testid="bulk-email-results">
            {results.map((result) => (
              <li className={result.ok ? "" : "text-destructive"} key={result.invoiceId}>
                <span className="font-mono font-semibold">{result.number ?? "Factura"}</span>: {result.ok ? "" : "sin enviar. "}{result.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">{invoiceIds.length === 1 ? "Se procesará 1 factura seleccionada." : `Se procesarán ${invoiceIds.length} facturas seleccionadas.`}</p>
        )}
        {error ? <InlineAlert className="mt-3" tone="danger">{error}</InlineAlert> : null}
        <DialogFooter>
          <Button disabled={pending} id={cancelId} onClick={close} type="button" variant="outline">
            {results ? "Cerrar" : "Cancelar"}
          </Button>
          {results ? null : (
            <SubmitButton onClick={() => void run()} pending={pending} pendingLabel="Enviando…" type="button">
              {text.confirm}
            </SubmitButton>
          )}
        </DialogFooter>
      </Dialog>
    </>
  );
}
