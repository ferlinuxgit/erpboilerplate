import { NextResponse } from "next/server";

import { customer } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { canManageCustomers } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { createCustomerSchema } from "@/server/schemas/forms";

export async function POST(request: Request) {
  const session = await getUserSession();

  if (!session?.user) {
    return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  }

  const tenantContext = await ensureUserTenant({
    id: session.user.id,
    name: session.user.name,
  });

  if (!canManageCustomers(tenantContext.membership.role)) {
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

  const name = parsedPayload.data.name.trim();
  const email = parsedPayload.data.email?.trim() || null;
  const phone = parsedPayload.data.phone?.trim() || null;

  const createdCustomers = await db
    .insert(customer)
    .values({
      name,
      email,
      phone,
      companyId: tenantContext.company.id,
    })
    .returning({
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      status: customer.status,
    });

  return NextResponse.json(createdCustomers[0], { status: 201 });
}
