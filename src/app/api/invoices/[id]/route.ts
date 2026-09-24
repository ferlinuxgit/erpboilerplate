import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { invoice, invoiceLine, invoicePaymentMethod } from "@/db/schema";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { invoiceErrorResponse, toInvoiceActor } from "@/server/invoices/http";
import { invoiceLifecycle } from "@/server/invoices/lifecycle";
import { updateDraftInvoiceSchema } from "@/server/invoices/schemas";
import { updateInvoice, voidInvoice } from "@/server/invoices/service";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  const ctx = actor.context;
  if (!hasApiActorPermission(actor, "invoice.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const { id } = await params;
  const [row] = await db.select().from(invoice).where(and(eq(invoice.id, id), eq(invoice.companyId, ctx.company.id))).limit(1);
  if (!row) return NextResponse.json({ message: "Factura no encontrada." }, { status: 404 });

  const [lines, paymentMethods] = await Promise.all([
    db.select({
      id: invoiceLine.id,
      description: invoiceLine.description,
      quantity: invoiceLine.quantity,
      unitPrice: invoiceLine.unitPrice,
      discountPct: invoiceLine.discountPct,
      taxRate: invoiceLine.taxRate,
      retentionRate: invoiceLine.retentionRate,
      lineTotal: invoiceLine.lineTotal,
    }).from(invoiceLine).where(eq(invoiceLine.invoiceId, row.id)),
    db.select({
      id: invoicePaymentMethod.paymentMethodId,
      name: invoicePaymentMethod.name,
      type: invoicePaymentMethod.type,
      bankAccountNumber: invoicePaymentMethod.bankAccountNumber,
      position: invoicePaymentMethod.position,
    }).from(invoicePaymentMethod)
      .where(eq(invoicePaymentMethod.invoiceId, row.id))
      .orderBy(asc(invoicePaymentMethod.position)),
  ]);

  return NextResponse.json({ ...row, lifecycle: invoiceLifecycle(row), lines, paymentMethods });
}

/**
 * Borrador: actualiza cualquier campo (y opcionalmente lo emite con `issue: true`).
 * Emitida: solo notas y formas de pago; el resto responde 409 explicando cómo rectificar.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  if (!hasApiActorPermission(actor, "invoice.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsedPayload = updateDraftInvoiceSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return NextResponse.json({ message: parsedPayload.error.issues[0]?.message ?? "Los datos son inválidos." }, { status: 400 });
  }

  const { id } = await params;
  try {
    const updated = await updateInvoice(toInvoiceActor(actor), id, parsedPayload.data);
    if (!updated) return NextResponse.json({ message: "Factura no encontrada." }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return invoiceErrorResponse(error, "invoice.update", "No se pudo actualizar la factura.");
  }
}

/** Anula un borrador. Las facturas emitidas se corrigen con una rectificativa (409). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  if (!hasApiActorPermission(actor, "invoice.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  try {
    const voided = await voidInvoice(toInvoiceActor(actor), id);
    if (!voided) return NextResponse.json({ message: "Factura no encontrada." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return invoiceErrorResponse(error, "invoice.void", "No se pudo anular la factura.");
  }
}
