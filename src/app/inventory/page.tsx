import { Suspense } from "react";

import {
  InventoryOperationsPanel,
  type InventoryItemOption,
  type InventoryWarehouseOption,
  type StockMovementHistoryRow,
  type StockSnapshotRow,
} from "@/components/inventory/inventory-operations-panel";
import { PageHeader, PageShell } from "@/components/ui/page";
import { requireUserSession } from "@/lib/current-user";
import { ensureUserTenant } from "@/lib/tenant";
import { getInventoryOptions, getLowStockAlerts, getStockMovementHistory, getStockSnapshot } from "@/server/inventory/service";

type InventoryPageProps = {
  searchParams?: Promise<{ itemId?: string; warehouseId?: string }>;
};

function serializeStockRow(row: Awaited<ReturnType<typeof getStockSnapshot>>[number]): StockSnapshotRow {
  return {
    itemId: row.itemId,
    itemName: row.itemName,
    itemSku: row.itemSku,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouseName,
    warehouseCode: row.warehouseCode,
    minimumStock: row.minimumStock,
    quantity: row.quantity,
  };
}

function serializeMovement(row: Awaited<ReturnType<typeof getStockMovementHistory>>[number]): StockMovementHistoryRow {
  return {
    id: row.id,
    itemId: row.itemId,
    itemName: row.itemName,
    itemSku: row.itemSku,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouseName,
    warehouseCode: row.warehouseCode,
    movementType: row.movementType as StockMovementHistoryRow["movementType"],
    quantity: row.quantity,
    movedAt: row.movedAt.toISOString(),
    reason: row.reason,
    reference: row.reference,
  };
}

export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const params = await searchParams;

  const [options, stockRows, alertRows, movementRows] = await Promise.all([
    getInventoryOptions(ctx.company.id),
    getStockSnapshot(ctx.company.id),
    getLowStockAlerts(ctx.company.id),
    getStockMovementHistory(ctx.company.id),
  ]);

  const items: InventoryItemOption[] = options.items;
  const warehouses: InventoryWarehouseOption[] = options.warehouses;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operación"
        title="Control de stock"
        description="Recibe mercancía, registra conteos y ajustes, transfiere entre almacenes y revisa el histórico con contexto por producto y ubicación."
      />

      <Suspense fallback={<div className="rounded-lg border p-4 text-sm text-muted-foreground">Cargando inventario...</div>}>
        <InventoryOperationsPanel
          items={items}
          warehouses={warehouses}
          stock={stockRows.map(serializeStockRow)}
          alerts={alertRows.map(serializeStockRow)}
          movements={movementRows.map(serializeMovement)}
          initialItemId={params?.itemId ?? "all"}
          initialWarehouseId={params?.warehouseId ?? "all"}
        />
      </Suspense>
    </PageShell>
  );
}
