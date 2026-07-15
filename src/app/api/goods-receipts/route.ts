import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { goodsReceipt, goodsReceiptLine, purchaseOrder, purchaseOrderLine, stockMovement, warehouse } from "@/db/schema";
import { refreshStockLocation, registerInMovementCost } from "@/server/inventory/stock-location";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";

const payloadSchema = z.object({
  purchaseOrderId: z.string().trim().min(1),
  warehouseId: z.string().trim().optional().or(z.literal("")),
  receivedAt: z.string().trim().min(1),
  lines: z
    .array(
      z.object({
        itemId: z.string().trim().optional().or(z.literal("")),
        quantity: z.number().positive(),
      }),
    )
    .optional(),
});

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "purchase.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  return NextResponse.json(
    await db
      .select({
        id: goodsReceipt.id,
        purchaseOrderId: goodsReceipt.purchaseOrderId,
        receivedAt: goodsReceipt.receivedAt,
      })
      .from(goodsReceipt)
      .innerJoin(purchaseOrder, eq(goodsReceipt.purchaseOrderId, purchaseOrder.id))
      .where(eq(purchaseOrder.companyId, ctx.company.id)),
  );
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "purchase.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });

  const [ownedOrder] = await db
    .select({ id: purchaseOrder.id })
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, parsed.data.purchaseOrderId), eq(purchaseOrder.companyId, ctx.company.id)))
    .limit(1);

  if (!ownedOrder) return NextResponse.json({ message: "Pedido de compra no encontrado." }, { status: 404 });
  const [ownedWarehouse] = parsed.data.warehouseId
    ? await db
        .select({ id: warehouse.id })
        .from(warehouse)
        .where(and(eq(warehouse.id, parsed.data.warehouseId), eq(warehouse.companyId, ctx.company.id)))
        .limit(1)
    : await db
        .select({ id: warehouse.id })
        .from(warehouse)
        .where(eq(warehouse.companyId, ctx.company.id))
        .limit(1);
  if (!ownedWarehouse) return NextResponse.json({ message: "Almacén no encontrado." }, { status: 404 });
  const receivedAt = new Date(parsed.data.receivedAt);
  if (Number.isNaN(receivedAt.getTime())) return NextResponse.json({ message: "Fecha de recepción inválida." }, { status: 400 });

  try {
    const created = await db.transaction(async (tx) => {
    const [lockedOrder] = await tx.select({ id: purchaseOrder.id }).from(purchaseOrder).where(and(eq(purchaseOrder.id, parsed.data.purchaseOrderId), eq(purchaseOrder.companyId, ctx.company.id))).for("update").limit(1);
    if (!lockedOrder) throw new Error("Pedido de compra no encontrado.");
    const poLines = await tx
      .select()
      .from(purchaseOrderLine)
      .where(eq(purchaseOrderLine.purchaseOrderId, parsed.data.purchaseOrderId));

    const previousReceiptLines = await tx
      .select({ itemId: goodsReceiptLine.itemId, quantity: goodsReceiptLine.quantity })
      .from(goodsReceiptLine)
      .innerJoin(goodsReceipt, eq(goodsReceipt.id, goodsReceiptLine.goodsReceiptId))
      .where(eq(goodsReceipt.purchaseOrderId, parsed.data.purchaseOrderId));
    const orderedByItem = new Map<string, number>();
    const receivedByItem = new Map<string, number>();
    const unitCostByItem = new Map<string, number>();
    for (const line of poLines) {
      if (!line.itemId) continue;
      orderedByItem.set(line.itemId, (orderedByItem.get(line.itemId) ?? 0) + Number(line.quantity));
      unitCostByItem.set(line.itemId, Number(line.unitPrice));
    }
    for (const line of previousReceiptLines) if (line.itemId) receivedByItem.set(line.itemId, (receivedByItem.get(line.itemId) ?? 0) + Number(line.quantity));

    const linesToInsert =
      parsed.data.lines && parsed.data.lines.length > 0
        ? parsed.data.lines.map((line) => {
            if (!line.itemId || !orderedByItem.has(line.itemId)) throw new Error("La línea de recepción no pertenece al pedido.");
            const remaining = (orderedByItem.get(line.itemId) ?? 0) - (receivedByItem.get(line.itemId) ?? 0);
            if (line.quantity > remaining + 0.0005) throw new Error("La cantidad recibida supera la cantidad pendiente del pedido.");
            return { itemId: line.itemId, quantity: line.quantity.toFixed(3) };
          })
        : [...orderedByItem.entries()].flatMap(([itemId, ordered]) => {
            const remaining = ordered - (receivedByItem.get(itemId) ?? 0);
            return remaining > 0.0005 ? [{ itemId, quantity: remaining.toFixed(3) }] : [];
          });

    if (linesToInsert.length === 0) throw new Error("El pedido ya está completamente recibido.");

    const [createdHeader] = await tx.insert(goodsReceipt).values({ purchaseOrderId: parsed.data.purchaseOrderId, receivedAt }).returning();

    if (linesToInsert.length > 0) {
      const insertedLines = await tx.insert(goodsReceiptLine).values(linesToInsert.map((line) => ({ ...line, goodsReceiptId: createdHeader.id }))).returning();
      for (const line of insertedLines) {
        if (!line.itemId) continue;
        const [movement] = await tx.insert(stockMovement).values({
          companyId: ctx.company.id,
          itemId: line.itemId,
          warehouseId: ownedWarehouse.id,
          movementType: "IN",
          quantity: line.quantity,
          movedAt: receivedAt,
          reason: "Recepción de pedido de compra",
          reference: `goods-receipt:${createdHeader.id}`,
        }).returning({ id: stockMovement.id });

        await registerInMovementCost({
          companyId: ctx.company.id,
          itemId: line.itemId,
          movementId: movement.id,
          quantity: Number(line.quantity),
          unitCost: unitCostByItem.get(line.itemId) ?? 0,
        }, tx);
        await refreshStockLocation({ companyId: ctx.company.id, itemId: line.itemId, warehouseId: ownedWarehouse.id }, tx);
      }
    }

    return createdHeader;
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "No se pudo registrar la recepción." }, { status: 400 });
  }
}
