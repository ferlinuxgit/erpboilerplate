import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { warehouse } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { settle } from "@/lib/settle";
import { ensureUserTenant } from "@/lib/tenant";
import { recordAudit } from "@/server/audit";

const payloadSchema = z.object({ name: z.string().trim().min(1), code: z.string().trim().min(1) });

function isUniqueViolation(error: unknown) {
  const candidate = error as { code?: string; cause?: { code?: string } } | null;
  return candidate?.code === "23505" || candidate?.cause?.code === "23505";
}

async function context() { const session = await getUserSession(); if (!session?.user) return null; return { session, ctx: await ensureUserTenant({ id: session.user.id, name: session.user.name }) }; }
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) { const auth = await context(); if (!auth) return NextResponse.json({ message: "No autorizado." }, { status: 401 }); if (!can(auth.ctx.membership.role, "stock.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 }); const { id } = await params; const [record] = await db.select().from(warehouse).where(and(eq(warehouse.id, id), eq(warehouse.companyId, auth.ctx.company.id))).limit(1); return record ? NextResponse.json(record) : NextResponse.json({ message: "Almacén no encontrado." }, { status: 404 }); }

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await context();
  if (!auth) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  if (!can(auth.ctx.membership.role, "stock.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });
  const { id } = await params;

  const result = await settle(db.transaction(async (tx) => {
    const [row] = await tx
      .update(warehouse)
      .set({ ...parsed.data, isActive: true })
      .where(and(eq(warehouse.id, id), eq(warehouse.companyId, auth.ctx.company.id)))
      .returning();
    if (!row) return null;
    await recordAudit(
      { tenantId: auth.ctx.tenant.id, companyId: auth.ctx.company.id, actorUserId: auth.session.user.id, action: "warehouse.update", entityName: "warehouse", entityId: id, payload: parsed.data },
      tx,
    );
    return row;
  }));
  if (!result.ok) {
    if (isUniqueViolation(result.error)) return jsonError(409, "Ya existe un almacén con ese código.");
    return handleRouteError(result.error, "warehouse.update", "No se pudo actualizar el almacén.");
  }
  if (!result.value) return NextResponse.json({ message: "Almacén no encontrado." }, { status: 404 });
  return NextResponse.json(result.value);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await context();
  if (!auth) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  if (!can(auth.ctx.membership.role, "stock.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;

  const result = await settle(db.transaction(async (tx) => {
    const [row] = await tx
      .update(warehouse)
      .set({ isActive: false })
      .where(and(eq(warehouse.id, id), eq(warehouse.companyId, auth.ctx.company.id)))
      .returning({ id: warehouse.id, name: warehouse.name, code: warehouse.code });
    if (!row) return null;
    await recordAudit(
      { tenantId: auth.ctx.tenant.id, companyId: auth.ctx.company.id, actorUserId: auth.session.user.id, action: "warehouse.archive", entityName: "warehouse", entityId: id, payload: { name: row.name, code: row.code } },
      tx,
    );
    return row;
  }));
  if (!result.ok) return handleRouteError(result.error, "warehouse.archive", "No se pudo archivar el almacén.");
  if (!result.value) return NextResponse.json({ message: "Almacén no encontrado." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
