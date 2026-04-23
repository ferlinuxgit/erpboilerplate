import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { item, stockMovement, warehouse } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { getStockSnapshot } from "@/server/inventory/service";

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const tenantContext = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const stock = await getStockSnapshot(tenantContext.company.id);
  return NextResponse.json(stock);
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const tenantContext = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(tenantContext.membership.role, "stock.write")) {
    return NextResponse.json({ message: "Sin permisos para mover stock." }, { status: 403 });
  }

  const payload = (await request.json()) as { itemName?: string; quantity?: number };
  const itemName = payload.itemName?.trim();
  const quantity = Number(payload.quantity ?? 0);
  if (!itemName || quantity === 0) return NextResponse.json({ message: "itemName y quantity son obligatorios." }, { status: 400 });

  const [createdWarehouse] = await db
    .insert(warehouse)
    .values({ companyId: tenantContext.company.id, name: "Principal", code: "MAIN" })
    .onConflictDoNothing()
    .returning({ id: warehouse.id });

  const wh = createdWarehouse ?? (await db.select({ id: warehouse.id }).from(warehouse).where(eq(warehouse.companyId, tenantContext.company.id)).limit(1))[0];

  const [createdItem] = await db
    .insert(item)
    .values({ companyId: tenantContext.company.id, sku: `SKU-${Date.now()}`, name: itemName })
    .onConflictDoNothing()
    .returning({ id: item.id });

  const resolvedItem =
    createdItem ??
    (await db.select({ id: item.id }).from(item).where(and(eq(item.companyId, tenantContext.company.id), eq(item.name, itemName))).limit(1))[0];

  const [movement] = await db
    .insert(stockMovement)
    .values({
      companyId: tenantContext.company.id,
      itemId: resolvedItem.id,
      warehouseId: wh.id,
      movementType: quantity > 0 ? "IN" : "OUT",
      quantity: Math.abs(quantity).toString(),
    })
    .returning({ id: stockMovement.id, movementType: stockMovement.movementType, quantity: stockMovement.quantity });

  return NextResponse.json(movement, { status: 201 });
}
