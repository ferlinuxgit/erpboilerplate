import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { customer, invoice, invoiceLine, invoiceLineTax, invoicePayment, paymentMethod, tax } from "@/db/schema";
import { db } from "@/lib/db";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { recordAudit } from "@/server/audit";
import { postSalesInvoice, reverseAutomaticEntries } from "@/server/accounting/auto-post";
import { assertFiscalPeriodOpen } from "@/server/fiscal/locks";
import { buildInvoiceLineInsertValues, buildInvoiceLineTaxInsertValues } from "@/server/invoices/line-values";
import { updateInvoiceSchema } from "@/server/schemas/forms";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  const ctx = actor.context;
  if (!hasApiActorPermission(actor, "invoice.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

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
  if (!hasApiActorPermission(actor, "invoice.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsedPayload = updateInvoiceSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return NextResponse.json({ message: parsedPayload.error.issues[0]?.message ?? "Los datos son inválidos." }, { status: 400 });
  }
  const values = parsedPayload.data;
  const requestedIssueDate = values.issueDate ? new Date(values.issueDate) : null;
  const dueDateWasProvided = values.dueDate !== undefined;
  const requestedDueDate = values.dueDate ? new Date(values.dueDate) : null;
  if (requestedIssueDate && Number.isNaN(requestedIssueDate.getTime())) {
    return NextResponse.json({ message: "La fecha de emisión no es válida." }, { status: 400 });
  }
  if (requestedDueDate && Number.isNaN(requestedDueDate.getTime())) {
    return NextResponse.json({ message: "La fecha de vencimiento no es válida." }, { status: 400 });
  }
  if (values.status === "PAID" || values.status === "OVERDUE") {
    return NextResponse.json({ message: "El estado de cobro se calcula a partir de los pagos y el vencimiento." }, { status: 400 });
  }
  if (values.status === "VOID") {
    return NextResponse.json({ message: "Usa la acción Anular para conservar una reversión contable trazable." }, { status: 400 });
  }
  const { id } = await params;
  const customerWasProvided = values.customerId !== undefined;
  const selectedCustomerId = values.customerId?.trim() || null;
  const [configuredCustomer] = selectedCustomerId
    ? await db.select({ id: customer.id }).from(customer).where(and(
        eq(customer.id, selectedCustomerId),
        eq(customer.companyId, ctx.company.id),
        eq(customer.status, "ACTIVE"),
      )).limit(1)
    : [];
  if (customerWasProvided && !configuredCustomer) {
    return NextResponse.json({ message: "Debes seleccionar un cliente activo de la empresa." }, { status: 400 });
  }
  const paymentMethodWasProvided = values.paymentMethodId !== undefined;
  const selectedPaymentMethodId = values.paymentMethodId?.trim() || null;
  const [configuredPaymentMethod] = selectedPaymentMethodId
    ? await db.select({
        id: paymentMethod.id,
        name: paymentMethod.name,
        type: paymentMethod.type,
        bankAccountNumber: paymentMethod.bankAccountNumber,
      }).from(paymentMethod).where(and(
        eq(paymentMethod.id, selectedPaymentMethodId),
        eq(paymentMethod.companyId, ctx.company.id),
      )).limit(1)
    : [];
  if (selectedPaymentMethodId && !configuredPaymentMethod) {
    return NextResponse.json({ message: "La forma de pago seleccionada no pertenece a la empresa." }, { status: 400 });
  }
  const selectedTaxIds = [...new Set(values.lines.flatMap((line) => line.taxIds ?? []))];
  const configuredTaxes = selectedTaxIds.length > 0
    ? await db.select({ id: tax.id, name: tax.name, rate: tax.rate, kind: tax.kind, operation: tax.operation })
        .from(tax)
        .where(and(eq(tax.companyId, ctx.company.id), inArray(tax.id, selectedTaxIds)))
    : [];
  if (configuredTaxes.length !== selectedTaxIds.length) {
    return NextResponse.json({ message: "Algún impuesto seleccionado no pertenece a la empresa." }, { status: 400 });
  }
  const configuredTaxMap = new Map(configuredTaxes.map((configuredTax) => [configuredTax.id, configuredTax]));
  const calculatedLines = values.lines.map((line) => ({
    ...line,
    ...(line.taxIds !== undefined ? {
      taxes: [...new Set(line.taxIds)].map((taxId) => {
        const configuredTax = configuredTaxMap.get(taxId)!;
        return {
          id: configuredTax.id,
          name: configuredTax.name,
          rate: Number(configuredTax.rate),
          kind: configuredTax.kind,
          operation: configuredTax.operation === "SUBTRACT" ? "SUBTRACT" as const : "ADD" as const,
        };
      }),
    } : {}),
  }));
  const invoiceTotals = calculateInvoiceTotals(calculatedLines);

  try {
    const updated = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ issueDate: invoice.issueDate, number: invoice.number, paymentStatus: invoice.paymentStatus })
        .from(invoice)
        .where(and(eq(invoice.id, id), eq(invoice.companyId, ctx.company.id)))
        .for("update")
        .limit(1);
      if (!existing) return null;
      if (existing.paymentStatus !== "PENDING") throw new Error("No se puede editar una factura con cobros registrados.");
      const nextIssueDate = requestedIssueDate ?? existing.issueDate;
      if (existing.issueDate.getUTCFullYear() !== nextIssueDate.getUTCFullYear()) {
        throw new Error("No se puede mover una factura a otro año porque su número pertenece a la serie del año original.");
      }

      await assertFiscalPeriodOpen(ctx.company.id, existing.issueDate, tx);
      await assertFiscalPeriodOpen(ctx.company.id, nextIssueDate, tx);
      await reverseAutomaticEntries({
        tenantId: ctx.tenant.id,
        companyId: ctx.company.id,
        actorUserId: actor.actorUserId,
        postedAt: existing.issueDate,
        reference: `Corrección factura ${existing.number}`,
        sourceType: "invoice",
        sourceId: id,
        reason: `Reversión por edición de factura ${existing.number}`,
        dbClient: tx,
      });

      const [row] = await tx
        .update(invoice)
        .set({
          status: values.status,
          ...(customerWasProvided ? { customerId: configuredCustomer!.id } : {}),
          issueDate: nextIssueDate,
          ...(dueDateWasProvided ? { dueDate: requestedDueDate } : {}),
          ...(paymentMethodWasProvided ? {
            paymentMethodId: configuredPaymentMethod?.id ?? null,
            paymentMethodName: configuredPaymentMethod?.name ?? null,
            paymentMethodType: configuredPaymentMethod?.type ?? null,
            paymentBankAccountNumber: configuredPaymentMethod?.bankAccountNumber ?? null,
          } : {}),
          notes: values.notes?.trim() || null,
          totalAmount: invoiceTotals.totalAmount.toFixed(2),
          updatedAt: new Date(),
        })
        .where(and(eq(invoice.id, id), eq(invoice.companyId, ctx.company.id)))
        .returning();

      if (!row) return null;

      await tx.delete(invoiceLine).where(eq(invoiceLine.invoiceId, id));
      const lineIds = calculatedLines.map(() => randomUUID());
      await tx.insert(invoiceLine).values(buildInvoiceLineInsertValues(id, calculatedLines, lineIds));
      const lineTaxValues = buildInvoiceLineTaxInsertValues(lineIds, calculatedLines);
      if (lineTaxValues.length > 0) await tx.insert(invoiceLineTax).values(lineTaxValues);

      if (values.status !== "VOID") {
        await postSalesInvoice({
          tenantId: ctx.tenant.id,
          companyId: ctx.company.id,
          actorUserId: actor.actorUserId,
          invoiceId: id,
          postedAt: nextIssueDate,
          reference: `Factura ${existing.number} corregida`,
          subtotal: invoiceTotals.subtotal,
          taxAmount: invoiceTotals.taxAmount,
          retentionAmount: invoiceTotals.retentionAmount,
          totalAmount: invoiceTotals.totalAmount,
          dbClient: tx,
        });
      }

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
      payload: {
        status: values.status,
        customerId: values.customerId ?? null,
        issueDate: values.issueDate ?? null,
        dueDate: values.dueDate ?? null,
        totalAmount: invoiceTotals.totalAmount,
      },
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
  if (!hasApiActorPermission(actor, "invoice.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  const voided = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ issueDate: invoice.issueDate, number: invoice.number, paymentStatus: invoice.paymentStatus, status: invoice.status })
      .from(invoice)
      .where(and(eq(invoice.id, id), eq(invoice.companyId, ctx.company.id)))
      .for("update")
      .limit(1);
    if (!existing) return null;
    if (existing.status === "VOID" || existing.paymentStatus === "VOID") throw new Error("La factura ya está anulada.");
    if (existing.paymentStatus !== "PENDING") throw new Error("No se puede anular una factura con cobros registrados.");
    const [appliedPayment] = await tx.select({ id: invoicePayment.id }).from(invoicePayment).where(eq(invoicePayment.invoiceId, id)).limit(1);
    if (appliedPayment) throw new Error("No se puede anular una factura con cobros registrados.");
    await assertFiscalPeriodOpen(ctx.company.id, existing.issueDate, tx);
    await reverseAutomaticEntries({
      tenantId: ctx.tenant.id,
      companyId: ctx.company.id,
      actorUserId: actor.actorUserId,
      postedAt: existing.issueDate,
      reference: `Anulación factura ${existing.number}`,
      sourceType: "invoice",
      sourceId: id,
      reason: `Reversión por anulación de factura ${existing.number}`,
      dbClient: tx,
    });
    const [voidedRow] = await tx
      .update(invoice)
      .set({ status: "VOID", paymentStatus: "VOID", updatedAt: new Date() })
      .where(and(eq(invoice.id, id), eq(invoice.companyId, ctx.company.id)))
      .returning({ id: invoice.id });
    if (voidedRow) {
      await recordAudit({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: actor.actorUserId, action: "invoice.void", entityName: "invoice", entityId: id }, tx);
    }
    return voidedRow;
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "No se pudo anular la factura.";
    return { error: message };
  });
  if (!voided) return NextResponse.json({ message: "Factura no encontrada." }, { status: 404 });
  if ("error" in voided) return NextResponse.json({ message: voided.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
