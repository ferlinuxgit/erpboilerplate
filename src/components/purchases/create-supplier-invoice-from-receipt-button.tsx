"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PercentInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDecimalInput, parseDecimalInput } from "@/lib/format";

type ReceiptInvoicePayload = {
  supplierPartnerId: string;
  purchaseOrderId: string;
  goodsReceiptId: string;
  lines: Array<{
    itemId?: string;
    description: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
  }>;
};

type FieldErrors = Partial<Record<"supplierDocumentNumber" | "issueDate" | "dueDate", string>>;

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function toIsoDate(value: string) {
  return new Date(`${value}T12:00:00.000Z`).toISOString();
}

export function CreateSupplierInvoiceFromReceiptButton({
  payload,
}: {
  payload: ReceiptInvoicePayload;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [supplierDocumentNumber, setSupplierDocumentNumber] = useState("");
  const [issueDate, setIssueDate] = useState(todayInputValue());
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [taxRates, setTaxRates] = useState(payload.lines.map((line) => line.taxRate.toString()));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [taxRateErrors, setTaxRateErrors] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const idSuffix = payload.goodsReceiptId;

  function validate() {
    const nextErrors: FieldErrors = {};
    const nextTaxErrors: Record<number, string> = {};
    if (!supplierDocumentNumber.trim()) nextErrors.supplierDocumentNumber = "Indica el número de la factura del proveedor.";
    if (!issueDate) nextErrors.issueDate = "Indica la fecha de emisión.";
    if (dueDate && issueDate && dueDate < issueDate) nextErrors.dueDate = "El vencimiento no puede ser anterior a la emisión.";
    const parsedRates = payload.lines.map((line, index) => {
      const rate = parseDecimalInput(taxRates[index] ?? line.taxRate, { maximumFractionDigits: 2 });
      if (rate === null || rate < 0 || rate > 100) nextTaxErrors[index] = "Entre 0 y 100.";
      return rate ?? line.taxRate;
    });
    setFieldErrors(nextErrors);
    setTaxRateErrors(nextTaxErrors);
    const valid = Object.keys(nextErrors).length === 0 && Object.keys(nextTaxErrors).length === 0;
    return valid ? parsedRates : null;
  }

  return (
    <>
      <Button
        disabled={payload.lines.length === 0}
        onClick={() => setOpen(true)}
        title={payload.lines.length === 0 ? "La recepción no contiene líneas facturables." : undefined}
        type="button"
      >
        Registrar factura
      </Button>
      <Dialog
        description="Completa los datos del documento recibido. El número interno se asignará desde la serie configurada."
        initialFocusId={`supplier-document-${idSuffix}`}
        onClose={() => setOpen(false)}
        open={open}
        size="lg"
        title="Registrar factura de proveedor"
      >
        <form
          className="space-y-3"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            setFormError(null);
            const parsedRates = validate();
            if (!parsedRates) {
              const message = "Revisa los campos marcados antes de registrar la factura.";
              setFormError(message);
              toast.error(message);
              return;
            }
            setPending(true);
            try {
              const response = await fetch("/api/supplier-invoices", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...getCsrfHeader(),
                },
                body: JSON.stringify({
                  ...payload,
                  supplierDocumentNumber,
                  issueDate: toIsoDate(issueDate),
                  dueDate: dueDate ? toIsoDate(dueDate) : undefined,
                  notes,
                  lines: payload.lines.map((line, index) => ({
                    ...line,
                    taxRate: parsedRates[index] ?? line.taxRate,
                  })),
                }),
              });
              if (!response.ok) throw new Error(await readApiError(response, "No se pudo registrar la factura de proveedor."));
              const result = (await response.json().catch(() => null)) as { id?: string } | null;
              if (!result?.id) throw new Error("La factura se ha registrado, pero no se pudo abrir. Revisa el listado de gastos.");
              toast.success("Factura de proveedor registrada.");
              setOpen(false);
              router.push(`/expenses/${result.id}`);
              router.refresh();
            } catch (error) {
              const message = errorMessage(error, "No se pudo registrar la factura de proveedor. Inténtalo de nuevo.");
              setFormError(message);
              toast.error(message);
            } finally {
              setPending(false);
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <AccessibleField
              className="sm:col-span-3"
              error={fieldErrors.supplierDocumentNumber}
              helperText="Tal como aparece en la factura recibida."
              id={`supplier-document-${idSuffix}`}
              label="Número del proveedor"
              required
            >
              <Input id={`supplier-document-${idSuffix}`} onChange={(event) => setSupplierDocumentNumber(event.target.value)} placeholder="Ej. F-2026-1842" value={supplierDocumentNumber} />
            </AccessibleField>
            <AccessibleField error={fieldErrors.issueDate} id={`supplier-issue-${idSuffix}`} label="Emisión" required>
              <Input id={`supplier-issue-${idSuffix}`} onChange={(event) => setIssueDate(event.target.value)} type="date" value={issueDate} />
            </AccessibleField>
            <AccessibleField error={fieldErrors.dueDate} helperText="Opcional." id={`supplier-due-${idSuffix}`} label="Vencimiento">
              <Input id={`supplier-due-${idSuffix}`} min={issueDate} onChange={(event) => setDueDate(event.target.value)} type="date" value={dueDate} />
            </AccessibleField>
            <AccessibleField className="sm:col-span-3" id={`supplier-notes-${idSuffix}`} label="Notas">
              <Textarea id={`supplier-notes-${idSuffix}`} onChange={(event) => setNotes(event.target.value)} placeholder="Condiciones, referencia o información interna" value={notes} />
            </AccessibleField>
          </div>

          <div className="overflow-hidden rounded-[2px] border border-window-dark-shadow bg-window-surface" role="group" aria-label="IVA por línea">
            <div className="grid grid-cols-[1fr_5.5rem_6rem] gap-3 border-b border-window-dark-shadow bg-window-panel px-3 py-2 font-mono text-[0.65rem] font-bold uppercase tracking-[0.04em] text-window-muted" aria-hidden="true">
              <span>Concepto</span>
              <span className="text-right">Cantidad</span>
              <span className="text-right">IVA %</span>
            </div>
            {payload.lines.map((line, index) => {
              const rateError = taxRateErrors[index];
              const errorId = `supplier-tax-${idSuffix}-${index}-error`;
              return (
                <div className="border-t border-window-shadow px-3 py-2 first:border-t-0" key={`${line.itemId ?? line.description}-${index}`}>
                  <div className="grid grid-cols-[1fr_5.5rem_6rem] items-center gap-3 font-mono text-xs tabular-nums">
                    <span className="min-w-0 truncate font-bold">{line.description}</span>
                    <span className="text-right">{formatDecimalInput(line.quantity, { maximumFractionDigits: 3 }) || "0"}</span>
                    <PercentInput
                      aria-describedby={rateError ? errorId : undefined}
                      aria-invalid={rateError ? true : undefined}
                      aria-label={`IVA de ${line.description}`}
                      className="font-mono"
                      onChange={(event) =>
                        setTaxRates((current) => current.map((rate, rateIndex) => (rateIndex === index ? event.target.value : rate)))
                      }
                      value={taxRates[index] ?? "21"}
                    />
                  </div>
                  {rateError ? <p className="mt-1 text-right font-mono text-xs text-destructive" id={errorId} role="alert">{rateError}</p> : null}
                </div>
              );
            })}
          </div>

          <FormErrorMessage>{formError}</FormErrorMessage>

          <DialogFooter>
            <Button onClick={() => setOpen(false)} type="button" variant="outline">
              Cancelar
            </Button>
            <SubmitButton pending={pending} pendingLabel="Registrando…">
              Registrar factura
            </SubmitButton>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
