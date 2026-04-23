import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { warehouse } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const rows = await db.select().from(warehouse).where(eq(warehouse.companyId, ctx.company.id));
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "stock.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = (await request.json()) as { name?: string; code?: string };
  if (!payload.name?.trim() || !payload.code?.trim()) return NextResponse.json({ message: "name y code obligatorios." }, { status: 400 });
  const [created] = await db.insert(warehouse).values({ companyId: ctx.company.id, name: payload.name.trim(), code: payload.code.trim() }).returning();
  return NextResponse.json(created, { status: 201 });
}
