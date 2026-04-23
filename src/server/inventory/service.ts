import { and, eq, sql } from "drizzle-orm";

import { item, stockMovement } from "@/db/schema";
import { db } from "@/lib/db";

export async function getStockSnapshot(companyId: string) {
  return db
    .select({
      itemId: item.id,
      itemName: item.name,
      minimumStock: item.minimumStock,
      quantity: sql<string>`coalesce(sum(
        case
          when ${stockMovement.movementType} = 'IN' then ${stockMovement.quantity}
          when ${stockMovement.movementType} = 'OUT' then -${stockMovement.quantity}
          when ${stockMovement.movementType} = 'TRANSFER' then ${stockMovement.quantity}
          else ${stockMovement.quantity}
        end
      ), '0')`,
    })
    .from(item)
    .leftJoin(stockMovement, and(eq(stockMovement.itemId, item.id), eq(stockMovement.companyId, companyId)))
    .where(eq(item.companyId, companyId))
    .groupBy(item.id, item.name, item.minimumStock);
}

export async function getLowStockAlerts(companyId: string) {
  const snapshot = await getStockSnapshot(companyId);
  return snapshot.filter((row) => Number(row.quantity) <= Number(row.minimumStock));
}
