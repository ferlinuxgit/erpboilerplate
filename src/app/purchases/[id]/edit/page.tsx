import { notFound } from "next/navigation";

import { EditPurchaseOrderForm } from "@/components/purchases/edit-purchase-order-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <main className="container mx-auto px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Editar pedido de compra</CardTitle>
        </CardHeader>
        <CardContent>
          <EditPurchaseOrderForm orderId={order.id} defaultNumber={order.number} defaultStatus={order.status} />
        </CardContent>
      </Card>
    </main>
  );
}
