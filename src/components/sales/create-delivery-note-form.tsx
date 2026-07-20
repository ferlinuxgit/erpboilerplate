"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";

type DeliveryOrder = {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  lines: Array<{ id: string; itemId: string | null; description: string; orderedQuantity: number; deliveredQuantity: number; pendingQuantity: number }>;
};

export function CreateDeliveryNoteForm({ orders, warehouses, initialOrderId }: { orders: DeliveryOrder[]; warehouses: Array<{ id: string; name: string }>; initialOrderId?: string }) {
  const router = useRouter();
  const [salesOrderId, setSalesOrderId] = useState(initialOrderId && orders.some((order) => order.id === initialOrderId) ? initialOrderId : orders[0]?.id ?? "");
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [issuedAt, setIssuedAt] = useState(new Date().toISOString().slice(0, 10));
  const selected = orders.find((order) => order.id === salesOrderId);
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries(orders.flatMap((order) => order.lines.map((line) => [line.id, String(line.pendingQuantity)]))));
  const [loading, setLoading] = useState(false);
  const selectedLines = useMemo(() => selected?.lines ?? [], [selected]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const lines = selectedLines.flatMap((line) => {
      const quantity = Number(quantities[line.id] ?? 0);
      return quantity > 0 ? [{ salesOrderLineId: line.id, quantity }] : [];
    });
    if (lines.length === 0) return toast.error("Indica al menos una cantidad a entregar.");
    if (selectedLines.some((line) => Number(quantities[line.id] ?? 0) > line.pendingQuantity + 0.0005)) return toast.error("Una cantidad supera lo pendiente de entrega.");
    setLoading(true);
    try {
      const response = await fetch("/api/delivery-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ salesOrderId, warehouseId, customerId: selected?.customerId, issuedAt, lines }),
      });
      const payload = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
      if (!response.ok || !payload?.id) throw new Error(payload?.message ?? "No se pudo crear el albarán.");
      toast.success("Albarán creado y stock actualizado.");
      router.push(`/sales/delivery-notes/${payload.id}`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo crear el albarán.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={submit}>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2"><Label htmlFor="delivery-order">Pedido confirmado</Label><Select id="delivery-order" onChange={(event) => setSalesOrderId(event.target.value)} value={salesOrderId}>{orders.map((order) => <option key={order.id} value={order.id}>{order.number} · {order.customerName}</option>)}</Select></div>
        <div className="space-y-2"><Label htmlFor="delivery-warehouse">Almacén de salida</Label><Select id="delivery-warehouse" onChange={(event) => setWarehouseId(event.target.value)} value={warehouseId}>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</Select></div>
        <div className="space-y-2"><Label htmlFor="delivery-date">Fecha de entrega</Label><Input id="delivery-date" onChange={(event) => setIssuedAt(event.target.value)} required type="date" value={issuedAt} /></div>
      </div>
      <section className="space-y-3" aria-labelledby="delivery-lines-title">
        <div><h2 className="font-semibold" id="delivery-lines-title">Cantidades a entregar</h2><p className="mt-1 text-sm text-muted-foreground">Puedes completar una entrega parcial; el pedido conservará las cantidades pendientes.</p></div>
        <div className="overflow-x-auto rounded-xl border"><table className="w-full text-sm"><thead className="bg-muted/40 text-left"><tr><th className="p-3 font-medium">Concepto</th><th className="p-3 text-right font-medium">Pedido</th><th className="p-3 text-right font-medium">Entregado</th><th className="p-3 text-right font-medium">Pendiente</th><th className="p-3 text-right font-medium">Esta entrega</th></tr></thead><tbody>{selectedLines.map((line) => <tr className="border-t" key={line.id}><td className="p-3 font-medium">{line.description}</td><td className="p-3 text-right font-mono">{line.orderedQuantity.toLocaleString("es-ES")}</td><td className="p-3 text-right font-mono">{line.deliveredQuantity.toLocaleString("es-ES")}</td><td className="p-3 text-right font-mono">{line.pendingQuantity.toLocaleString("es-ES")}</td><td className="p-3"><Input aria-label={`Cantidad a entregar de ${line.description}`} className="ml-auto w-28 text-right font-mono" max={line.pendingQuantity} min="0" onChange={(event) => setQuantities((current) => ({ ...current, [line.id]: event.target.value }))} step="0.001" type="number" value={quantities[line.id] ?? "0"} /></td></tr>)}</tbody></table></div>
      </section>
      <div className="flex justify-end"><Button disabled={loading || !salesOrderId || !warehouseId} type="submit">{loading ? "Generando…" : "Registrar entrega"}</Button></div>
    </form>
  );
}
