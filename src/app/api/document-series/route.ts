import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { documentSeries } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "series.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const rows = await db.select().from(documentSeries).where(eq(documentSeries.companyId, ctx.company.id));
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "series.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = (await request.json()) as { type?: "SALES_INVOICE" | "PURCHASE_ORDER"; prefix?: string; nextNumber?: number };
  if (!payload.type || !payload.prefix?.trim()) return NextResponse.json({ message: "type y prefix obligatorios." }, { status: 400 });
  const [created] = await db
    .insert(documentSeries)
    .values({ companyId: ctx.company.id, fiscalYearId: ctx.fiscalYear.id, type: payload.type, prefix: payload.prefix.trim(), nextNumber: payload.nextNumber ?? 1 })
    .returning();
  return NextResponse.json(created, { status: 201 });
}
