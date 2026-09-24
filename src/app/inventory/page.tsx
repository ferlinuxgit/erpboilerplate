import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";

import {
  InventoryOperationsPanel,
  type InventoryItemOption,
  type InventoryWarehouseOption,
  type StockSnapshotRow,
} from "@/components/inventory/inventory-operations-panel";
import { PageHeader, PageShell } from "@/components/ui/page";
import { buttonVariants } from "@/components/ui/button";
import { requireContext } from "@/lib/current-context";
import { parseListParams, type RawSearchParams } from "@/lib/list-params";
import { listStockMovementsPage, stockMovementListConfig } from "@/server/inventory/movement-list";
import { getInventoryOptions, getLowStockAlerts, getStockSnapshot } from "@/server/inventory/service";

type InventoryPageProps = {
  // `?itemId=&warehouseId=` preselect the history filters; `?q=&type=&page=` page through it.
  searchParams: Promise<RawSearchParams>;
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

export const metadata: Metadata = { title: "Control de stock" };

export default async function InventoryPage({ searchParams }: InventoryPageProps) {
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

  const items: InventoryItemOption[] = options.items;
  const warehouses: InventoryWarehouseOption[] = options.warehouses;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operación"
        title="Control de stock"
        description="Recibe mercancía, registra conteos y ajustes, transfiere entre almacenes y revisa el histórico con contexto por producto y ubicación."
        actions={<><Link className={buttonVariants({ variant: "outline" })} href="/inventory/items">Artículos</Link><Link className={buttonVariants({ variant: "outline" })} href="/inventory/warehouses">Almacenes</Link><Link className={buttonVariants()} href="/inventory/movements/new">Nuevo movimiento</Link></>}
      />

      <Suspense fallback={<div className="rounded-[2px] border p-3 text-sm text-muted-foreground">Cargando inventario...</div>}>
        <InventoryOperationsPanel
          items={items}
          warehouses={warehouses}
          stock={stockRows.map(serializeStockRow)}
          alerts={alertRows.map(serializeStockRow)}
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
