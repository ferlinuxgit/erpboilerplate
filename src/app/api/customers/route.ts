import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { customer, partner } from "@/db/schema";
import { db } from "@/lib/db";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { recordAudit } from "@/server/audit";
import { createCustomerWithPartner } from "@/server/customers/service";
import { createCustomerSchema } from "@/server/schemas/forms";

export async function GET(request: Request) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;

  if (!hasApiActorPermission(actor, "customer.read")) {
    return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  }

  const rows = await db
    .select({
      id: customer.id,
      number: partner.number,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      status: customer.status,
      partnerId: customer.partnerId,
      taxId: partner.taxId,
      address: partner.address,
      addressLine2: partner.addressLine2,
      postalCode: partner.postalCode,
      city: partner.city,
      province: partner.province,
      countryCode: partner.countryCode,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    })
    .from(customer)
    .leftJoin(partner, eq(partner.id, customer.partnerId))
    .where(eq(customer.companyId, actor.context.company.id))
    .orderBy(desc(customer.createdAt));

  return NextResponse.json({ data: rows });
}

export async function POST(request: Request) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;

  if (!hasApiActorPermission(actor, "customer.create")) {
    return NextResponse.json(
      { message: "No tienes permisos para crear clientes en esta empresa." },
      { status: 403 },
    );
  }

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsedPayload = createCustomerSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return NextResponse.json({ message: parsedPayload.error.issues[0]?.message ?? "Los datos son inválidos." }, { status: 400 });
  }

  try {
    const createdCustomer = await db.transaction(async (tx) => {
      const created = await createCustomerWithPartner(tx, actor.context.company.id, parsedPayload.data);
      await recordAudit(
        {
          tenantId: actor.context.tenant.id,
          companyId: actor.context.company.id,
          actorUserId: actor.actorUserId,
          action: "customer.create",
          entityName: "customer",
          entityId: created.id,
          payload: { ...parsedPayload.data, number: created.number, partnerId: created.partnerId },
        },
        tx,
      );
      return created;
    });

    return NextResponse.json(createdCustomer, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "customer.create", "No se pudo crear el cliente. Revisa si el CIF/NIF ya existe o si hay migraciones pendientes.");
  }
}
