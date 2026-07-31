import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { customer, invoice, invoiceLine, invoiceLineTax, paymentMethod, tax } from "@/db/schema";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { logger } from "@/lib/logger";
import { postSalesInvoice } from "@/server/accounting/auto-post";
import { createCustomerWithPartner } from "@/server/customers/service";
import { reserveSeriesNumber } from "@/server/documents/series";
import { assertFiscalPeriodOpen } from "@/server/fiscal/locks";
import { buildInvoiceLineInsertValues, buildInvoiceLineTaxInsertValues } from "@/server/invoices/line-values";
import { getInvoicePdfData } from "@/server/pdf/invoice-pdf";
import { renderInvoicePdf } from "@/server/pdf/render";
import { createInvoiceSchema } from "@/server/schemas/forms";
import { getCompanyDefaultsStatus, type CompanyDefaultsStatus } from "@/server/company/defaults";
import { getCompanyTemplate } from "@/lib/company-templates";
import { applyCompanyTemplate } from "@/server/seeds/apply";

function invoiceCreateErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return "No se pudo crear la factura.";

  if (
    error.message.includes("periodo fiscal") ||
    error.message.includes("No existe serie") ||
    error.message.includes("No se pudo reservar serie") ||
    error.message.includes("No existe la cuenta contable")
  ) {
    return error.message;
  }

  const databaseError = error as Error & { code?: string; constraint?: string };
  if (databaseError.code === "23505" || databaseError.constraint === "invoice_company_number_unique") {
    return "No se pudo crear la factura porque el número generado ya existe. Revisa la serie de facturación.";
  }

  return "No se pudo crear la factura.";
}

function companyDefaultsSetupResponse(status: CompanyDefaultsStatus) {
  return NextResponse.json(
    {
      message: "Faltan ajustes de empresa necesarios para crear facturas. Revisa Configuración > Maestros.",
      missingGroups: status.groups
        .filter((group) => group.missingCount > 0)
        .map((group) => ({
          key: group.key,
          label: group.label,
          missingCount: group.missingCount,
          missingItems: group.items.filter((item) => !item.created).map((item) => ({ key: item.key, label: item.label })),
        })),
    },
    { status: 409 },
  );
}

export async function GET(request: Request) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;

  if (!hasApiActorPermission(actor, "invoice.read")) {
    return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  }

  const rows = await db
    .select({
      id: invoice.id,
      number: invoice.number,
      customerId: invoice.customerId,
      customerName: customer.name,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      totalAmount: invoice.totalAmount,
      status: invoice.status,
      paymentStatus: invoice.paymentStatus,
      notes: invoice.notes,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
    })
    .from(invoice)
    .innerJoin(customer, eq(customer.id, invoice.customerId))
    .where(eq(invoice.companyId, actor.context.company.id))
    .orderBy(desc(invoice.createdAt));

  return NextResponse.json({ data: rows });
}

