import { and, eq, sql } from "drizzle-orm";

import { item, itemCostHistory, stockLocation, stockMovement } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";

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

export async function refreshStockLocation(
  input: {
    companyId: string;
    itemId: string;
    warehouseId: string;
  },
  client: DbClient = db,
) {
  const [snapshot] = await client
    .select({
      quantity: quantityExpression(),
      averageCost: item.averageCost,
    })
    .from(item)
    .leftJoin(
      stockMovement,
      and(
        eq(stockMovement.companyId, input.companyId),
        eq(stockMovement.itemId, input.itemId),
        eq(stockMovement.warehouseId, input.warehouseId),
      ),
    )
    .where(and(eq(item.id, input.itemId), eq(item.companyId, input.companyId)))
    .groupBy(item.averageCost)
    .limit(1);

  if (!snapshot) return;

  await client
    .insert(stockLocation)
    .values({
      companyId: input.companyId,
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      currentQuantity: snapshot.quantity,
      averageCost: snapshot.averageCost,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [stockLocation.companyId, stockLocation.itemId, stockLocation.warehouseId],
      set: {
        currentQuantity: snapshot.quantity,
        averageCost: snapshot.averageCost,
        updatedAt: new Date(),
      },
    });
}

export async function registerInMovementCost(
  input: {
    companyId: string;
    itemId: string;
    movementId: string;
    quantity: number;
    unitCost: number;
  },
  client: DbClient = db,
) {
  if (input.quantity <= 0 || input.unitCost < 0) return;

  const [currentItem] = await client
    .select({ averageCost: item.averageCost })
    .from(item)
    .where(and(eq(item.id, input.itemId), eq(item.companyId, input.companyId)))
    .limit(1);

  if (!currentItem) return;

  const [currentStock] = await client
    .select({
      quantity: sql<string>`coalesce(sum(
        case
          when ${stockMovement.movementType} = 'IN' then ${stockMovement.quantity}
          when ${stockMovement.movementType} = 'OUT' then -${stockMovement.quantity}
          when ${stockMovement.movementType} = 'TRANSFER' then ${stockMovement.quantity}
          else ${stockMovement.quantity}
        end
      ), '0')`,
    })
    .from(stockMovement)
    .where(and(eq(stockMovement.companyId, input.companyId), eq(stockMovement.itemId, input.itemId)))
    .limit(1);

  const stockAfter = Number(currentStock?.quantity ?? "0");
  const stockBefore = Math.max(0, stockAfter - input.quantity);
  const oldAvg = Number(currentItem.averageCost ?? "0");
  const newAvg =
    stockBefore + input.quantity > 0
      ? ((stockBefore * oldAvg + input.quantity * input.unitCost) / (stockBefore + input.quantity)).toFixed(2)
      : oldAvg.toFixed(2);

  await client
    .update(item)
    .set({ averageCost: newAvg })
    .where(and(eq(item.id, input.itemId), eq(item.companyId, input.companyId)));

  await client.insert(itemCostHistory).values({
    companyId: input.companyId,
    itemId: input.itemId,
    movementId: input.movementId,
    quantity: input.quantity.toFixed(3),
    unitCost: input.unitCost.toFixed(2),
  });
}
