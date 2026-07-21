"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";

type PendingReceiptLine = {
  purchaseOrderLineId: string;
  itemId: string;
  description: string;
  orderedQuantity: number;
  receivedQuantity: number;
  pendingQuantity: number;
};

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
  const [receivedAt, setReceivedAt] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [supplierDocumentNumber, setSupplierDocumentNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>(
    Object.fromEntries(
      lines.map((line) => [line.purchaseOrderLineId, line.pendingQuantity.toString()]),
    ),
  );

  const canOpen = warehouses.length > 0 && lines.length > 0;

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
          onSubmit={async (event) => {
            event.preventDefault();
            const receiptLines = lines.flatMap((line) => {
              const quantity = Number(quantities[line.purchaseOrderLineId] ?? 0);
              return quantity > 0 ? [{ purchaseOrderLineId: line.purchaseOrderLineId, itemId: line.itemId, quantity }] : [];
            });
            if (receiptLines.length === 0) {
              toast.error("Indica al menos una cantidad recibida.");
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
                  receivedAt: new Date(
                    `${receivedAt}T12:00:00.000Z`,
                  ).toISOString(),
                  supplierDocumentNumber,
                  notes,
                  lines: receiptLines,
                }),
              });
              const payload = (await response.json().catch(() => null)) as {
                id?: string;
                message?: string;
              } | null;
              if (!response.ok || !payload?.id)
                throw new Error(
                  payload?.message ?? "No se pudo registrar la recepción.",
                );
              toast.success("Recepción registrada.");
              setOpen(false);
              router.push(`/purchases/receipts/${payload.id}`);
              router.refresh();
            } catch (error) {
              toast.error(
                error instanceof Error ? error.message : "Error inesperado.",
              );
            } finally {
              setLoading(false);
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`receipt-warehouse-${orderId}`}>Almacén</Label>
              <Select
                id={`receipt-warehouse-${orderId}`}
                onChange={(event) => setWarehouseId(event.target.value)}
                required
                value={warehouseId}
              >
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`receipt-date-${orderId}`}>Fecha</Label>
              <Input
                id={`receipt-date-${orderId}`}
                onChange={(event) => setReceivedAt(event.target.value)}
                required
                type="date"
                value={receivedAt}
              />
            </div>
            <div className="space-y-2"><Label htmlFor={`receipt-document-${orderId}`}>Albarán del proveedor</Label><Input id={`receipt-document-${orderId}`} onChange={(event) => setSupplierDocumentNumber(event.target.value)} placeholder="Número externo opcional" value={supplierDocumentNumber} /></div>
            <div className="space-y-2"><Label htmlFor={`receipt-notes-${orderId}`}>Observaciones</Label><Input id={`receipt-notes-${orderId}`} onChange={(event) => setNotes(event.target.value)} placeholder="Incidencias, embalaje o control de calidad" value={notes} /></div>
          </div>

          <div className="overflow-hidden rounded-[2px] border">
            <div className="grid grid-cols-[1fr_5.5rem_5.5rem_7rem] gap-3 bg-muted/45 px-3 py-2 text-xs font-semibold text-muted-foreground">
              <span>Artículo</span>
              <span className="text-right">Pedido</span>
              <span className="text-right">Recibido</span>
              <span className="text-right">Esta entrega</span>
            </div>
            {lines.map((line) => (
              <div
                className="grid grid-cols-[1fr_5.5rem_5.5rem_7rem] items-center gap-3 border-t px-3 py-2.5 text-sm"
                key={line.purchaseOrderLineId}
              >
                <span className="min-w-0 truncate font-medium">
                  {line.description}
                </span>
                <span className="text-right font-mono">
                  {line.orderedQuantity.toLocaleString("es-ES")}
                </span>
                <span className="text-right font-mono">
                  {line.receivedQuantity.toLocaleString("es-ES")}
                </span>
                <Input
                  aria-label={`Cantidad recibida de ${line.description}`}
                  className="h-9 text-right font-mono"
                  max={line.pendingQuantity}
                  min="0"
                  onChange={(event) =>
                    setQuantities((current) => ({
                      ...current,
                      [line.purchaseOrderLineId]: event.target.value,
                    }))
                  }
                  required
                  step="0.001"
                  type="number"
                  value={quantities[line.purchaseOrderLineId] ?? ""}
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
            <Button disabled={loading} type="submit">
              {loading ? "Registrando…" : "Confirmar recepción"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
