import { Suspense } from "react";
import Link from "next/link";

import {
  InventoryOperationsPanel,
  type InventoryItemOption,
  type InventoryWarehouseOption,
  type StockMovementHistoryRow,
  type StockSnapshotRow,
} from "@/components/inventory/inventory-operations-panel";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import {
  getInventoryOptions,
  getLowStockAlerts,
  getStockMovementHistory,
  getStockSnapshot,
} from "@/server/inventory/service";

function stock(
  row: Awaited<ReturnType<typeof getStockSnapshot>>[number],
): StockSnapshotRow {
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
function movement(
  row: Awaited<ReturnType<typeof getStockMovementHistory>>[number],
): StockMovementHistoryRow {
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

export default async function InventoryMovementsPage() {
  const ctx = await requireContext("stock.read");
  const [options, stockRows, alertRows, movementRows] = await Promise.all([
    getInventoryOptions(ctx.company.id),
    getStockSnapshot(ctx.company.id),
    getLowStockAlerts(ctx.company.id),
    getStockMovementHistory(ctx.company.id),
  ]);
  return (
    <PageShell>
      <PageHeader
        eyebrow="Inventario"
        title="Movimientos de stock"
        description="Entradas, salidas, ajustes y transferencias con trazabilidad por artículo y almacén."
        backHref="/inventory"
        backLabel="Volver a existencias"
        actions={
          <Link className={buttonVariants()} href="/inventory/movements/new">
            Nuevo movimiento
          </Link>
        }
      />
      <Suspense
        fallback={
          <div className="border-y p-4 text-sm text-muted-foreground">
            Cargando movimientos...
          </div>
        }
      >
        <InventoryOperationsPanel
          items={options.items as InventoryItemOption[]}
          warehouses={options.warehouses as InventoryWarehouseOption[]}
          stock={stockRows.map(stock)}
          alerts={alertRows.map(stock)}
          movements={movementRows.map(movement)}
          initialItemId="all"
          initialWarehouseId="all"
          showMovementForm={false}
        />
      </Suspense>
    </PageShell>
  );
}
