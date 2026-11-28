"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { AccessibleField, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { getCsrfHeader } from "@/lib/csrf-client";

type FaceAction = { action: "send"; email: string } | { action: "refresh" } | { action: "cancel"; reason: string };

const failureMessages: Record<FaceAction["action"], string> = {
  send: "No se pudo remitir la factura a FACe.",
  refresh: "No se pudo consultar el estado en FACe.",
  cancel: "No se pudo solicitar la anulación en FACe.",
};

/**
 * Botones de FACe en la ficha de la factura: remitir (con confirmación, porque registra la factura
 * ante la Administración y no se puede deshacer), consultar el estado y solicitar la anulación.
 */
export function EInvoiceFaceActions({
  environmentLabel,
  invoiceId,
  sent,
  production,
}: {
  environmentLabel: string;
  invoiceId: string;
  /** Ya tiene número de registro de FACe. */
  sent: boolean;
  production: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"send" | "cancel" | null>(null);
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run(request: FaceAction) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/einvoice/face`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify(request),
      });
      if (!response.ok) throw new Error(await readApiError(response, failureMessages[request.action]));
      toast.success(request.action === "send" ? "Factura registrada en FACe." : request.action === "cancel" ? "Anulación solicitada en FACe." : "Estado de FACe actualizado.");
      setDialog(null);
      router.refresh();
    } catch (runError) {
      const message = errorMessage(runError, failureMessages[request.action]);
      setError(message);
      toast.error(message);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {!sent ? (
          <Button data-testid="einvoice-face-send" disabled={pending} onClick={() => { setError(null); setDialog("send"); }} size="sm" type="button" variant="default">
            Enviar a FACe
          </Button>
        ) : (
          <>
            <Button data-testid="einvoice-face-refresh" disabled={pending} onClick={() => run({ action: "refresh" })} size="sm" type="button" variant="outline">
              {pending && !dialog ? "Consultando…" : "Consultar estado en FACe"}
            </Button>
            <Button data-testid="einvoice-face-cancel" disabled={pending} onClick={() => { setError(null); setDialog("cancel"); }} size="sm" type="button" variant="outline">
              Solicitar anulación
            </Button>
          </>
        )}
      </div>

      <Dialog
        description={`Se remitirá la factura firmada al entorno de ${environmentLabel} de FACe.${production ? " Quedará registrada ante la Administración destinataria y no se puede deshacer: solo cabe pedir su anulación." : " Es el entorno de pruebas: la factura no llega a ninguna Administración."}`}
        initialFocusId="einvoice-face-email"
        onClose={() => setDialog(null)}
        open={dialog === "send"}
        size="sm"
        title="¿Enviar la factura a FACe?"
      >
        <form noValidate onSubmit={(event) => { event.preventDefault(); void run({ action: "send", email }); }}>
          <AccessibleField error={error ?? undefined} helperText="FACe enviará a este correo los avisos sobre la factura (registro, tramitación, pago)." id="einvoice-face-email" label="Correo para los avisos" required>
            <Input autoComplete="email" data-testid="einvoice-face-email" id="einvoice-face-email" maxLength={200} onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
          </AccessibleField>
          <DialogFooter>
            <Button onClick={() => setDialog(null)} size="sm" type="button" variant="outline">Cancelar</Button>
            <Button data-testid="einvoice-face-send-confirm" disabled={pending || !email.trim()} size="sm" type="submit">
              {pending ? "Enviando…" : "Enviar a FACe"}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>

      <Dialog
        description="FACe trasladará la solicitud al órgano destinatario, que decide si la acepta. Si se acepta, la factura deja de tramitarse."
        initialFocusId="einvoice-face-reason"
        onClose={() => setDialog(null)}
        open={dialog === "cancel"}
        size="sm"
        title="¿Solicitar la anulación en FACe?"
      >
        <form noValidate onSubmit={(event) => { event.preventDefault(); void run({ action: "cancel", reason }); }}>
          <AccessibleField error={error ?? undefined} id="einvoice-face-reason" label="Motivo de la anulación" required>
            <Input data-testid="einvoice-face-reason" id="einvoice-face-reason" maxLength={1000} onChange={(event) => setReason(event.target.value)} value={reason} />
          </AccessibleField>
          <DialogFooter>
            <Button onClick={() => setDialog(null)} size="sm" type="button" variant="outline">Volver</Button>
            <Button data-testid="einvoice-face-cancel-confirm" disabled={pending || !reason.trim()} size="sm" type="submit">
              {pending ? "Solicitando…" : "Solicitar anulación"}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