export async function POST(request: Request) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;

  if (!hasApiActorPermission(actor, "invoice.create")) {
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
  const notes = values.notes?.trim() || null;
  const selectedPaymentMethodId = values.paymentMethodId?.trim() || null;
  const issueDate = values.issueDate ? new Date(values.issueDate) : null;
  const dueDate = values.dueDate ? new Date(values.dueDate) : null;
  const [configuredPaymentMethod] = selectedPaymentMethodId
    ? await db.select({
        id: paymentMethod.id,
        name: paymentMethod.name,
        type: paymentMethod.type,
        bankAccountNumber: paymentMethod.bankAccountNumber,
      }).from(paymentMethod).where(and(
        eq(paymentMethod.id, selectedPaymentMethodId),
        eq(paymentMethod.companyId, actor.context.company.id),
      )).limit(1)
    : [];
  if (selectedPaymentMethodId && !configuredPaymentMethod) {
    return NextResponse.json({ message: "La forma de pago seleccionada no pertenece a la empresa." }, { status: 400 });
  }
  const selectedTaxIds = [...new Set(values.lines.flatMap((line) => line.taxIds ?? []))];
  const configuredTaxes = selectedTaxIds.length > 0
    ? await db.select({
        id: tax.id,
        name: tax.name,
        rate: tax.rate,
        kind: tax.kind,
        operation: tax.operation,
      }).from(tax).where(and(
        eq(tax.companyId, actor.context.company.id),
        eq(tax.isActive, true),
        inArray(tax.id, selectedTaxIds),
      ))
    : [];
  if (configuredTaxes.length !== selectedTaxIds.length) {
    return NextResponse.json({ message: "Algún impuesto seleccionado no existe o ya no está activo." }, { status: 400 });
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
  const totalAmount = invoiceTotals.totalAmount;
  const shouldCreateCustomer = !customerId && Boolean(values.newCustomer);

  if (!issueDate || Number.isNaN(issueDate.getTime()) || totalAmount <= 0) {
    return NextResponse.json(
      { message: "Debes informar una fecha válida e importe mayor de 0." },
      { status: 400 },
    );
  }

  if (shouldCreateCustomer && !hasApiActorPermission(actor, "customer.create")) {
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
      .where(and(eq(customer.id, customerId), eq(customer.companyId, actor.context.company.id)))
      .limit(1);

    if (existingCustomer.length === 0) {
      return NextResponse.json({ message: "Cliente no encontrado en la empresa activa." }, { status: 404 });
    }
  }

  try {
    let defaultsStatus = await getCompanyDefaultsStatus({
      companyId: actor.context.company.id,
      fiscalYearId: actor.context.fiscalYear.id,
      countryCode: actor.context.company.countryCode,
    });
    if (!defaultsStatus.ready && getCompanyTemplate(actor.context.company.countryCode)) {
      await applyCompanyTemplate({
        tenantId: actor.context.tenant.id,
        companyId: actor.context.company.id,
        activeFiscalYearId: actor.context.fiscalYear.id,
        countryCode: actor.context.company.countryCode,
        actorUserId: actor.actorUserId,
        auditAction: "company.defaults.ensure",
      });
      defaultsStatus = await getCompanyDefaultsStatus({
        companyId: actor.context.company.id,
        fiscalYearId: actor.context.fiscalYear.id,
        countryCode: actor.context.company.countryCode,
      });
    }
    if (!defaultsStatus.ready) {
      return companyDefaultsSetupResponse(defaultsStatus);
    }

    const createdInvoice = await db.transaction(async (tx) => {
      await assertFiscalPeriodOpen(actor.context.company.id, issueDate, tx);

      const createdCustomer = shouldCreateCustomer && values.newCustomer
        ? await createCustomerWithPartner(tx, actor.context.company.id, values.newCustomer)
        : null;
      customerId = createdCustomer?.id ?? customerId;
      const number = await reserveSeriesNumber(tx, {
        companyId: actor.context.company.id,
        fiscalYearId: actor.context.fiscalYear.id,
        type: "SALES_INVOICE",
        referenceDate: issueDate,
      });

      const [created] = await tx
        .insert(invoice)
        .values({
          companyId: actor.context.company.id,
          customerId,
          paymentMethodId: configuredPaymentMethod?.id ?? null,
          paymentMethodName: configuredPaymentMethod?.name ?? null,
          paymentMethodType: configuredPaymentMethod?.type ?? null,
          paymentBankAccountNumber: configuredPaymentMethod?.bankAccountNumber ?? null,
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

      const lineIds = calculatedLines.map(() => randomUUID());
      await tx.insert(invoiceLine).values(buildInvoiceLineInsertValues(created.id, calculatedLines, lineIds));
      const lineTaxValues = buildInvoiceLineTaxInsertValues(lineIds, calculatedLines);
      if (lineTaxValues.length > 0) await tx.insert(invoiceLineTax).values(lineTaxValues);

      await postSalesInvoice({
        tenantId: actor.context.tenant.id,
        companyId: actor.context.company.id,
        actorUserId: actor.actorUserId,
        invoiceId: created.id,
        postedAt: issueDate,
        reference: `Factura ${created.number}`,
        subtotal: invoiceTotals.subtotal,
        taxAmount: invoiceTotals.taxAmount,
        retentionAmount: invoiceTotals.retentionAmount,
        totalAmount,
        dbClient: tx,
      });

      return {
        ...created,
        customer: createdCustomer ? { id: createdCustomer.id, name: createdCustomer.name } : null,
      };
    });

    if (values.returnPdf) {
      const pdfData = await getInvoicePdfData(actor.context.company.id, createdInvoice.id);
      if (!pdfData) return NextResponse.json(createdInvoice, { status: 201 });

      const pdf = await renderInvoicePdf(pdfData.input);
      return NextResponse.json(
        {
          ...createdInvoice,
          pdfUrl: `/api/invoices/${createdInvoice.id}/pdf`,
          pdf: {
            filename: pdfData.filename,
            contentType: "application/pdf",
            encoding: "base64",
            data: Buffer.from(pdf).toString("base64"),
          },
        },
        { status: 201 },
      );
    }

    return NextResponse.json({ ...createdInvoice, pdfUrl: `/api/invoices/${createdInvoice.id}/pdf` }, { status: 201 });
  } catch (error) {
    logger.error({ error }, "invoice.create_failed");
    return NextResponse.json({ message: invoiceCreateErrorMessage(error) }, { status: 400 });
  }
}
