import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { recordAudit } from "@/server/audit";
import { getSupplier, removeSupplierRole, updateSupplierWithPartner } from "@/server/suppliers/service";
import { updateSupplierSchema } from "@/server/schemas/forms";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  const ctx = actor.context;
  if (!hasApiActorPermission(actor, "supplier.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const { id } = await params;
  const row = await getSupplier(db, ctx.company.id, id);
  if (!row) return NextResponse.json({ message: "Proveedor no encontrado." }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  const ctx = actor.context;
  if (!hasApiActorPermission(actor, "supplier.create")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsedPayload = updateSupplierSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return NextResponse.json({ message: parsedPayload.error.issues[0]?.message ?? "Los datos son inválidos." }, { status: 400 });
  }

  const { id } = await params;
  try {
    const updated = await db.transaction(async (tx) => {
      const row = await updateSupplierWithPartner(tx, ctx.company.id, id, parsedPayload.data);
      if (!row) return null;
      await recordAudit(
        { tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: actor.actorUserId, action: "supplier.update", entityName: "partner", entityId: id, payload: parsedPayload.data },
        tx,
      );
      return row;
    });
    if (!updated) return NextResponse.json({ message: "Proveedor no encontrado." }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return handleRouteError(error, "supplier.update", "No se pudo actualizar el proveedor.");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  const ctx = actor.context;
  if (!hasApiActorPermission(actor, "supplier.create")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  try {
    const updated = await db.transaction(async (tx) => {
      const row = await removeSupplierRole(tx, ctx.company.id, id);
      if (!row) return null;
      await recordAudit(
        { tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: actor.actorUserId, action: "supplier.delete", entityName: "partner", entityId: id },
        tx,
      );
      return row;
    });
    if (!updated) return NextResponse.json({ message: "Proveedor no encontrado." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "supplier.delete", "No se pudo eliminar el proveedor.");
  }
}
