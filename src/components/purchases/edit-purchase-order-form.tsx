"use client";

import { Plus, Trash } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/format";
import { getManualPurchaseOrderStatuses } from "@/lib/document-pipelines";
import { purchaseOrderStatusLabels, statusLabel } from "@/lib/status-labels";

type Line = { id: string; itemId: string; description: string; quantity: string; unitPrice: string };
type ItemOption = { id: string; sku: string; name: string; costPrice: string };

export function EditPurchaseOrderForm({
  orderId,
  currencyCode,
  defaultNumber,
  defaultStatus,
  defaultSupplierName,
  initialLines,
  items,
  suppliers,
}: {
  orderId: string;
  currencyCode: string;
  defaultNumber: string;
  defaultStatus: string;
  defaultSupplierName: string;
  initialLines: Array<{ id: string; itemId: string | null; description: string; quantity: string; unitPrice: string }>;
  items: ItemOption[];
  suppliers: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [number, setNumber] = useState(defaultNumber);
  const [status, setStatus] = useState(defaultStatus);
  const [supplierName, setSupplierName] = useState(defaultSupplierName);
  const [lines, setLines] = useState<Line[]>(initialLines.map((line) => ({ ...line, itemId: line.itemId ?? "" })));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const statuses = getManualPurchaseOrderStatuses(defaultStatus);
  const total = useMemo(() => lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unitPrice), 0), [lines]);

  function updateLine(id: string, patch: Partial<Line>) {
    setLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line));
  }

  function selectItem(id: string, itemId: string) {
    const selected = items.find((item) => item.id === itemId);
    updateLine(id, { itemId, ...(selected ? { description: selected.name, unitPrice: selected.costPrice } : {}) });
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const parsedLines = lines.map((line) => ({ itemId: line.itemId || undefined, description: line.description.trim(), quantity: Number(line.quantity), unitPrice: Number(line.unitPrice) }));
      if (!supplierName.trim()) throw new Error("El proveedor es obligatorio.");
      if (parsedLines.length === 0 || parsedLines.some((line) => !line.description || !Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.unitPrice) || line.unitPrice < 0)) {
        throw new Error("Revisa las descripciones, cantidades y precios de las líneas.");
      }
      const response = await fetch(`/api/purchases/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ number, status, supplierName, lines: parsedLines }),
      });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) throw new Error(payload?.message ?? "No se pudo actualizar el pedido.");
      toast.success("Pedido actualizado correctamente.");
      router.push(`/purchases/${orderId}`);
      router.refresh();
    } catch (submissionError) {
      const message = submissionError instanceof Error ? submissionError.message : "Error inesperado.";
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form aria-describedby={error ? "edit-purchase-order-error" : undefined} className="space-y-6" onSubmit={onSubmit}>
      <section className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2"><Label htmlFor="edit-po-supplier">Proveedor</Label><Input id="edit-po-supplier" list="edit-po-suppliers" onChange={(event) => setSupplierName(event.target.value)} required value={supplierName} /><datalist id="edit-po-suppliers">{suppliers.map((supplier) => <option key={supplier.id} value={supplier.name} />)}</datalist></div>
        <div className="space-y-2"><Label htmlFor="edit-po-number">Número</Label><Input id="edit-po-number" onChange={(event) => setNumber(event.target.value)} required value={number} /></div>
        <div className="space-y-2"><Label htmlFor="edit-po-status">Estado operativo</Label><Select id="edit-po-status" onChange={(event) => setStatus(event.target.value)} required value={status}>{statuses.map((option) => <option key={option} value={option}>{statusLabel(purchaseOrderStatusLabels, option)}</option>)}</Select><p className="text-xs text-muted-foreground">Recepción, facturación y pago actualizan el estado automáticamente.</p></div>
      </section>

      <section className="space-y-3" aria-labelledby="edit-purchase-lines-title">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-3"><div><h2 className="font-semibold" id="edit-purchase-lines-title">Líneas del pedido</h2><p className="mt-1 text-sm text-muted-foreground">Modifica cantidades y precios antes de registrar recepciones.</p></div><Button onClick={() => setLines((current) => [...current, { id: crypto.randomUUID(), itemId: "", description: "", quantity: "1", unitPrice: "0" }])} type="button" variant="outline"><Plus aria-hidden="true" />Añadir línea</Button></div>
        {lines.map((line, index) => (
          <fieldset className="grid gap-3 rounded-lg border bg-muted/15 p-4 lg:grid-cols-[1fr_1.4fr_0.55fr_0.7fr_auto] lg:items-end" key={line.id}>
            <legend className="sr-only">Línea {index + 1}</legend>
            <div className="space-y-2"><Label htmlFor={`edit-po-item-${line.id}`}>Artículo</Label><Select id={`edit-po-item-${line.id}`} onChange={(event) => selectItem(line.id, event.target.value)} value={line.itemId}><option value="">Concepto libre</option>{items.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}</Select></div>
            <div className="space-y-2"><Label htmlFor={`edit-po-description-${line.id}`}>Descripción</Label><Input id={`edit-po-description-${line.id}`} onChange={(event) => updateLine(line.id, { description: event.target.value })} required value={line.description} /></div>
            <div className="space-y-2"><Label htmlFor={`edit-po-quantity-${line.id}`}>Cantidad</Label><Input id={`edit-po-quantity-${line.id}`} min="0.001" onChange={(event) => updateLine(line.id, { quantity: event.target.value })} required step="0.001" type="number" value={line.quantity} /></div>
            <div className="space-y-2"><Label htmlFor={`edit-po-price-${line.id}`}>Precio</Label><Input id={`edit-po-price-${line.id}`} min="0" onChange={(event) => updateLine(line.id, { unitPrice: event.target.value })} required step="0.01" type="number" value={line.unitPrice} /></div>
            <Button aria-label={`Eliminar línea ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((candidate) => candidate.id !== line.id))} size="icon" type="button" variant="ghost"><Trash aria-hidden="true" /></Button>
          </fieldset>
        ))}
      </section>

      <div className="flex flex-col gap-4 border-t pt-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm text-muted-foreground">Total del pedido</p><p className="font-mono text-2xl font-semibold">{formatMoney(total, currencyCode)}</p></div><Button disabled={isLoading || lines.length === 0} type="submit">{isLoading ? "Guardando…" : "Guardar cambios"}</Button></div>
      {error ? <p className="text-sm text-destructive" id="edit-purchase-order-error" role="alert">{error}</p> : null}
    </form>
  );
}
