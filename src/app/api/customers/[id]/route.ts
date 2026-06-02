import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { customer, partner } from "@/db/schema";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { authenticateApiActor, isAuthError } from "@/lib/integration-auth";
import { can } from "@/lib/rbac";
import { recordAudit } from "@/server/audit";
import { updateCustomerWithPartner } from "@/server/customers/service";
import { updateCustomerSchema } from "@/server/schemas/forms";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  const ctx = actor.context;
  if (!can(ctx.membership.role, "customer.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const { id } = await params;
  const [row] = await db
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
    .where(and(eq(customer.id, id), eq(customer.companyId, ctx.company.id)))
    .limit(1);

  if (!row) return NextResponse.json({ message: "Cliente no encontrado." }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  const ctx = actor.context;
  if (!can(ctx.membership.role, "customer.create")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsedPayload = updateCustomerSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return NextResponse.json({ message: parsedPayload.error.issues[0]?.message ?? "Los datos son inválidos." }, { status: 400 });
  }

  const values = parsedPayload.data;
  const { id } = await params;
  const existingCustomers = await db
    .select({ id: customer.id, partnerId: customer.partnerId })
    .from(customer)
    .where(and(eq(customer.id, id), eq(customer.companyId, ctx.company.id)))
    .limit(1);
  if (!existingCustomers[0]) return NextResponse.json({ message: "Cliente no encontrado." }, { status: 404 });

  const updated = await db.transaction((tx) =>
    updateCustomerWithPartner(tx, ctx.company.id, id, existingCustomers[0].partnerId, values),
  );
  if (!updated) return NextResponse.json({ message: "Cliente no encontrado." }, { status: 404 });
  await recordAudit({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: actor.actorUserId, action: "customer.update", entityName: "customer", entityId: id, payload: values });
  return NextResponse.json(updated);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  const ctx = actor.context;
  if (!can(ctx.membership.role, "customer.create")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  const [deleted] = await db.delete(customer).where(and(eq(customer.id, id), eq(customer.companyId, ctx.company.id))).returning({ id: customer.id });
  if (!deleted) return NextResponse.json({ message: "Cliente no encontrado." }, { status: 404 });
  await recordAudit({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: actor.actorUserId, action: "customer.delete", entityName: "customer", entityId: id });
  return NextResponse.json({ ok: true });
}
