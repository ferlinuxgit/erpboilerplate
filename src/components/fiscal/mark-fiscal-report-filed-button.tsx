"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { AccessibleField, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/page";
import { getCsrfHeader } from "@/lib/csrf-client";
import { dateInputValue } from "@/lib/date-input";

type MarkFiscalReportFiledButtonProps = {
  reportId: string;
  modelName: string;
  periodLabel: string;
  /** El modelo sale a ingresar: se pide también el NRC del pago (opcional). */
  hasPayment: boolean;
};

/**
 * "Marcar como presentado": pide la fecha de presentación, el número de justificante de la AEAT y,
 * si hubo pago, el NRC. Al guardarlo, el periodo queda bloqueado para nuevos documentos.
 */
export function MarkFiscalReportFiledButton({ hasPayment, modelName, periodLabel, reportId }: MarkFiscalReportFiledButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [filedAt, setFiledAt] = useState(() => dateInputValue(new Date(), "Europe/Madrid"));
  const [receiptNumber, setReceiptNumber] = useState("");
  const [nrc, setNrc] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState<string | undefined>();

  async function submit() {
    if (receiptNumber.trim().length < 6) {
      setReceiptError("Copia el número de justificante del documento que te da la AEAT al presentar.");
      return;
    }
    setReceiptError(undefined);
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/fiscal-reports/${encodeURIComponent(reportId)}/file`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ filedAt, receiptNumber: receiptNumber.trim(), nrc: nrc.trim() || null }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo marcar el modelo como presentado."));
      setOpen(false);
      toast.success(`${modelName} (${periodLabel}) marcado como presentado. El periodo queda bloqueado.`);
      router.refresh();
    } catch (submitError) {
      const message = errorMessage(submitError, "No se pudo marcar el modelo como presentado.");
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button onClick={() => { setError(null); setOpen(true); }} type="button">
        Marcar como presentado
      </Button>
      <Dialog
        description={`Guarda los datos de la presentación del ${modelName} (${periodLabel}). Después no se podrán registrar ni modificar facturas con fecha de este periodo; si hiciera falta, podrás reabrirlo indicando el motivo.`}
        initialFocusId="mark-filed-date"
        onClose={() => { if (!submitting) setOpen(false); }}
        open={open}
        size="sm"
        title="Marcar como presentado"
      >
        <form
          className="space-y-3"
          id="mark-filed-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <AccessibleField id="mark-filed-date" label="Fecha de presentación" required>
            <Input max={dateInputValue(new Date(), "Europe/Madrid")} onChange={(event) => setFiledAt(event.target.value)} required type="date" value={filedAt} />
          </AccessibleField>
          <AccessibleField
            error={receiptError}
            helperText="Aparece en el justificante (PDF) que descargas al presentar en la sede de la AEAT."
            id="mark-filed-receipt"
            label="Número de justificante"
            required
          >
            <Input autoComplete="off" inputMode="numeric" maxLength={40} onChange={(event) => setReceiptNumber(event.target.value)} required spellCheck={false} value={receiptNumber} />
          </AccessibleField>
          {hasPayment ? (
            <AccessibleField helperText="Número de referencia completo que te da el banco al pagar (opcional si domiciliaste el pago)." id="mark-filed-nrc" label="NRC del pago">
              <Input autoComplete="off" maxLength={40} onChange={(event) => setNrc(event.target.value)} spellCheck={false} value={nrc} />
            </AccessibleField>
          ) : null}
          {error ? <InlineAlert role="alert" tone="danger">{error}</InlineAlert> : null}
        </form>
        <DialogFooter>
          <Button disabled={submitting} onClick={() => setOpen(false)} type="button" variant="outline">
            Cancelar
          </Button>
          <Button disabled={submitting} form="mark-filed-form" type="submit">
            {submitting ? "Guardando…" : "Guardar como presentado"}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
