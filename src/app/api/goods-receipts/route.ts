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
import { recordAudit } from "@/server/audit";

const payloadSchema = z.object({
  purchaseOrderId: z.string().trim().min(1),
  warehouseId: z.string().trim().optional().or(z.literal("")),
  receivedAt: z.string().trim().min(1),
  supplierDocumentNumber: z.string().trim().max(120).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  lines: z
    .array(
      z.object({
        purchaseOrderLineId: z.string().trim().optional().or(z.literal("")),
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
    const [lockedOrder] = await tx.select({ id: purchaseOrder.id, status: purchaseOrder.status }).from(purchaseOrder).where(and(eq(purchaseOrder.id, parsed.data.purchaseOrderId), eq(purchaseOrder.companyId, ctx.company.id))).for("update").limit(1);
    if (!lockedOrder) throw new Error("Pedido de compra no encontrado.");
    if (lockedOrder.status === "VOID" || lockedOrder.status === "CANCELLED") throw new Error("El pedido de compra está anulado y no puede recepcionarse.");
    const poLines = await tx
      .select()
      .from(purchaseOrderLine)
      .where(eq(purchaseOrderLine.purchaseOrderId, parsed.data.purchaseOrderId));

    const previousReceiptLines = await tx
      .select({ purchaseOrderLineId: goodsReceiptLine.purchaseOrderLineId, itemId: goodsReceiptLine.itemId, quantity: goodsReceiptLine.quantity })
      .from(goodsReceiptLine)
      .innerJoin(goodsReceipt, eq(goodsReceipt.id, goodsReceiptLine.goodsReceiptId))
      .where(eq(goodsReceipt.purchaseOrderId, parsed.data.purchaseOrderId));
    const stockLines = poLines.filter((line) => Boolean(line.itemId));
    const poLineById = new Map(stockLines.map((line) => [line.id, line]));
    const receivedByLine = new Map<string, number>();
    const legacyReceivedByItem = new Map<string, number>();
    for (const line of previousReceiptLines) {
      if (!line.itemId) continue;
      if (line.purchaseOrderLineId) {
        receivedByLine.set(line.purchaseOrderLineId, (receivedByLine.get(line.purchaseOrderLineId) ?? 0) + Number(line.quantity));
      } else {
        legacyReceivedByItem.set(line.itemId, (legacyReceivedByItem.get(line.itemId) ?? 0) + Number(line.quantity));
      }
    }
    for (const line of stockLines) {
      const itemId = line.itemId!;
      const legacyQuantity = legacyReceivedByItem.get(itemId) ?? 0;
      if (legacyQuantity <= 0) continue;
      const allocatable = Math.max(Number(line.quantity) - (receivedByLine.get(line.id) ?? 0), 0);
      const allocated = Math.min(legacyQuantity, allocatable);
      receivedByLine.set(line.id, (receivedByLine.get(line.id) ?? 0) + allocated);
      legacyReceivedByItem.set(itemId, legacyQuantity - allocated);
    }

    const requestedByLine = new Map<string, number>();
    const linesToInsert: Array<{ purchaseOrderLineId: string; itemId: string; quantity: string }> = [];
    const addRequestedQuantity = (sourceLineId: string, quantity: number) => {
      const source = poLineById.get(sourceLineId);
      if (!source?.itemId) throw new Error("La línea de recepción no pertenece al pedido.");
      const requested = (requestedByLine.get(sourceLineId) ?? 0) + quantity;
      const remaining = Number(source.quantity) - (receivedByLine.get(sourceLineId) ?? 0);
      if (requested > remaining + 0.0005) throw new Error("La cantidad recibida supera la cantidad pendiente del pedido.");
      requestedByLine.set(sourceLineId, requested);
    };

    if (parsed.data.lines && parsed.data.lines.length > 0) {
      for (const requestedLine of parsed.data.lines) {
        if (requestedLine.purchaseOrderLineId) {
          addRequestedQuantity(requestedLine.purchaseOrderLineId, requestedLine.quantity);
          continue;
        }
        if (!requestedLine.itemId) throw new Error("La línea de recepción no pertenece al pedido.");
        let quantityLeft = requestedLine.quantity;
        for (const source of stockLines.filter((line) => line.itemId === requestedLine.itemId)) {
          const available = Math.max(Number(source.quantity) - (receivedByLine.get(source.id) ?? 0) - (requestedByLine.get(source.id) ?? 0), 0);
          if (available <= 0.0005) continue;
          const allocated = Math.min(quantityLeft, available);
          addRequestedQuantity(source.id, allocated);
          quantityLeft -= allocated;
          if (quantityLeft <= 0.0005) break;
        }
        if (quantityLeft > 0.0005) throw new Error("La cantidad recibida supera la cantidad pendiente del pedido.");
      }
    } else {
      for (const source of stockLines) {
        const remaining = Number(source.quantity) - (receivedByLine.get(source.id) ?? 0);
        if (remaining > 0.0005) addRequestedQuantity(source.id, remaining);
      }
    }
    for (const [purchaseOrderLineId, quantity] of requestedByLine) {
      const source = poLineById.get(purchaseOrderLineId)!;
      linesToInsert.push({ purchaseOrderLineId, itemId: source.itemId!, quantity: quantity.toFixed(3) });
    }

    if (linesToInsert.length === 0) throw new Error("El pedido ya está completamente recibido.");

    const [createdHeader] = await tx.insert(goodsReceipt).values({ purchaseOrderId: parsed.data.purchaseOrderId, warehouseId: ownedWarehouse.id, supplierDocumentNumber: parsed.data.supplierDocumentNumber || null, notes: parsed.data.notes || null, receivedAt }).returning();

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
          unitCost: Number(poLineById.get(line.purchaseOrderLineId ?? "")?.unitPrice ?? 0),
        }, tx);
        await refreshStockLocation({ companyId: ctx.company.id, itemId: line.itemId, warehouseId: ownedWarehouse.id }, tx);
      }
    }

    const receivedAfter = new Map(receivedByLine);
    for (const line of linesToInsert) {
      receivedAfter.set(
        line.purchaseOrderLineId,
        (receivedAfter.get(line.purchaseOrderLineId) ?? 0) + Number(line.quantity),
      );
    }
    const fullyReceived = stockLines.every((line) => (receivedAfter.get(line.id) ?? 0) >= Number(line.quantity) - 0.0005);
    await tx
      .update(purchaseOrder)
      .set({ status: fullyReceived ? "RECEIVED" : "PARTIALLY_RECEIVED" })
      .where(eq(purchaseOrder.id, parsed.data.purchaseOrderId));

    await recordAudit({
      tenantId: ctx.tenant.id,
      companyId: ctx.company.id,
      actorUserId: session.user.id,
      action: "purchase.receipt.create",
      entityName: "goods_receipt",
      entityId: createdHeader.id,
      payload: {
        purchaseOrderId: parsed.data.purchaseOrderId,
        warehouseId: ownedWarehouse.id,
        supplierDocumentNumber: parsed.data.supplierDocumentNumber || null,
        lines: linesToInsert,
      },
    }, tx);

    return createdHeader;
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "No se pudo registrar la recepción." }, { status: 400 });
  }
}
