import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { goodsReceipt, goodsReceiptLine, purchaseOrder, purchaseOrderLine, stockMovement, supplierInvoiceLine, warehouse } from "@/db/schema";
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

  const created = await db.transaction(async (tx) => {
    const [createdHeader] = await tx
      .insert(goodsReceipt)
      .values({
        purchaseOrderId: parsed.data.purchaseOrderId,
        receivedAt: new Date(parsed.data.receivedAt),
      })
      .returning();

    const poLines = await tx
      .select()
      .from(purchaseOrderLine)
      .where(eq(purchaseOrderLine.purchaseOrderId, parsed.data.purchaseOrderId));

    const linesToInsert =
      parsed.data.lines && parsed.data.lines.length > 0
        ? parsed.data.lines.map((line) => ({
            goodsReceiptId: createdHeader.id,
            itemId: line.itemId || null,
            quantity: line.quantity.toFixed(3),
          }))
        : poLines.map((line) => ({
            goodsReceiptId: createdHeader.id,
            itemId: line.itemId,
            quantity: line.quantity,
          }));

    if (linesToInsert.length > 0) {
      const insertedLines = await tx.insert(goodsReceiptLine).values(linesToInsert).returning();
      for (const line of insertedLines) {
        if (!line.itemId) continue;
        const [movement] = await tx.insert(stockMovement).values({
          companyId: ctx.company.id,
          itemId: line.itemId,
          warehouseId: ownedWarehouse.id,
          movementType: "IN",
          quantity: line.quantity,
          movedAt: new Date(parsed.data.receivedAt),
        }).returning({ id: stockMovement.id });

        const [latestInvoiceLine] = await tx
          .select({ unitPrice: supplierInvoiceLine.unitPrice })
          .from(supplierInvoiceLine)
          .where(eq(supplierInvoiceLine.itemId, line.itemId))
          .orderBy(supplierInvoiceLine.id)
          .limit(1);

        await registerInMovementCost({
          companyId: ctx.company.id,
          itemId: line.itemId,
          movementId: movement.id,
          quantity: Number(line.quantity),
          unitCost: Number(latestInvoiceLine?.unitPrice ?? "0"),
        }, tx);
        await refreshStockLocation({ companyId: ctx.company.id, itemId: line.itemId, warehouseId: ownedWarehouse.id }, tx);
      }
    }

    return createdHeader;
  });

  return NextResponse.json(created, { status: 201 });
}
