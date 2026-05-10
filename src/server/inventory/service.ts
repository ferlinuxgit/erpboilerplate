import { and, desc, eq, sql } from "drizzle-orm";

import { item, stockMovement, warehouse } from "@/db/schema";
import { db } from "@/lib/db";

function quantityExpression() {
  return sql<string>`coalesce(sum(
    case
      when ${stockMovement.movementType} = 'IN' then ${stockMovement.quantity}
      when ${stockMovement.movementType} = 'OUT' then -${stockMovement.quantity}
      when ${stockMovement.movementType} = 'TRANSFER' then ${stockMovement.quantity}
      else ${stockMovement.quantity}
    end
  ), '0')`;
}

export async function getStockSnapshot(companyId: string) {
  return db
    .select({
      itemId: item.id,
      itemName: item.name,
      itemSku: item.sku,
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      warehouseCode: warehouse.code,
      minimumStock: item.minimumStock,
      quantity: quantityExpression(),
    })
    .from(item)
    .leftJoin(stockMovement, and(eq(stockMovement.itemId, item.id), eq(stockMovement.companyId, companyId)))
    .leftJoin(warehouse, and(eq(warehouse.id, stockMovement.warehouseId), eq(warehouse.companyId, companyId)))
    .where(eq(item.companyId, companyId))
    .groupBy(item.id, item.name, item.sku, item.minimumStock, warehouse.id, warehouse.name, warehouse.code);
}

export async function getLowStockAlerts(companyId: string) {
  const snapshot = await getStockSnapshot(companyId);
  return snapshot.filter((row) => Number(row.quantity) <= Number(row.minimumStock));
}

export async function getInventoryOptions(companyId: string) {
  const [items, warehouses] = await Promise.all([
    db
      .select({ id: item.id, sku: item.sku, name: item.name, minimumStock: item.minimumStock })
      .from(item)
      .where(eq(item.companyId, companyId)),
    db
      .select({ id: warehouse.id, code: warehouse.code, name: warehouse.name })
      .from(warehouse)
      .where(eq(warehouse.companyId, companyId)),
  ]);

  return { items, warehouses };
}

export async function getStockMovementHistory(companyId: string) {
  return db
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
    })
    .from(stockMovement)
    .innerJoin(item, and(eq(item.id, stockMovement.itemId), eq(item.companyId, companyId)))
    .innerJoin(warehouse, and(eq(warehouse.id, stockMovement.warehouseId), eq(warehouse.companyId, companyId)))
    .where(eq(stockMovement.companyId, companyId))
    .orderBy(desc(stockMovement.movedAt));
}
