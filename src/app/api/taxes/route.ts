import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { tax } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  return NextResponse.json(await db.select().from(tax).where(eq(tax.companyId, ctx.company.id)));
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "settings.manage")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = (await readJsonBody(request)) as { name?: string; rate?: number } | null;
  if (!payload) return invalidJsonResponse();

  if (!payload.name?.trim() || Number(payload.rate) <= 0) return NextResponse.json({ message: "name y rate obligatorios." }, { status: 400 });
  const [created] = await db.insert(tax).values({ companyId: ctx.company.id, name: payload.name.trim(), rate: Number(payload.rate).toFixed(3) }).returning();
  return NextResponse.json(created, { status: 201 });
}
