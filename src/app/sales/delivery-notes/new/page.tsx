import { and, asc, eq } from "drizzle-orm";

import { CreateDeliveryNoteForm } from "@/components/sales/create-delivery-note-form";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { customer, deliveryNote, deliveryNoteLine, salesOrder, salesOrderLine, warehouse } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";

export default async function NewDeliveryNotePage({ searchParams }: { searchParams?: Promise<{ orderId?: string }> }) {
  const ctx = await requireContext("invoice.create");
  const query = await searchParams;
  const [orders, orderLines, deliveredLines, warehouses] = await Promise.all([
    db.select({ id: salesOrder.id, number: salesOrder.number, customerId: salesOrder.customerId, customerName: customer.name }).from(salesOrder).innerJoin(customer, eq(customer.id, salesOrder.customerId)).where(and(eq(salesOrder.companyId, ctx.company.id), eq(salesOrder.status, "CONFIRMED"))).orderBy(asc(salesOrder.issueDate)),
    db.select({ id: salesOrderLine.id, salesOrderId: salesOrderLine.salesOrderId, itemId: salesOrderLine.itemId, description: salesOrderLine.description, quantity: salesOrderLine.quantity }).from(salesOrderLine).innerJoin(salesOrder, eq(salesOrder.id, salesOrderLine.salesOrderId)).where(and(eq(salesOrder.companyId, ctx.company.id), eq(salesOrder.status, "CONFIRMED"))),
    db.select({ salesOrderId: deliveryNote.salesOrderId, salesOrderLineId: deliveryNoteLine.salesOrderLineId, quantity: deliveryNoteLine.quantity }).from(deliveryNoteLine).innerJoin(deliveryNote, eq(deliveryNote.id, deliveryNoteLine.deliveryNoteId)).where(eq(deliveryNote.companyId, ctx.company.id)),
    db.select({ id: warehouse.id, name: warehouse.name }).from(warehouse).where(and(eq(warehouse.companyId, ctx.company.id), eq(warehouse.isActive, true))).orderBy(asc(warehouse.name)),
  ]);
  const deliveredByLine = new Map<string, number>();
  for (const line of deliveredLines) if (line.salesOrderLineId) deliveredByLine.set(line.salesOrderLineId, (deliveredByLine.get(line.salesOrderLineId) ?? 0) + Number(line.quantity));
  const options = orders.map((order) => ({ ...order, lines: orderLines.filter((line) => line.salesOrderId === order.id).flatMap((line) => {
    const deliveredQuantity = deliveredByLine.get(line.id) ?? 0;
    const pendingQuantity = Math.max(Number(line.quantity) - deliveredQuantity, 0);
    return pendingQuantity > 0.0005 ? [{ id: line.id, itemId: line.itemId, description: line.description, orderedQuantity: Number(line.quantity), deliveredQuantity, pendingQuantity }] : [];
  }) })).filter((order) => order.lines.length > 0);
  const ready = options.length > 0 && warehouses.length > 0;
  return <PageShell><PageHeader eyebrow="Albaranes" title="Nuevo albarán" description="Registra una entrega total o parcial y descuenta el stock del almacén seleccionado." backHref="/sales/delivery-notes" backLabel="Volver a albaranes" /><PageSection title="Preparar entrega" description="Selecciona pedido, almacén y cantidades realmente expedidas.">{ready ? <CreateDeliveryNoteForm initialOrderId={query?.orderId} orders={options} warehouses={warehouses} /> : <EmptyState title={options.length ? "Falta un almacén activo" : "No hay cantidades pendientes"} description={options.length ? "Crea o reactiva un almacén antes de registrar entregas." : "Todos los pedidos confirmados están entregados o todavía no hay pedidos preparados."} />}</PageSection></PageShell>;
}
