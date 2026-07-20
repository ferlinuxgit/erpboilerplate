import Link from "next/link";

import { PurchaseOrdersList } from "@/components/purchases/purchase-orders-list";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { listPurchaseOrders } from "@/server/purchases/service";

export default async function PurchaseOrdersPage() {
  const ctx = await requireContext("purchase.read");
  const rows = await listPurchaseOrders(ctx.company.id);
  const canWrite = can(ctx.membership.role, "purchase.write");
  return (
    <PageShell>
      <PageHeader
        eyebrow="Pedidos de compra"
        title="Pedidos de compra"
        description="Solicitudes a proveedores, importes acordados y estado de recepción."
        actions={
          canWrite ? (
            <Link className={buttonVariants()} href="/purchases/new">
              Nuevo pedido de compra
            </Link>
          ) : null
        }
      />
      <PageSection
        title="Pedidos"
        description="Filtra por estado y abre cada pedido para revisar líneas o registrar una recepción."
      >
        <PurchaseOrdersList canManage={canWrite} rows={rows} />
      </PageSection>
    </PageShell>
  );
}
