import { and, eq } from "drizzle-orm";

import { stockLocation, stockMovement } from "@/db/schema";
import { db } from "@/lib/db";

import { buildStockMovementEntries, type StockMovementOperationInput } from "./movements";
import { refreshStockLocation } from "./stock-location";

export async function registerStockMovementOperation(input: StockMovementOperationInput) {
  const entries = buildStockMovementEntries(input);
  const warehouseIds = new Set(entries.map((entry) => entry.warehouseId));
  const reference = entries[0]?.reference;

  return db.transaction(async (tx) => {
    if (reference) {
      const existing = await tx
        .select()
        .from(stockMovement)
        .where(
          and(
            eq(stockMovement.companyId, input.companyId),
            eq(stockMovement.itemId, input.itemId),
            eq(stockMovement.movementType, input.movementType),
            eq(stockMovement.reference, reference),
          ),
        );
      const matchingExisting = existing.filter((movement) => warehouseIds.has(movement.warehouseId));
      const existingWarehouseIds = new Set(matchingExisting.map((movement) => movement.warehouseId));
      const hasSameWarehouseContext =
        matchingExisting.length === entries.length && entries.every((entry) => existingWarehouseIds.has(entry.warehouseId));

      if (hasSameWarehouseContext) return matchingExisting;
    }

    for (const entry of entries) {
      const stockDelta = entry.movementType === "OUT" ? -Math.abs(Number(entry.quantity)) : Number(entry.quantity);
      if (stockDelta >= 0) continue;
      const [location] = await tx
        .select({ currentQuantity: stockLocation.currentQuantity })
        .from(stockLocation)
        .where(and(eq(stockLocation.companyId, input.companyId), eq(stockLocation.itemId, input.itemId), eq(stockLocation.warehouseId, entry.warehouseId)))
        .for("update")
        .limit(1);
      if (Number(location?.currentQuantity ?? 0) + stockDelta < -0.0005) throw new Error("Stock insuficiente para completar la salida o transferencia.");
    }

    const created = await tx.insert(stockMovement).values(entries).onConflictDoNothing().returning();
    if (created.length !== entries.length && reference) {
      return tx.select().from(stockMovement).where(and(eq(stockMovement.companyId, input.companyId), eq(stockMovement.itemId, input.itemId), eq(stockMovement.movementType, input.movementType), eq(stockMovement.reference, reference)));
    }

    await Promise.all(
      Array.from(warehouseIds).map((warehouseId) =>
        refreshStockLocation({ companyId: input.companyId, itemId: input.itemId, warehouseId }, tx),
      ),
    );

    return created;
  });
}
