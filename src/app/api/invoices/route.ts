import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { customer, invoice, invoiceLine } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { canManageInvoices } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { logger } from "@/lib/logger";
import { postSalesInvoice } from "@/server/accounting/auto-post";
import { createInvoiceSchema } from "@/server/schemas/forms";

export async function POST(request: Request) {
  const session = await getUserSession();

  if (!session?.user) {
    return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  }

  const tenantContext = await ensureUserTenant({
    id: session.user.id,
    name: session.user.name,
  });

  if (!canManageInvoices(tenantContext.membership.role)) {
    return NextResponse.json(
      { message: "No tienes permisos para crear facturas en esta empresa." },
      { status: 403 },
    );
  }

  const payload = await request.json();
  const parsedPayload = createInvoiceSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return NextResponse.json({ message: parsedPayload.error.issues[0]?.message ?? "Los datos son inválidos." }, { status: 400 });
  }
  const values = parsedPayload.data;
  const customerId = values.customerId.trim();
  const number = values.number.trim();
  const notes = values.notes?.trim() || null;
  const issueDate = values.issueDate ? new Date(values.issueDate) : null;
  const dueDate = values.dueDate ? new Date(values.dueDate) : null;
  const totalAmount = Number(values.totalAmount ?? 0);

  if (!customerId || !number || !issueDate || Number.isNaN(issueDate.getTime()) || totalAmount <= 0) {
    return NextResponse.json(
      { message: "Debes informar cliente, número, fecha válida e importe mayor de 0." },
      { status: 400 },
    );
  }

  const existingCustomer = await db
    .select({ id: customer.id })
    .from(customer)
    .where(and(eq(customer.id, customerId), eq(customer.companyId, tenantContext.company.id)))
    .limit(1);

  if (existingCustomer.length === 0) {
    return NextResponse.json({ message: "Cliente no encontrado en la empresa activa." }, { status: 404 });
  }

  try {
    const createdInvoice = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(invoice)
        .values({
          companyId: tenantContext.company.id,
          customerId,
          number,
          issueDate,
          dueDate,
          totalAmount: totalAmount.toFixed(2),
          notes,
        })
        .returning({
          id: invoice.id,
          number: invoice.number,
          status: invoice.status,
        });

      if (values.lines && values.lines.length > 0) {
        await tx.insert(invoiceLine).values(
          values.lines.map((line) => ({
            invoiceId: created.id,
            description: line.description,
            quantity: line.quantity.toFixed(3),
            unitPrice: line.unitPrice.toFixed(2),
            lineTotal: (line.quantity * line.unitPrice).toFixed(2),
          })),
        );
      }

      await postSalesInvoice({
        tenantId: tenantContext.tenant.id,
        companyId: tenantContext.company.id,
        actorUserId: session.user.id,
        invoiceId: created.id,
        postedAt: issueDate,
        reference: `Factura ${created.number}`,
        subtotal: totalAmount,
        taxAmount: 0,
        totalAmount,
      });

      return created;
    });

    return NextResponse.json(createdInvoice, { status: 201 });
  } catch (error) {
    logger.error({ error }, "invoice.create_failed");
    return NextResponse.json(
      { message: "No se pudo crear la factura. Revisa si el número ya existe." },
      { status: 400 },
    );
  }
}
