import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { authenticateApiActor, isAuthError } from "@/lib/integration-auth";
import { logger } from "@/lib/logger";
import { can, canManageSuppliers } from "@/lib/rbac";
import { createSupplierWithPartner, listSuppliers } from "@/server/suppliers/service";
import { createSupplierSchema } from "@/server/schemas/forms";

export async function GET(request: Request) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  if (!can(actor.context.membership.role, "supplier.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const rows = await listSuppliers(db, actor.context.company.id);
  return NextResponse.json({ data: rows });
}

export async function POST(request: Request) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  if (!canManageSuppliers(actor.context.membership.role)) {
    return NextResponse.json({ message: "No tienes permisos para crear proveedores en esta empresa." }, { status: 403 });
  }

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsedPayload = createSupplierSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return NextResponse.json({ message: parsedPayload.error.issues[0]?.message ?? "Los datos son inválidos." }, { status: 400 });
  }

  try {
    const createdSupplier = await db.transaction((tx) =>
      createSupplierWithPartner(tx, actor.context.company.id, parsedPayload.data),
    );
    return NextResponse.json(createdSupplier, { status: 201 });
  } catch (error) {
    logger.error({ error }, "supplier.create_failed");
    const message = error instanceof Error ? error.message : "No se pudo crear el proveedor.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
