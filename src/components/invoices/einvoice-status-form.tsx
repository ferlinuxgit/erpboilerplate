"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AccessibleField, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { EINVOICE_REJECTION_CODES, EINVOICE_STATUSES, einvoiceRejectionLabels, einvoiceStatusLabels, type EInvoiceStatus } from "@/server/einvoice/status";

const statusHelp: Record<EInvoiceStatus, string> = {
  SENT: "Día en que entregaste la factura electrónica al cliente o a su plataforma.",
  RECEIVED: "Día en que el cliente (o su plataforma) confirmó que la recibió.",
  ACCEPTED: "Día en que el cliente dio su conformidad a la factura.",
  REJECTED: "Día en que el cliente rechazó la factura. Tendrás que aclararlo con él o emitir una rectificativa.",
  PAID: "Día en que el cliente pagó la factura por completo.",
};

/** Anota a mano un estado de la factura electrónica (lo que el cliente comunica). */
export function EInvoiceStatusForm({ invoiceId, today, available }: { invoiceId: string; today: string; available: EInvoiceStatus[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<EInvoiceStatus>(available[0] ?? "SENT");
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [rejectionCode, setRejectionCode] = useState<string>(EINVOICE_REJECTION_CODES[0]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (status === "REJECTED" && !reason.trim()) {
      setError("Indica el motivo del rechazo.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/einvoice/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ status, effectiveDate, ...(status === "REJECTED" ? { rejectionCode, reason: reason.trim() } : {}) }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo anotar el estado."));
      toast.success(`Estado anotado: ${einvoiceStatusLabels[status].toLowerCase()}.`);
      setReason("");
      router.refresh();
    } catch (submitError) {
      const message = errorMessage(submitError, "No se pudo anotar el estado.");
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  if (available.length === 0) return null;

  return (
    <form className="grid gap-3 sm:grid-cols-4" data-testid="einvoice-status-form" noValidate onSubmit={submit}>
      <AccessibleField helperText={statusHelp[status]} id="einvoice-status" label="Estado">
        <Select data-testid="einvoice-status-select" id="einvoice-status" onChange={(event) => setStatus(event.target.value as EInvoiceStatus)} value={status}>
          {EINVOICE_STATUSES.filter((option) => available.includes(option)).map((option) => (
            <option key={option} value={option}>{einvoiceStatusLabels[option]}</option>
          ))}
        </Select>
      </AccessibleField>
      <AccessibleField id="einvoice-status-date" label="Fecha" required>
        <Input data-testid="einvoice-status-date" id="einvoice-status-date" max={today} onChange={(event) => setEffectiveDate(event.target.value)} type="date" value={effectiveDate} />
      </AccessibleField>
      {status === "REJECTED" ? (
        <>
          <AccessibleField id="einvoice-rejection-code" label="Tipo de rechazo">
            <Select id="einvoice-rejection-code" onChange={(event) => setRejectionCode(event.target.value)} value={rejectionCode}>
              {EINVOICE_REJECTION_CODES.map((code) => <option key={code} value={code}>{einvoiceRejectionLabels[code]}</option>)}
            </Select>
          </AccessibleField>
          <AccessibleField error={error && !reason.trim() ? error : undefined} id="einvoice-rejection-reason" label="Motivo" required>
            <Input data-testid="einvoice-rejection-reason" id="einvoice-rejection-reason" maxLength={1000} onChange={(event) => setReason(event.target.value)} placeholder="Qué alega el cliente" value={reason} />
          </AccessibleField>
        </>
      ) : null}
      <div className="flex items-end sm:col-span-4">
        <Button data-testid="einvoice-status-submit" disabled={pending || !effectiveDate} size="sm" type="submit">
          {pending ? "Anotando…" : "Anotar estado"}
        </Button>
        {error && (status !== "REJECTED" || reason.trim()) ? <p className="ml-3 text-xs text-destructive" role="alert">{error}</p> : null}
      </div>
    </form>
  );
}
