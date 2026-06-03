import Link from "next/link";

import { PurchaseFlowActions } from "@/components/purchases/purchase-flow-actions";
import { PurchaseOrdersList } from "@/components/purchases/purchase-orders-list";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { listPurchasePipeline } from "@/server/purchases/service";

export default async function PurchasesPage() {
  const tenantContext = await requireContext("purchase.read");
  const { orders, orderLines, receipts, invoices, payments } = await listPurchasePipeline(tenantContext.company.id);
  const canWritePurchases = can(tenantContext.membership.role, "purchase.write");

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operación"
        title="Compras"
        description="Ciclo completo: pedido de compra -> recepción de mercancía -> factura proveedor -> pago."
        backHref="/dashboard"
        backLabel="Volver al panel"
        meta={<StatusBadge tone={canWritePurchases ? "success" : "warning"}>{canWritePurchases ? "Gestión habilitada" : "Solo lectura"}</StatusBadge>}
        actions={
          canWritePurchases ? (
            <Link className={buttonVariants()} href="/purchases/new">
              Nuevo pedido
            </Link>
          ) : null
        }
      />

      <PageSection title="Flujo de compras" description="Avanza documentos entre recepción, factura de proveedor y pago." contentClassName="space-y-4">
        {canWritePurchases ? (
          <PurchaseFlowActions invoices={invoices} orderLines={orderLines} orders={orders} payments={payments} receipts={receipts} />
        ) : (
          <EmptyState title="Acciones no disponibles" description="Necesitas permisos de escritura para convertir o registrar estados del flujo de compras." />
        )}
      </PageSection>

      <PageSection
        title="Pedidos"
        description="Pedidos de compra de la empresa activa."
      >
        <PurchaseOrdersList canManage={canWritePurchases} rows={orders} />
      </PageSection>
    </PageShell>
  );
}
