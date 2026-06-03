import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { authenticateApiActor, isAuthError } from "@/lib/integration-auth";
import { can } from "@/lib/rbac";
import { recordAudit } from "@/server/audit";
import { getSupplier, removeSupplierRole, updateSupplierWithPartner } from "@/server/suppliers/service";
import { updateSupplierSchema } from "@/server/schemas/forms";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  const ctx = actor.context;
  if (!can(ctx.membership.role, "supplier.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const { id } = await params;
  const row = await getSupplier(db, ctx.company.id, id);
  if (!row) return NextResponse.json({ message: "Proveedor no encontrado." }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  const ctx = actor.context;
  if (!can(ctx.membership.role, "supplier.create")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsedPayload = updateSupplierSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return NextResponse.json({ message: parsedPayload.error.issues[0]?.message ?? "Los datos son inválidos." }, { status: 400 });
  }

  const { id } = await params;
  try {
    const updated = await db.transaction((tx) =>
      updateSupplierWithPartner(tx, ctx.company.id, id, parsedPayload.data),
    );
    if (!updated) return NextResponse.json({ message: "Proveedor no encontrado." }, { status: 404 });
    await recordAudit({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: actor.actorUserId, action: "supplier.update", entityName: "supplier", entityId: id, payload: parsedPayload.data });
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo actualizar el proveedor.";
    return NextResponse.json({ message }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  const ctx = actor.context;
  if (!can(ctx.membership.role, "supplier.create")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  const updated = await removeSupplierRole(db, ctx.company.id, id);
  if (!updated) return NextResponse.json({ message: "Proveedor no encontrado." }, { status: 404 });
  await recordAudit({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: actor.actorUserId, action: "supplier.delete", entityName: "supplier", entityId: id });
  return NextResponse.json({ ok: true });
}
