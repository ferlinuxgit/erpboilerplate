import { Suspense } from "react";

import {
  InventoryOperationsPanel,
  type InventoryItemOption,
  type InventoryWarehouseOption,
  type StockMovementHistoryRow,
  type StockSnapshotRow,
} from "@/components/inventory/inventory-operations-panel";
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
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Inventario</p>
        <h1 className="text-3xl font-bold tracking-tight">Control de stock</h1>
        <p className="max-w-3xl text-muted-foreground">
          Recibe mercancía, registra conteos/ajustes, transfiere entre almacenes y revisa el histórico con contexto por producto y ubicación.
        </p>
      </div>

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
    </div>
  );
}
