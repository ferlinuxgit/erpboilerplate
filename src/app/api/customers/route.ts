import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { customer, partner } from "@/db/schema";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { authenticateApiActor, isAuthError } from "@/lib/integration-auth";
import { logger } from "@/lib/logger";
import { can, canManageCustomers } from "@/lib/rbac";
import { createCustomerWithPartner } from "@/server/customers/service";
import { createCustomerSchema } from "@/server/schemas/forms";

export async function GET(request: Request) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;

  if (!can(actor.context.membership.role, "customer.read")) {
    return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  }

  const rows = await db
    .select({
      id: customer.id,
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

  if (!canManageCustomers(actor.context.membership.role)) {
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
    const createdCustomer = await db.transaction((tx) =>
      createCustomerWithPartner(tx, actor.context.company.id, parsedPayload.data),
    );

    return NextResponse.json(createdCustomer, { status: 201 });
  } catch (error) {
    logger.error({ error }, "customer.create_failed");
    return NextResponse.json({ message: "No se pudo crear el cliente. Revisa si el CIF/NIF ya existe o si hay migraciones pendientes." }, { status: 500 });
  }
}
