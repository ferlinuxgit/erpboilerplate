import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { item, stockMovement, warehouse } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { refreshStockLocation } from "@/server/inventory/stock-location";

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const rows = await db.select().from(stockMovement).where(eq(stockMovement.companyId, ctx.company.id));
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "stock.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = (await request.json()) as { itemId?: string; warehouseId?: string; movementType?: "IN" | "OUT" | "ADJUSTMENT" | "TRANSFER"; quantity?: string };
  if (!payload.itemId || !payload.warehouseId || !payload.movementType || !payload.quantity) return NextResponse.json({ message: "Datos incompletos." }, { status: 400 });
  const quantityNumber = Number(payload.quantity);
  if (Number.isNaN(quantityNumber) || quantityNumber <= 0) {
    return NextResponse.json({ message: "La cantidad debe ser un número positivo." }, { status: 400 });
  }
  const ownedItem = await db.select({ id: item.id }).from(item).where(and(eq(item.id, payload.itemId), eq(item.companyId, ctx.company.id))).limit(1);
  const ownedWarehouse = await db.select({ id: warehouse.id }).from(warehouse).where(and(eq(warehouse.id, payload.warehouseId), eq(warehouse.companyId, ctx.company.id))).limit(1);
  if (!ownedItem[0] || !ownedWarehouse[0]) return NextResponse.json({ message: "Item o almacén inválido." }, { status: 404 });
  const [created] = await db
    .insert(stockMovement)
    .values({
      companyId: ctx.company.id,
      itemId: payload.itemId,
      warehouseId: payload.warehouseId,
      movementType: payload.movementType,
      quantity: quantityNumber.toFixed(3),
    })
    .returning();
  await refreshStockLocation({
    companyId: ctx.company.id,
    itemId: payload.itemId,
    warehouseId: payload.warehouseId,
  });
  return NextResponse.json(created, { status: 201 });
}
