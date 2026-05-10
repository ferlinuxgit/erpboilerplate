import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { invoice, invoiceLine } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { recordAudit } from "@/server/audit";
import { buildInvoiceLineInsertValues } from "@/server/invoices/line-values";
import { updateInvoiceSchema } from "@/server/schemas/forms";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
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
      taxRate: invoiceLine.taxRate,
      lineTotal: invoiceLine.lineTotal,
    })
    .from(invoiceLine)
    .where(eq(invoiceLine.invoiceId, row.id));

  return NextResponse.json({ ...row, lines });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "invoice.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const payload = await request.json();
  const parsedPayload = updateInvoiceSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return NextResponse.json({ message: parsedPayload.error.issues[0]?.message ?? "Los datos son inválidos." }, { status: 400 });
  }
  const values = parsedPayload.data;
  const { id } = await params;
  const invoiceTotals = calculateInvoiceTotals(values.lines);

  const updated = await db.transaction(async (tx) => {
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
    actorUserId: session.user.id,
    action: "invoice.update",
    entityName: "invoice",
    entityId: id,
    payload: { number: values.number, status: values.status, totalAmount: invoiceTotals.totalAmount },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "invoice.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  const [deleted] = await db.delete(invoice).where(and(eq(invoice.id, id), eq(invoice.companyId, ctx.company.id))).returning({ id: invoice.id });
  if (!deleted) return NextResponse.json({ message: "Factura no encontrada." }, { status: 404 });
  await recordAudit({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: session.user.id, action: "invoice.delete", entityName: "invoice", entityId: id });
  return NextResponse.json({ ok: true });
}
