import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { recordAudit } from "@/server/audit";
import { createSupplierWithPartner, listSuppliers } from "@/server/suppliers/service";
import { createSupplierSchema } from "@/server/schemas/forms";

export async function GET(request: Request) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  if (!hasApiActorPermission(actor, "supplier.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const rows = await listSuppliers(db, actor.context.company.id);
  return NextResponse.json({ data: rows });
}

export async function POST(request: Request) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  if (!hasApiActorPermission(actor, "supplier.create")) {
    return NextResponse.json({ message: "No tienes permisos para crear proveedores en esta empresa." }, { status: 403 });
  }

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsedPayload = createSupplierSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return NextResponse.json({ message: parsedPayload.error.issues[0]?.message ?? "Los datos son inválidos." }, { status: 400 });
  }

  try {
    const createdSupplier = await db.transaction(async (tx) => {
      const created = await createSupplierWithPartner(tx, actor.context.company.id, parsedPayload.data);
      await recordAudit(
        {
          tenantId: actor.context.tenant.id,
          companyId: actor.context.company.id,
          actorUserId: actor.actorUserId,
          action: "supplier.create",
          entityName: "partner",
          entityId: created.id,
          payload: { ...parsedPayload.data, number: created.number },
        },
        tx,
      );
      return created;
    });
    return NextResponse.json(createdSupplier, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "supplier.create", "No se pudo crear el proveedor.");
  }
}
