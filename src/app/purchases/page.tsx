import Link from "next/link";

import { CreatePurchaseOrderForm } from "@/components/purchases/create-purchase-order-form";
import { PurchaseFlowActions } from "@/components/purchases/purchase-flow-actions";
import { PurchaseOrderRowActions } from "@/components/purchases/purchase-order-row-actions";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUserSession } from "@/lib/current-user";
import { ensureUserTenant } from "@/lib/tenant";
import { listPurchasePipeline } from "@/server/purchases/service";

export default async function PurchasesPage() {
  const session = await requireUserSession();
  const tenantContext = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const { orders, orderLines, receipts, invoices, payments } = await listPurchasePipeline(tenantContext.company.id);

  return (
    <main className="container mx-auto space-y-4 px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Compras</CardTitle>
          <CardDescription>
            Ciclo completo: pedido de compra → recepción de mercancía → factura proveedor → pago.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CreatePurchaseOrderForm />
          <PurchaseFlowActions invoices={invoices} orderLines={orderLines} orders={orders} payments={payments} receipts={receipts} />
          <Link className={buttonVariants({ variant: "outline" })} href="/dashboard">
            Volver
          </Link>
          {orders.length === 0 ? (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              No hay pedidos de compra todavía. Crea un pedido con proveedor y líneas para habilitar la recepción.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium">Pedidos de compra</p>
              {orders.map((order) => (
                <div className="flex items-center justify-between rounded-md border p-3" key={order.id}>
                  <p>
                    {order.number} - {order.supplierName} - {order.status}
                  </p>
                  <PurchaseOrderRowActions id={order.id} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
