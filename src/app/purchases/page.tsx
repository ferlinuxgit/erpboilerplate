import Link from "next/link";

import { CreatePurchaseOrderForm } from "@/components/purchases/create-purchase-order-form";
import { PurchaseFlowActions } from "@/components/purchases/purchase-flow-actions";
import { PurchaseOrdersList } from "@/components/purchases/purchase-orders-list";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { listPurchasePipeline } from "@/server/purchases/service";

export default async function PurchasesPage() {
  const tenantContext = await requireContext("purchase.read");
  const { orders, orderLines, receipts, invoices, payments } = await listPurchasePipeline(tenantContext.company.id);
  const canWritePurchases = can(tenantContext.membership.role, "purchase.write");

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
          {canWritePurchases ? (
            <>
              <CreatePurchaseOrderForm />
              <PurchaseFlowActions invoices={invoices} orderLines={orderLines} orders={orders} payments={payments} receipts={receipts} />
            </>
          ) : (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Tu rol actual es de solo lectura para compras.</p>
          )}
          <Link className={buttonVariants({ variant: "outline" })} href="/dashboard">
            Volver
          </Link>
          <PurchaseOrdersList canManage={canWritePurchases} rows={orders} />
        </CardContent>
      </Card>
    </main>
  );
}
