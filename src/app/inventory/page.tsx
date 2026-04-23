import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUserSession } from "@/lib/current-user";
import { ensureUserTenant } from "@/lib/tenant";
import { getLowStockAlerts, getStockSnapshot } from "@/server/inventory/service";

export default async function InventoryPage() {
  const session = await requireUserSession();
  const tenantContext = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const stock = await getStockSnapshot(tenantContext.company.id);
  const alerts = await getLowStockAlerts(tenantContext.company.id);

  return (
    <main className="container mx-auto space-y-4 px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Inventario</CardTitle>
          <CardDescription>Snapshot de stock por producto (coste medio/FIFO ampliable).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Link className={buttonVariants({ variant: "outline" })} href="/dashboard">
            Volver
          </Link>
          {stock.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay datos de stock.</p>
          ) : (
            stock.map((row) => (
              <p key={row.itemId}>
                {row.itemName}: {row.quantity}
              </p>
            ))
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Alertas de stock mínimo</CardTitle>
          <CardDescription>Productos cuyo stock está por debajo del mínimo configurado.</CardDescription>
        </CardHeader>
        <CardContent>
          {alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay alertas activas.</p>
          ) : (
            alerts.map((row) => (
              <p key={`alert-${row.itemId}`}>
                {row.itemName}: {row.quantity} / mínimo {row.minimumStock}
              </p>
            ))
          )}
        </CardContent>
      </Card>
    </main>
  );
}
