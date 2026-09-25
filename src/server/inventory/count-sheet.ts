import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { item, stockMovement, warehouse } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { findStaleCountLines, roundQuantity } from "@/lib/inventory-count";
import { recordAudit } from "@/server/audit";

import { assertItemsBelongToCompany } from "./ownership";
import { refreshStockLocation } from "./stock-location";

function signedQuantity() {
  return sql<string>`coalesce(sum(case when ${stockMovement.movementType} = 'OUT' then -${stockMovement.quantity} else ${stockMovement.quantity} end), '0')`;
}

/** Stock actual (según movimientos) de cada artículo en un almacén. */
export async function getWarehouseStock(companyId: string, warehouseId: string, client: DbClient = db, itemIds?: readonly string[]) {
  const rows = await client
    .select({ itemId: stockMovement.itemId, quantity: signedQuantity() })
    .from(stockMovement)
    .where(and(
      eq(stockMovement.companyId, companyId),
      eq(stockMovement.warehouseId, warehouseId),
      itemIds && itemIds.length > 0 ? inArray(stockMovement.itemId, [...itemIds]) : undefined,
    ))
    .groupBy(stockMovement.itemId);
  return new Map(rows.map((row) => [row.itemId, roundQuantity(Number(row.quantity))]));
}

/** Datos de la hoja de recuento: almacenes activos, artículos de stock y su existencia por almacén. */
export async function getCountSheetData(companyId: string) {
  const [warehouses, items, stockRows] = await Promise.all([
    db
      .select({ id: warehouse.id, code: warehouse.code, name: warehouse.name })
      .from(warehouse)
      .where(and(eq(warehouse.companyId, companyId), eq(warehouse.isActive, true)))
      .orderBy(asc(warehouse.code)),
    db
      .select({ id: item.id, sku: item.sku, name: item.name })
      .from(item)
      .where(and(eq(item.companyId, companyId), eq(item.isActive, true), eq(item.isService, false)))
      .orderBy(asc(item.name), asc(item.id)),
    db
      .select({ itemId: stockMovement.itemId, warehouseId: stockMovement.warehouseId, quantity: signedQuantity() })
      .from(stockMovement)
      .where(eq(stockMovement.companyId, companyId))
      .groupBy(stockMovement.itemId, stockMovement.warehouseId),
  ]);
  const stock: Record<string, Record<string, number>> = {};
  for (const row of stockRows) {
    stock[row.warehouseId] ??= {};
    stock[row.warehouseId][row.itemId] = roundQuantity(Number(row.quantity));
  }
  return { warehouses, items, stock };
}

export class InventoryCountConflictError extends HttpError {
  readonly itemNames: string[];

  constructor(itemNames: string[]) {
    super(409, `El stock de ${itemNames.join(", ")} ha cambiado mientras contabas. Actualiza la hoja y revisa esas cantidades.`);
    this.name = "InventoryCountConflictError";
    this.itemNames = itemNames;
  }
}

export type PostInventoryCountInput = {
  companyId: string;
  tenantId: string;
  actorUserId: string;
  warehouseId: string;
  countedAt: Date;
  notes?: string;
  lines: Array<{ itemId: string; countedQuantity: number; expectedQuantity: number }>;
};

/**
 * Registra un recuento completo en una sola operación: un ajuste por artículo con diferencia,
 * todos con la misma referencia RECUENTO-… y una única entrada de auditoría con el detalle.
 * Si el stock cambió desde que se abrió la hoja, no registra nada (409).
 */
export async function postInventoryCount(input: PostInventoryCountInput) {
  if (input.lines.length === 0) throw new HttpError(400, "No hay cantidades contadas que registrar.");
  if (input.lines.some((line) => !Number.isFinite(line.countedQuantity) || line.countedQuantity < 0)) throw new HttpError(400, "Las cantidades contadas deben ser números no negativos.");
  const itemIds = [...new Set(input.lines.map((line) => line.itemId))];
  if (itemIds.length !== input.lines.length) throw new HttpError(400, "Un artículo aparece dos veces en el recuento.");

  return db.transaction(async (tx) => {
    const [ownedWarehouse] = await tx
      .select({ id: warehouse.id, name: warehouse.name })
      .from(warehouse)
      .where(and(eq(warehouse.companyId, input.companyId), eq(warehouse.id, input.warehouseId), eq(warehouse.isActive, true)))
      .for("update")
      .limit(1);
    if (!ownedWarehouse) throw new HttpError(404, "Almacén no encontrado.");
    await assertItemsBelongToCompany(tx, input.companyId, itemIds);

    const current = await getWarehouseStock(input.companyId, input.warehouseId, tx, itemIds);
    const stale = findStaleCountLines(input.lines, current);
    if (stale.length > 0) {
      const names = await tx.select({ id: item.id, name: item.name }).from(item).where(and(eq(item.companyId, input.companyId), inArray(item.id, stale)));
      throw new InventoryCountConflictError(names.map((row) => row.name));
    }

    const reference = `RECUENTO-${input.countedAt.toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const reason = input.notes?.trim() ? `Recuento físico: ${input.notes.trim()}` : "Recuento físico";
    const detail = input.lines.map((line) => ({
      itemId: line.itemId,
      expectedQuantity: roundQuantity(current.get(line.itemId) ?? 0),
      countedQuantity: roundQuantity(line.countedQuantity),
      difference: roundQuantity(line.countedQuantity - (current.get(line.itemId) ?? 0)),
    }));
    const adjustments = detail.filter((line) => Math.abs(line.difference) > 0.0005);
    const movements = adjustments.length
      ? await tx
          .insert(stockMovement)
          .values(adjustments.map((line) => ({
            companyId: input.companyId,
            itemId: line.itemId,
            warehouseId: input.warehouseId,
            movementType: "ADJUSTMENT" as const,
            quantity: line.difference.toFixed(3),
            movedAt: input.countedAt,
            reason,
            reference,
          })))
          .returning({ id: stockMovement.id })
      : [];
    for (const line of adjustments) {
      await refreshStockLocation({ companyId: input.companyId, itemId: line.itemId, warehouseId: input.warehouseId }, tx);
    }

    await recordAudit(
      {
        tenantId: input.tenantId,
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        action: "inventory.count.post",
        entityName: "warehouse",
        entityId: input.warehouseId,
        payload: { reference, countedAt: input.countedAt, notes: input.notes ?? null, lines: detail, movementIds: movements.map((movement) => movement.id) },
      },
      tx,
    );

    return { reference, countedItems: detail.length, adjustments: adjustments.length, movementIds: movements.map((movement) => movement.id) };
  });
}
