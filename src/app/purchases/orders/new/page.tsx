import { and, asc, eq } from "drizzle-orm";
import type { Metadata } from "next";

import { CreatePurchaseOrderForm } from "@/components/purchases/create-purchase-order-form";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { item } from "@/db/schema";
import { db } from "@/lib/db";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { listSupplierPartners } from "@/server/supplier-invoices/service";

export const metadata: Metadata = { title: "Nuevo pedido de compra" };

export default async function NewPurchaseOrderPage() {
  const tenantContext = await requireContext("purchase.write");
  const canWritePurchases = can(tenantContext.membership.role, "purchase.write");
  const [items, suppliers] = await Promise.all([
    db
      .select({
        id: item.id,
        sku: item.sku,
        name: item.name,
        costPrice: item.costPrice,
      })
      .from(item)
      .where(and(eq(item.companyId, tenantContext.company.id), eq(item.isActive, true)))
      .orderBy(asc(item.name)),
    listSupplierPartners(tenantContext.company.id),
  ]);

  return (
    <PageShell>
      <PageHeader
        title="Nuevo pedido de compra"
        description={`Registra un pedido de compra para ${tenantContext.company.name}.`}
        breadcrumbs={[
          { label: "Aprovisionamiento" },
          { label: "Pedidos de compra", href: "/purchases/orders" },
          { label: "Nuevo pedido de compra" },
        ]}
      />

      <PageSection title="Datos del pedido" description="Selecciona el proveedor y añade todos los artículos o conceptos necesarios.">
        {canWritePurchases ? (
          <CreatePurchaseOrderForm
            currencyCode={tenantContext.company.baseCurrencyCode}
            items={items}
            suppliers={suppliers}
          />
        ) : (
          <EmptyState title="Solo lectura" description="Tu rol actual no permite crear pedidos de compra." />
        )}
      </PageSection>
    </PageShell>
  );
}
