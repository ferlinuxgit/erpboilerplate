import { and, count, eq, type AnyColumn, type SQL } from "drizzle-orm";

import { item, stockMovement, stockMovementTypeEnum, warehouse } from "@/db/schema";
import type { StockMovementHistoryRow, StockMovementHistoryServerState } from "@/components/inventory/inventory-operations-panel";
import { db } from "@/lib/db";
import { DEFAULT_LIST_PAGE_SIZE, type ListParams, type ListParamsConfig } from "@/lib/list-params";
import { countRows, listOrderBy, listWhere, paginate, unfilteredTotal, windowCount } from "@/server/lists/paginate";

/**
 * Server-paginated stock movement history ("Historial de movimientos" on `/inventory` and
 * `/inventory/movements`). URL: `?q=&page=&type=&itemId=&warehouseId=` (the last two were
 * already used by `/inventory` links to preselect product/warehouse).
 */

export const stockMovementSortKeys = ["movedAt"] as const;
export type StockMovementSortKey = (typeof stockMovementSortKeys)[number];
export type StockMovementFilterKey = "type" | "itemId" | "warehouseId";

/** `itemIds`/`warehouseIds`: the company's own options (anything else in the URL is ignored). */
export function stockMovementListConfig(
  itemIds: readonly string[],
  warehouseIds: readonly string[],
): ListParamsConfig<StockMovementSortKey, StockMovementFilterKey> {
  return {
    sortKeys: stockMovementSortKeys,
    // Latest movement first (id breaks ties).
    defaultSort: { key: "movedAt", dir: "desc" },
    filters: { type: stockMovementTypeEnum.enumValues, itemId: itemIds, warehouseId: warehouseIds },
    defaultPageSize: DEFAULT_LIST_PAGE_SIZE,
  };
}

export async function listStockMovementsPage(
  companyId: string,
  params: ListParams<StockMovementSortKey, StockMovementFilterKey>,
): Promise<{ rows: StockMovementHistoryRow[]; state: StockMovementHistoryServerState }> {
  const joinItem = and(eq(item.id, stockMovement.itemId), eq(item.companyId, companyId));
  const joinWarehouse = and(eq(warehouse.id, stockMovement.warehouseId), eq(warehouse.companyId, companyId));
  const where = listWhere({
    base: [eq(stockMovement.companyId, companyId)],
    search: { q: params.q, columns: [stockMovement.reason, stockMovement.reference, item.name, item.sku, warehouse.name] },
    filters: [
      params.filters.type
        ? eq(stockMovement.movementType, params.filters.type as (typeof stockMovementTypeEnum.enumValues)[number])
        : undefined,
      params.filters.itemId ? eq(stockMovement.itemId, params.filters.itemId) : undefined,
      params.filters.warehouseId ? eq(stockMovement.warehouseId, params.filters.warehouseId) : undefined,
    ],
  });
  const sortColumns: Record<StockMovementSortKey, AnyColumn | SQL> = { movedAt: stockMovement.movedAt };

  const result = await paginate({
    page: params.page,
    pageSize: params.pageSize,
    fetchPage: (limit, offset) =>
      db
        .select({
          id: stockMovement.id,
          itemId: stockMovement.itemId,
          itemName: item.name,
          itemSku: item.sku,
          warehouseId: stockMovement.warehouseId,
          warehouseName: warehouse.name,
          warehouseCode: warehouse.code,
          movementType: stockMovement.movementType,
          quantity: stockMovement.quantity,
          movedAt: stockMovement.movedAt,
          reason: stockMovement.reason,
          reference: stockMovement.reference,
          total: windowCount(),
        })
        .from(stockMovement)
        .innerJoin(item, joinItem)
        .innerJoin(warehouse, joinWarehouse)
        .where(where)
        .orderBy(...listOrderBy(sortColumns, params, stockMovement.id))
        .limit(limit)
        .offset(offset),
    countAll: () =>
      countRows(
        db.select({ value: count() }).from(stockMovement).innerJoin(item, joinItem).innerJoin(warehouse, joinWarehouse).where(where),
      ),
  });

  const recordCount = await unfilteredTotal(params, result.total, () =>
    countRows(db.select({ value: count() }).from(stockMovement).where(eq(stockMovement.companyId, companyId))),
  );

  return {
    rows: result.rows.map((row) => ({
      id: row.id,
      itemId: row.itemId,
      itemName: row.itemName,
      itemSku: row.itemSku,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName,
      warehouseCode: row.warehouseCode,
      movementType: row.movementType,
      quantity: row.quantity,
      movedAt: row.movedAt.toISOString(),
      reason: row.reason,
      reference: row.reference,
    })),
    state: {
      total: result.total,
      unfilteredTotal: recordCount,
      page: result.page,
      pageSize: result.pageSize,
      q: params.q,
      filters: {
        type: params.filters.type ?? null,
        itemId: params.filters.itemId ?? null,
        warehouseId: params.filters.warehouseId ?? null,
      },
    },
  };
}
