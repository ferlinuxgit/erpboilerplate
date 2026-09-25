import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { customer, partner } from "@/db/schema";
import { db } from "@/lib/db";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { recordAudit } from "@/server/audit";
import { CUSTOMER_HAS_DOCUMENTS_MESSAGE, customerUpdateFormSchema } from "@/server/customers/schemas";
import { updateCustomerWithPartner } from "@/server/customers/service";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  const ctx = actor.context;
  if (!hasApiActorPermission(actor, "customer.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const { id } = await params;
  const [row] = await db
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
      paymentTermsDays: partner.paymentTermsDays,
      defaultRetentionRate: customer.defaultRetentionRate,
      defaultVatTreatment: customer.defaultVatTreatment,
      invoiceEmail: customer.invoiceEmail,
      iban: customer.iban,
      equivalenceSurcharge: customer.equivalenceSurcharge,
      viesStatus: customer.viesStatus,
      viesName: customer.viesName,
      viesCheckedAt: customer.viesCheckedAt,
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
  if (!hasApiActorPermission(actor, "customer.create")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsedPayload = customerUpdateFormSchema.safeParse(payload);
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

  try {
    const updated = await db.transaction(async (tx) => {
      const row = await updateCustomerWithPartner(tx, ctx.company.id, id, existingCustomers[0].partnerId, values);
      if (!row) return null;
      await recordAudit(
        { tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: actor.actorUserId, action: "customer.update", entityName: "customer", entityId: id, payload: values },
        tx,
      );
      return row;
    });
    if (!updated) return NextResponse.json({ message: "Cliente no encontrado." }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return handleRouteError(error, "customer.update", "No se pudo actualizar el cliente.");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  const ctx = actor.context;
  if (!hasApiActorPermission(actor, "customer.create")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  try {
    const deleted = await db.transaction(async (tx) => {
      const [row] = await tx
        .delete(customer)
        .where(and(eq(customer.id, id), eq(customer.companyId, ctx.company.id)))
        .returning({ id: customer.id, name: customer.name, partnerId: customer.partnerId });
      if (!row) return null;
      await recordAudit(
        { tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: actor.actorUserId, action: "customer.delete", entityName: "customer", entityId: id, payload: { name: row.name, partnerId: row.partnerId } },
        tx,
      );
      return row;
    });
    if (!deleted) return NextResponse.json({ message: "Cliente no encontrado." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    // Con facturas, presupuestos, pedidos o albaranes la base de datos impide borrarlo (FK restrict):
    // en lugar de un 500 se explica y se ofrece marcarlo como Inactivo.
    const databaseError = (error as { code?: string; cause?: { code?: string } } | null);
    if (databaseError?.code === "23503" || databaseError?.cause?.code === "23503") {
      return NextResponse.json({ message: CUSTOMER_HAS_DOCUMENTS_MESSAGE, canDeactivate: true }, { status: 409 });
    }
    return handleRouteError(error, "customer.delete", "No se pudo eliminar el cliente.");
  }
}
