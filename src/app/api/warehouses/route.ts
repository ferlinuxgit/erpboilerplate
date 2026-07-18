import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { warehouse } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { recordAudit } from "@/server/audit";

const warehousePayloadSchema = z.object({ name: z.string().trim().min(1, "El nombre es obligatorio."), code: z.string().trim().min(1, "El código es obligatorio.") });

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
  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();
  const parsed = warehousePayloadSchema.safeParse(payload); if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const [created] = await db.insert(warehouse).values({ companyId: ctx.company.id, name: parsed.data.name, code: parsed.data.code }).returning();
  await recordAudit({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: session.user.id, action: "warehouse.create", entityName: "warehouse", entityId: created.id, payload: parsed.data });
  return NextResponse.json(created, { status: 201 });
}
