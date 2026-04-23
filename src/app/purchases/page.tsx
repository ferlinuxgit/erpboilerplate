import Link from "next/link";

import { CreatePurchaseOrderForm } from "@/components/purchases/create-purchase-order-form";
import { PurchaseOrderRowActions } from "@/components/purchases/purchase-order-row-actions";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUserSession } from "@/lib/current-user";
import { ensureUserTenant } from "@/lib/tenant";
import { listPurchaseOrders } from "@/server/purchases/service";

export default async function PurchasesPage() {
  const session = await requireUserSession();
  const tenantContext = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const orders = await listPurchaseOrders(tenantContext.company.id);

  return (
    <main className="container mx-auto space-y-4 px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Compras</CardTitle>
          <CardDescription>Gestion de pedidos de compra con alta, edicion y borrado.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CreatePurchaseOrderForm />
          <Link className={buttonVariants({ variant: "outline" })} href="/dashboard">
            Volver
          </Link>
          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay pedidos de compra todavía.</p>
          ) : (
            orders.map((order) => (
              <div key={order.id} className="flex items-center justify-between rounded-md border p-3">
                <p>
                  {order.number} - {order.supplierName} - {order.status}
                </p>
                <PurchaseOrderRowActions id={order.id} />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </main>
  );
}
