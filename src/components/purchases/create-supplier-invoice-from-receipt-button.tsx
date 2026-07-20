"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";

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
  const [taxRates, setTaxRates] = useState(
    payload.lines.map((line) => line.taxRate.toString()),
  );

  return (
    <>
      <Button
        disabled={payload.lines.length === 0}
        onClick={() => setOpen(true)}
        title={
          payload.lines.length === 0
            ? "La recepción no contiene líneas facturables."
            : undefined
        }
        type="button"
      >
        Registrar factura
      </Button>
      <Dialog
        description="Completa los datos del documento recibido. El número interno se asignará desde la serie configurada."
        initialFocusId={`supplier-document-${payload.goodsReceiptId}`}
        onClose={() => setOpen(false)}
        open={open}
        size="lg"
        title="Registrar factura de proveedor"
      >
        <form
          className="space-y-5"
          onSubmit={async (event) => {
            event.preventDefault();
            if (dueDate && dueDate < issueDate) {
              toast.error("El vencimiento no puede ser anterior a la emisión.");
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
                    taxRate: Number(taxRates[index] ?? line.taxRate),
                  })),
                }),
              });
              const result = (await response.json().catch(() => null)) as {
                id?: string;
                message?: string;
              } | null;
              if (!response.ok || !result?.id)
                throw new Error(
                  result?.message ??
                    "No se pudo registrar la factura de proveedor.",
                );
              toast.success("Factura de proveedor registrada.");
              setOpen(false);
              router.push(`/expenses/${result.id}`);
              router.refresh();
            } catch (error) {
              toast.error(
                error instanceof Error
                  ? error.message
                  : "No se pudo registrar la factura de proveedor.",
              );
            } finally {
              setPending(false);
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-3">
              <Label htmlFor={`supplier-document-${payload.goodsReceiptId}`}>
                Número del proveedor
              </Label>
              <Input
                id={`supplier-document-${payload.goodsReceiptId}`}
                onChange={(event) =>
                  setSupplierDocumentNumber(event.target.value)
                }
                placeholder="Ej. F-2026-1842"
                required
                value={supplierDocumentNumber}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`supplier-issue-${payload.goodsReceiptId}`}>
                Emisión
              </Label>
              <Input
                id={`supplier-issue-${payload.goodsReceiptId}`}
                onChange={(event) => setIssueDate(event.target.value)}
                required
                type="date"
                value={issueDate}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`supplier-due-${payload.goodsReceiptId}`}>
                Vencimiento
              </Label>
              <Input
                id={`supplier-due-${payload.goodsReceiptId}`}
                min={issueDate}
                onChange={(event) => setDueDate(event.target.value)}
                type="date"
                value={dueDate}
              />
            </div>
            <div className="space-y-2 sm:col-span-3">
              <Label htmlFor={`supplier-notes-${payload.goodsReceiptId}`}>
                Notas
              </Label>
              <Textarea
                id={`supplier-notes-${payload.goodsReceiptId}`}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Condiciones, referencia o información interna"
                value={notes}
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border">
            <div className="grid grid-cols-[1fr_5.5rem_6rem] gap-3 bg-muted/45 px-3 py-2 text-xs font-semibold text-muted-foreground">
              <span>Concepto</span>
              <span className="text-right">Cantidad</span>
              <span className="text-right">IVA %</span>
            </div>
            {payload.lines.map((line, index) => (
              <div
                className="grid grid-cols-[1fr_5.5rem_6rem] items-center gap-3 border-t px-3 py-2.5 text-sm"
                key={`${line.itemId ?? line.description}-${index}`}
              >
                <span className="min-w-0 truncate font-medium">
                  {line.description}
                </span>
                <span className="text-right font-mono">
                  {line.quantity.toLocaleString("es-ES")}
                </span>
                <Input
                  aria-label={`IVA de ${line.description}`}
                  className="h-9 text-right font-mono"
                  max="100"
                  min="0"
                  onChange={(event) =>
                    setTaxRates((current) =>
                      current.map((rate, rateIndex) =>
                        rateIndex === index ? event.target.value : rate,
                      ),
                    )
                  }
                  required
                  step="0.01"
                  type="number"
                  value={taxRates[index] ?? "21"}
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              onClick={() => setOpen(false)}
              type="button"
              variant="outline"
            >
              Cancelar
            </Button>
            <Button disabled={pending} type="submit">
              {pending ? "Registrando…" : "Registrar factura"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
