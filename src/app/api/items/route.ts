import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { item } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const rows = await db.select().from(item).where(eq(item.companyId, ctx.company.id));
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "stock.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = (await readJsonBody(request)) as { name?: string; sku?: string } | null;
  if (!payload) return invalidJsonResponse();

  if (!payload.name?.trim() || !payload.sku?.trim()) return NextResponse.json({ message: "name y sku obligatorios." }, { status: 400 });
  const [created] = await db.insert(item).values({ companyId: ctx.company.id, name: payload.name.trim(), sku: payload.sku.trim() }).returning();
  return NextResponse.json(created, { status: 201 });
}
