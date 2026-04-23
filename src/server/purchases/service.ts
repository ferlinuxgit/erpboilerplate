import { and, desc, eq } from "drizzle-orm";

import { partner, purchaseOrder, purchaseOrderLine } from "@/db/schema";
import { db } from "@/lib/db";
import { recordAudit } from "@/server/audit";
import { reserveSeriesNumber } from "@/server/documents/series";

export async function listPurchaseOrders(companyId: string) {
  return db
    .select({
      id: purchaseOrder.id,
      number: purchaseOrder.number,
      status: purchaseOrder.status,
      supplierName: partner.name,
      createdAt: purchaseOrder.createdAt,
    })
    .from(purchaseOrder)
    .innerJoin(partner, eq(purchaseOrder.supplierPartnerId, partner.id))
    .where(eq(purchaseOrder.companyId, companyId))
    .orderBy(desc(purchaseOrder.createdAt));
}

export async function getPurchaseOrder(companyId: string, id: string) {
  const rows = await db
    .select({
      id: purchaseOrder.id,
      number: purchaseOrder.number,
      status: purchaseOrder.status,
      supplierName: partner.name,
    })
    .from(purchaseOrder)
    .innerJoin(partner, eq(purchaseOrder.supplierPartnerId, partner.id))
    .where(and(eq(purchaseOrder.companyId, companyId), eq(purchaseOrder.id, id)))
    .limit(1);

  return rows[0] ?? null;
}

type PurchasePayload = {
  supplierName: string;
  number?: string;
  fiscalYearId: string;
  lines?: Array<{ description: string; itemId?: string; quantity: number; unitPrice: number }>;
};

export async function createPurchaseOrder(
  companyId: string,
  tenantId: string,
  actorUserId: string,
  payload: PurchasePayload,
) {
  return db.transaction(async (tx) => {
    const existingSupplier = await tx
      .select({ id: partner.id })
      .from(partner)
      .where(and(eq(partner.companyId, companyId), eq(partner.type, "SUPPLIER"), eq(partner.name, payload.supplierName)))
      .limit(1);

    const supplierId =
      existingSupplier[0]?.id ??
      (
        await tx
          .insert(partner)
          .values({ companyId, type: "SUPPLIER", name: payload.supplierName })
          .returning({ id: partner.id })
      )[0].id;

    const [createdOrder] = await tx
      .insert(purchaseOrder)
      .values({
        companyId,
        supplierPartnerId: supplierId,
        number:
          payload.number?.trim() ||
          (await reserveSeriesNumber(tx, {
            companyId,
            fiscalYearId: payload.fiscalYearId,
            type: "PURCHASE_ORDER",
          })),
      })
      .returning({ id: purchaseOrder.id, number: purchaseOrder.number, status: purchaseOrder.status });

    if (payload.lines && payload.lines.length > 0) {
      await tx.insert(purchaseOrderLine).values(
        payload.lines.map((line) => ({
          purchaseOrderId: createdOrder.id,
          itemId: line.itemId || null,
          description: line.description,
          quantity: line.quantity.toFixed(3),
          unitPrice: line.unitPrice.toFixed(2),
          lineTotal: (line.quantity * line.unitPrice).toFixed(2),
        })),
      );
    }

    await recordAudit({
      tenantId,
      companyId,
      actorUserId,
      action: "purchase.create",
      entityName: "purchaseOrder",
      entityId: createdOrder.id,
      payload,
    });

    return createdOrder;
  });
}

export async function updatePurchaseOrder(
  companyId: string,
  tenantId: string,
  actorUserId: string,
  id: string,
  payload: { number: string; status: string },
) {
  const [updated] = await db
    .update(purchaseOrder)
    .set({ number: payload.number, status: payload.status })
    .where(and(eq(purchaseOrder.companyId, companyId), eq(purchaseOrder.id, id)))
    .returning({ id: purchaseOrder.id, number: purchaseOrder.number, status: purchaseOrder.status });

  if (!updated) return null;

  await recordAudit({
    tenantId,
    companyId,
    actorUserId,
    action: "purchase.update",
    entityName: "purchaseOrder",
    entityId: id,
    payload,
  });

  return updated;
}

export async function deletePurchaseOrder(companyId: string, tenantId: string, actorUserId: string, id: string) {
  const [deleted] = await db
    .delete(purchaseOrder)
    .where(and(eq(purchaseOrder.companyId, companyId), eq(purchaseOrder.id, id)))
    .returning({ id: purchaseOrder.id });

  if (!deleted) return false;

  await recordAudit({
    tenantId,
    companyId,
    actorUserId,
    action: "purchase.delete",
    entityName: "purchaseOrder",
    entityId: id,
  });

  return true;
}
