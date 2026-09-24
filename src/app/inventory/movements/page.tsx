import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";

import {
  InventoryOperationsPanel,
  type InventoryItemOption,
  type InventoryWarehouseOption,
  type StockSnapshotRow,
} from "@/components/inventory/inventory-operations-panel";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { parseListParams, type RawSearchParams } from "@/lib/list-params";
import { listStockMovementsPage, stockMovementListConfig } from "@/server/inventory/movement-list";
import {
  getInventoryOptions,
  getLowStockAlerts,
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

export const metadata: Metadata = { title: "Movimientos de stock" };

export default async function InventoryMovementsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireContext("stock.read");
  const [options, rawParams, stockRows, alertRows] = await Promise.all([
    getInventoryOptions(ctx.company.id),
    searchParams,
    getStockSnapshot(ctx.company.id),
    getLowStockAlerts(ctx.company.id),
  ]);
  // Product/warehouse filters only accept the company's own options.
  const params = parseListParams(
    rawParams,
    stockMovementListConfig(
      options.items.map((option) => option.id),
      options.warehouses.map((option) => option.id),
    ),
  );
  const history = await listStockMovementsPage(ctx.company.id, params);
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
          <div className="border-y p-3 text-sm text-muted-foreground">
            Cargando movimientos...
          </div>
        }
      >
        <InventoryOperationsPanel
          items={options.items as InventoryItemOption[]}
          warehouses={options.warehouses as InventoryWarehouseOption[]}
          stock={stockRows.map(stock)}
          alerts={alertRows.map(stock)}
          movements={history.rows}
          movementHistory={history.state}
          initialItemId={params.filters.itemId ?? "all"}
          initialWarehouseId={params.filters.warehouseId ?? "all"}
          showMovementForm={false}
        />
      </Suspense>
    </PageShell>
  );
}
