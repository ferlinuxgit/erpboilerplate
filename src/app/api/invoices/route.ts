import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { customer, invoice, invoiceLine } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { canManageCustomers, canManageInvoices } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { logger } from "@/lib/logger";
import { postSalesInvoice } from "@/server/accounting/auto-post";
import { createCustomerWithPartner } from "@/server/customers/service";
import { assertFiscalPeriodOpen } from "@/server/fiscal/locks";
import { buildInvoiceLineInsertValues } from "@/server/invoices/line-values";
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

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsedPayload = createInvoiceSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return NextResponse.json({ message: parsedPayload.error.issues[0]?.message ?? "Los datos son inválidos." }, { status: 400 });
  }
  const values = parsedPayload.data;
  let customerId = values.customerId?.trim() ?? "";
  const number = values.number.trim();
  const notes = values.notes?.trim() || null;
  const issueDate = values.issueDate ? new Date(values.issueDate) : null;
  const dueDate = values.dueDate ? new Date(values.dueDate) : null;
  const invoiceTotals = calculateInvoiceTotals(values.lines);
  const totalAmount = invoiceTotals.totalAmount;
  const shouldCreateCustomer = !customerId && Boolean(values.newCustomer);

  if (!number || !issueDate || Number.isNaN(issueDate.getTime()) || totalAmount <= 0) {
    return NextResponse.json(
      { message: "Debes informar número, fecha válida e importe mayor de 0." },
      { status: 400 },
    );
  }

  if (shouldCreateCustomer && !canManageCustomers(tenantContext.membership.role)) {
    return NextResponse.json(
      { message: "No tienes permisos para crear clientes en esta empresa." },
      { status: 403 },
    );
  }

  if (!customerId && !values.newCustomer) {
    return NextResponse.json({ message: "Debes seleccionar un cliente o crear uno nuevo." }, { status: 400 });
  }

  if (customerId) {
    const existingCustomer = await db
      .select({ id: customer.id })
      .from(customer)
      .where(and(eq(customer.id, customerId), eq(customer.companyId, tenantContext.company.id)))
      .limit(1);

    if (existingCustomer.length === 0) {
      return NextResponse.json({ message: "Cliente no encontrado en la empresa activa." }, { status: 404 });
    }
  }

  try {
    const createdInvoice = await db.transaction(async (tx) => {
      await assertFiscalPeriodOpen(tenantContext.company.id, issueDate, tx);

      const createdCustomer = shouldCreateCustomer && values.newCustomer
        ? await createCustomerWithPartner(tx, tenantContext.company.id, values.newCustomer)
        : null;
      customerId = createdCustomer?.id ?? customerId;

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

      await tx.insert(invoiceLine).values(buildInvoiceLineInsertValues(created.id, values.lines));

      await postSalesInvoice({
        tenantId: tenantContext.tenant.id,
        companyId: tenantContext.company.id,
        actorUserId: session.user.id,
        invoiceId: created.id,
        postedAt: issueDate,
        reference: `Factura ${created.number}`,
        subtotal: invoiceTotals.subtotal,
        taxAmount: invoiceTotals.taxAmount,
        totalAmount,
        dbClient: tx,
      });

      return {
        ...created,
        customer: createdCustomer ? { id: createdCustomer.id, name: createdCustomer.name } : null,
      };
    });

    return NextResponse.json(createdInvoice, { status: 201 });
  } catch (error) {
    logger.error({ error }, "invoice.create_failed");
    const message = error instanceof Error && error.message.includes("periodo fiscal")
      ? error.message
      : "No se pudo crear la factura. Revisa si el número ya existe.";
    return NextResponse.json(
      { message },
      { status: 400 },
    );
  }
}
