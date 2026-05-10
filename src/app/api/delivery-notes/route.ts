import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { customer, deliveryNote, deliveryNoteLine, salesOrder, salesOrderLine, stockMovement, warehouse } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { reserveSeriesNumber } from "@/server/documents/series";
import { refreshStockLocation } from "@/server/inventory/stock-location";

const payloadSchema = z.object({
  customerId: z.string().trim().min(1),
  warehouseId: z.string().trim().optional().or(z.literal("")),
  salesOrderId: z.string().trim().optional().or(z.literal("")),
  number: z.string().trim().optional().or(z.literal("")),
  issuedAt: z.string().trim().min(1),
});

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "invoice.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  return NextResponse.json(await db.select().from(deliveryNote).where(eq(deliveryNote.companyId, ctx.company.id)));
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "invoice.create")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const parsed = payloadSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });

  const [ownedCustomer] = await db
    .select({ id: customer.id })
    .from(customer)
    .where(and(eq(customer.id, parsed.data.customerId), eq(customer.companyId, ctx.company.id)))
    .limit(1);
  if (!ownedCustomer) return NextResponse.json({ message: "Cliente no encontrado." }, { status: 404 });
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

  const [ownedOrder] = parsed.data.salesOrderId
    ? await db
        .select({ id: salesOrder.id })
        .from(salesOrder)
        .where(
          and(
            eq(salesOrder.id, parsed.data.salesOrderId),
            eq(salesOrder.companyId, ctx.company.id),
            eq(salesOrder.customerId, parsed.data.customerId),
          ),
        )
        .limit(1)
    : [];
  if (parsed.data.salesOrderId && !ownedOrder) {
    return NextResponse.json({ message: "Pedido no encontrado." }, { status: 404 });
  }

  const created = await db.transaction(async (tx) => {
    const number =
      parsed.data.number?.trim() ||
      (await reserveSeriesNumber(tx, {
        companyId: ctx.company.id,
        fiscalYearId: ctx.fiscalYear.id,
        type: "DELIVERY_NOTE",
      }));

    const [header] = await tx.insert(deliveryNote).values({
      companyId: ctx.company.id,
      customerId: parsed.data.customerId,
      salesOrderId: parsed.data.salesOrderId || null,
      number,
      issuedAt: new Date(parsed.data.issuedAt),
      status: "DELIVERED",
    }).returning();

    if (parsed.data.salesOrderId) {
      const orderLines = await tx
        .select()
        .from(salesOrderLine)
        .where(eq(salesOrderLine.salesOrderId, parsed.data.salesOrderId));
      if (orderLines.length > 0) {
        const insertedLines = await tx.insert(deliveryNoteLine).values(
          orderLines.map((line) => ({
            deliveryNoteId: header.id,
            itemId: line.itemId,
            description: line.description,
            quantity: line.quantity,
          })),
        ).returning();
        for (const line of insertedLines) {
          if (!line.itemId) continue;
          await tx.insert(stockMovement).values({
            companyId: ctx.company.id,
            itemId: line.itemId,
            warehouseId: ownedWarehouse.id,
            movementType: "OUT",
            quantity: line.quantity,
            movedAt: new Date(parsed.data.issuedAt),
          });
          await refreshStockLocation({ companyId: ctx.company.id, itemId: line.itemId, warehouseId: ownedWarehouse.id }, tx);
        }
      }
      await tx
        .update(salesOrder)
        .set({ status: "DELIVERED", updatedAt: new Date() })
        .where(and(eq(salesOrder.id, parsed.data.salesOrderId), eq(salesOrder.companyId, ctx.company.id)));
    }

    return header;
  });

  return NextResponse.json(created, { status: 201 });
}
