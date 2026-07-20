import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";

import { EditPurchaseOrderForm } from "@/components/purchases/edit-purchase-order-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { item, partner, purchaseOrder, purchaseOrderLine } from "@/db/schema";
import { listSupplierPartners } from "@/server/supplier-invoices/service";

export default async function EditPurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const tenantContext = await requireContext("purchase.write");

  const { id } = await params;
  const [order] = await db.select({ id: purchaseOrder.id, number: purchaseOrder.number, status: purchaseOrder.status, supplierName: partner.name }).from(purchaseOrder).innerJoin(partner, eq(partner.id, purchaseOrder.supplierPartnerId)).where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.companyId, tenantContext.company.id))).limit(1);
  if (!order) notFound();
  const [lines, items, suppliers] = await Promise.all([
    db.select().from(purchaseOrderLine).where(eq(purchaseOrderLine.purchaseOrderId, id)),
    db.select({ id: item.id, sku: item.sku, name: item.name, costPrice: item.costPrice }).from(item).where(and(eq(item.companyId, tenantContext.company.id), eq(item.isActive, true))).orderBy(asc(item.name)),
    listSupplierPartners(tenantContext.company.id),
  ]);

  return (
    <PageShell>
      <PageHeader eyebrow="Pedidos de compra" title="Editar pedido de compra" description={order.number} backHref={`/purchases/${order.id}`} backLabel="Volver al pedido" />
      <PageSection title="Datos del pedido" description="Modifica proveedor, líneas y transiciones manuales antes de que existan recepciones o facturas.">
        <EditPurchaseOrderForm orderId={order.id} currencyCode={tenantContext.company.baseCurrencyCode} defaultNumber={order.number} defaultStatus={order.status} defaultSupplierName={order.supplierName} initialLines={lines} items={items} suppliers={suppliers} />
      </PageSection>
    </PageShell>
  );
}
