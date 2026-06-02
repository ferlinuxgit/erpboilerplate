import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { invoice, invoiceLine } from "@/db/schema";
import { db } from "@/lib/db";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { authenticateApiActor, isAuthError } from "@/lib/integration-auth";
import { can } from "@/lib/rbac";
import { recordAudit } from "@/server/audit";
import { assertFiscalPeriodOpen } from "@/server/fiscal/locks";
import { buildInvoiceLineInsertValues } from "@/server/invoices/line-values";
import { updateInvoiceSchema } from "@/server/schemas/forms";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  const ctx = actor.context;
  if (!can(ctx.membership.role, "invoice.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const { id } = await params;
  const [row] = await db.select().from(invoice).where(and(eq(invoice.id, id), eq(invoice.companyId, ctx.company.id))).limit(1);
  if (!row) return NextResponse.json({ message: "Factura no encontrada." }, { status: 404 });

  const lines = await db
    .select({
      id: invoiceLine.id,
      description: invoiceLine.description,
      quantity: invoiceLine.quantity,
      unitPrice: invoiceLine.unitPrice,
      discountPct: invoiceLine.discountPct,
      taxRate: invoiceLine.taxRate,
      retentionRate: invoiceLine.retentionRate,
      lineTotal: invoiceLine.lineTotal,
    })
    .from(invoiceLine)
    .where(eq(invoiceLine.invoiceId, row.id));

  return NextResponse.json({ ...row, lines });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  const ctx = actor.context;
  if (!can(ctx.membership.role, "invoice.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsedPayload = updateInvoiceSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return NextResponse.json({ message: parsedPayload.error.issues[0]?.message ?? "Los datos son inválidos." }, { status: 400 });
  }
  const values = parsedPayload.data;
  const { id } = await params;
  const invoiceTotals = calculateInvoiceTotals(values.lines);

  try {
    const updated = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ issueDate: invoice.issueDate })
        .from(invoice)
        .where(and(eq(invoice.id, id), eq(invoice.companyId, ctx.company.id)))
        .limit(1);
      if (!existing) return null;

      await assertFiscalPeriodOpen(ctx.company.id, existing.issueDate, tx);

      const [row] = await tx
        .update(invoice)
        .set({
          number: values.number.trim(),
          status: values.status,
          notes: values.notes?.trim() || null,
          totalAmount: invoiceTotals.totalAmount.toFixed(2),
          updatedAt: new Date(),
        })
        .where(and(eq(invoice.id, id), eq(invoice.companyId, ctx.company.id)))
        .returning();

      if (!row) return null;

      await tx.delete(invoiceLine).where(eq(invoiceLine.invoiceId, id));
      await tx.insert(invoiceLine).values(buildInvoiceLineInsertValues(id, values.lines));

      return row;
    });

    if (!updated) return NextResponse.json({ message: "Factura no encontrada." }, { status: 404 });

    await recordAudit({
      tenantId: ctx.tenant.id,
      companyId: ctx.company.id,
      actorUserId: actor.actorUserId,
      action: "invoice.update",
      entityName: "invoice",
      entityId: id,
      payload: { number: values.number, status: values.status, totalAmount: invoiceTotals.totalAmount },
    });

    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo actualizar la factura.";
    return NextResponse.json({ message }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  const ctx = actor.context;
  if (!can(ctx.membership.role, "invoice.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  const deleted = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ issueDate: invoice.issueDate })
      .from(invoice)
      .where(and(eq(invoice.id, id), eq(invoice.companyId, ctx.company.id)))
      .limit(1);
    if (!existing) return null;
    await assertFiscalPeriodOpen(ctx.company.id, existing.issueDate, tx);
    const [deletedRow] = await tx.delete(invoice).where(and(eq(invoice.id, id), eq(invoice.companyId, ctx.company.id))).returning({ id: invoice.id });
    return deletedRow;
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "No se pudo eliminar la factura.";
    return { error: message };
  });
  if (!deleted) return NextResponse.json({ message: "Factura no encontrada." }, { status: 404 });
  if ("error" in deleted) return NextResponse.json({ message: deleted.error }, { status: 400 });
  await recordAudit({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: actor.actorUserId, action: "invoice.delete", entityName: "invoice", entityId: id });
  return NextResponse.json({ ok: true });
}
