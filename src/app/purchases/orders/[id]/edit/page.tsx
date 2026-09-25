import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";

import { EditPurchaseOrderForm } from "@/components/purchases/edit-purchase-order-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { item, partner, purchaseOrder, purchaseOrderLine } from "@/db/schema";
import { listSupplierPartners } from "@/server/supplier-invoices/service";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const tenantContext = await requireContext("purchase.write");
    const { id } = await params;
    const [row] = await db
      .select({ number: purchaseOrder.number })
      .from(purchaseOrder)
      .where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.companyId, tenantContext.company.id)))
      .limit(1);
    return { title: row ? `Editar pedido de compra ${row.number}` : "Editar pedido de compra" };
  } catch {
    return { title: "Editar pedido de compra" };
  }
}

export default async function EditPurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const tenantContext = await requireContext("purchase.write");

  const { id } = await params;
  const [order] = await db.select({ id: purchaseOrder.id, number: purchaseOrder.number, status: purchaseOrder.status, supplierPartnerId: purchaseOrder.supplierPartnerId, supplierName: partner.name }).from(purchaseOrder).innerJoin(partner, eq(partner.id, purchaseOrder.supplierPartnerId)).where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.companyId, tenantContext.company.id))).limit(1);
  if (!order) notFound();
  const [lines, items, suppliers] = await Promise.all([
    db.select().from(purchaseOrderLine).where(eq(purchaseOrderLine.purchaseOrderId, id)),
    db.select({ id: item.id, sku: item.sku, name: item.name, costPrice: item.costPrice }).from(item).where(and(eq(item.companyId, tenantContext.company.id), eq(item.isActive, true))).orderBy(asc(item.name)),
    listSupplierPartners(tenantContext.company.id),
  ]);

  return (
    <PageShell>
      <PageHeader
        title="Editar pedido de compra"
        description={order.number}
        breadcrumbs={[
          { label: "Aprovisionamiento" },
          { label: "Pedidos de compra", href: "/purchases/orders" },
          { label: order.number, href: `/purchases/orders/${order.id}` },
          { label: "Editar" },
        ]}
      />
      <PageSection title="Datos del pedido" description="Modifica proveedor, líneas y transiciones manuales antes de que existan recepciones o facturas.">
        <EditPurchaseOrderForm orderId={order.id} currencyCode={tenantContext.company.baseCurrencyCode} defaultNumber={order.number} defaultStatus={order.status} defaultSupplierId={order.supplierPartnerId} initialLines={lines} items={items} suppliers={suppliers} />
      </PageSection>
    </PageShell>
  );
}
