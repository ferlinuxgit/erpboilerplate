import { notFound } from "next/navigation";

import { EditPurchaseOrderForm } from "@/components/purchases/edit-purchase-order-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { getPurchaseOrder } from "@/server/purchases/service";

export default async function EditPurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireUserSession();
  const tenantContext = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(tenantContext.membership.role, "purchase.write")) notFound();

  const { id } = await params;
  const order = await getPurchaseOrder(tenantContext.company.id, id);
  if (!order) notFound();

  return (
    <PageShell>
      <PageHeader eyebrow="Compras" title="Editar pedido de compra" description={order.number} backHref="/purchases" backLabel="Volver a compras" />
      <PageSection title="Datos del pedido" description="Ajusta número y estado del pedido de compra.">
        <EditPurchaseOrderForm orderId={order.id} defaultNumber={order.number} defaultStatus={order.status} />
      </PageSection>
    </PageShell>
  );
}
