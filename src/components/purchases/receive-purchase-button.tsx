"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { QuantityInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDecimalInput, parseDecimalInput } from "@/lib/format";

type PendingReceiptLine = {
  purchaseOrderLineId: string;
  itemId: string;
  description: string;
  orderedQuantity: number;
  receivedQuantity: number;
  pendingQuantity: number;
};

type FieldErrors = Partial<Record<"warehouseId" | "receivedAt", string>>;

function formatQuantity(value: number) {
  return formatDecimalInput(value, { maximumFractionDigits: 3 }) || "0";
}

export function ReceivePurchaseButton({
  lines,
  orderId,
  warehouses,
}: {
  lines: PendingReceiptLine[];
  orderId: string;
  warehouses: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 10));
  const [supplierDocumentNumber, setSupplierDocumentNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>(
    Object.fromEntries(lines.map((line) => [line.purchaseOrderLineId, line.pendingQuantity.toString()])),
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const canOpen = warehouses.length > 0 && lines.length > 0;

  function validate() {
    const nextFieldErrors: FieldErrors = {};
    const nextLineErrors: Record<string, string> = {};
    if (!warehouseId) nextFieldErrors.warehouseId = "Selecciona el almacén que recibe la mercancía.";
    if (!receivedAt) nextFieldErrors.receivedAt = "Indica la fecha de recepción.";
    const receiptLines = lines.flatMap((line) => {
      const raw = quantities[line.purchaseOrderLineId] ?? "";
      const quantity = raw.trim() === "" ? 0 : parseDecimalInput(raw, { maximumFractionDigits: 3 });
      if (quantity === null) {
        nextLineErrors[line.purchaseOrderLineId] = "Cantidad no válida.";
        return [];
      }
      if (quantity < 0) {
        nextLineErrors[line.purchaseOrderLineId] = "No puede ser negativa.";
        return [];
      }
      return quantity > 0 ? [{ purchaseOrderLineId: line.purchaseOrderLineId, itemId: line.itemId, quantity }] : [];
    });
    setFieldErrors(nextFieldErrors);
    setLineErrors(nextLineErrors);
    if (Object.keys(nextFieldErrors).length > 0) return { receiptLines, error: "Revisa los campos marcados antes de confirmar la recepción." };
    if (Object.keys(nextLineErrors).length > 0) return { receiptLines, error: "Revisa las cantidades recibidas: alguna no es válida." };
    if (receiptLines.length === 0) return { receiptLines, error: "Indica al menos una cantidad recibida." };
    return { receiptLines, error: null };
  }

  return (
    <>
      <Button
        disabled={!canOpen}
        onClick={() => setOpen(true)}
        title={
          warehouses.length === 0
            ? "Crea un almacén antes de registrar la recepción."
            : lines.length === 0
              ? "El pedido no tiene cantidades pendientes de recepción."
              : undefined
        }
        type="button"
      >
        Registrar recepción
      </Button>
      <Dialog
        description="Indica el almacén, la fecha y las cantidades realmente recibidas. Puedes dejar cantidades pendientes para otra recepción."
        initialFocusId={`receipt-warehouse-${orderId}`}
        onClose={() => setOpen(false)}
        open={open}
        size="lg"
        title="Registrar recepción de mercancía"
      >
        <form
          className="space-y-3"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            setFormError(null);
            const { error, receiptLines } = validate();
            if (error) {
              setFormError(error);
              toast.error(error);
              return;
            }
            setLoading(true);
            try {
              const response = await fetch("/api/goods-receipts", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...getCsrfHeader(),
                },
                body: JSON.stringify({
                  purchaseOrderId: orderId,
                  warehouseId,
                  receivedAt: new Date(`${receivedAt}T12:00:00.000Z`).toISOString(),
                  supplierDocumentNumber,
                  notes,
                  lines: receiptLines,
                }),
              });
              if (!response.ok) throw new Error(await readApiError(response, "No se pudo registrar la recepción."));
              const payload = (await response.json().catch(() => null)) as { id?: string } | null;
              if (!payload?.id) throw new Error("La recepción se ha registrado, pero no se pudo abrir. Revisa el listado de recepciones.");
              toast.success("Recepción registrada y stock actualizado.");
              setOpen(false);
              router.push(`/purchases/receipts/${payload.id}`);
              router.refresh();
            } catch (submissionError) {
              const message = errorMessage(submissionError, "No se pudo registrar la recepción. Inténtalo de nuevo.");
              setFormError(message);
              toast.error(message);
            } finally {
              setLoading(false);
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <AccessibleField error={fieldErrors.warehouseId} id={`receipt-warehouse-${orderId}`} label="Almacén" required>
              <Select id={`receipt-warehouse-${orderId}`} onChange={(event) => setWarehouseId(event.target.value)} value={warehouseId}>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </Select>
            </AccessibleField>
            <AccessibleField error={fieldErrors.receivedAt} id={`receipt-date-${orderId}`} label="Fecha" required>
              <Input id={`receipt-date-${orderId}`} onChange={(event) => setReceivedAt(event.target.value)} type="date" value={receivedAt} />
            </AccessibleField>
            <AccessibleField helperText="Opcional; número del albarán que trae el proveedor." id={`receipt-document-${orderId}`} label="Albarán del proveedor">
              <Input id={`receipt-document-${orderId}`} onChange={(event) => setSupplierDocumentNumber(event.target.value)} placeholder="Número externo opcional" value={supplierDocumentNumber} />
            </AccessibleField>
            <AccessibleField id={`receipt-notes-${orderId}`} label="Observaciones">
              <Input id={`receipt-notes-${orderId}`} onChange={(event) => setNotes(event.target.value)} placeholder="Incidencias, embalaje o control de calidad" value={notes} />
            </AccessibleField>
          </div>

          <div className="overflow-hidden rounded-[2px] border border-window-dark-shadow bg-window-surface" role="group" aria-label="Cantidades recibidas">
            <div className="grid grid-cols-[1fr_5.5rem_5.5rem_7rem] gap-3 border-b border-window-dark-shadow bg-window-panel px-3 py-2 font-mono text-[0.65rem] font-bold uppercase tracking-[0.04em] text-window-muted" aria-hidden="true">
              <span>Artículo</span>
              <span className="text-right">Pedido</span>
              <span className="text-right">Recibido</span>
              <span className="text-right">Esta entrega</span>
            </div>
            {lines.map((line) => {
              const lineError = lineErrors[line.purchaseOrderLineId];
              const errorId = `receipt-line-${line.purchaseOrderLineId}-error`;
              return (
                <div className="border-t border-window-shadow px-3 py-2 first:border-t-0" key={line.purchaseOrderLineId}>
                  <div className="grid grid-cols-[1fr_5.5rem_5.5rem_7rem] items-center gap-3 font-mono text-xs tabular-nums">
                    <span className="min-w-0 truncate font-bold">{line.description}</span>
                    <span className="text-right">{formatQuantity(line.orderedQuantity)}</span>
                    <span className="text-right">{formatQuantity(line.receivedQuantity)}</span>
                    <QuantityInput
                      aria-describedby={lineError ? errorId : undefined}
                      aria-invalid={lineError ? true : undefined}
                      aria-label={`Cantidad recibida de ${line.description}`}
                      className="font-mono"
                      onChange={(event) =>
                        setQuantities((current) => ({
                          ...current,
                          [line.purchaseOrderLineId]: event.target.value,
                        }))
                      }
                      value={quantities[line.purchaseOrderLineId] ?? ""}
                    />
                  </div>
                  {lineError ? <p className="mt-1 text-right font-mono text-xs text-destructive" id={errorId} role="alert">{lineError}</p> : null}
                </div>
              );
            })}
          </div>

          <FormErrorMessage>{formError}</FormErrorMessage>

          <DialogFooter>
            <Button onClick={() => setOpen(false)} type="button" variant="outline">
              Cancelar
            </Button>
            <SubmitButton pending={loading} pendingLabel="Registrando…">
              Confirmar recepción
            </SubmitButton>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
