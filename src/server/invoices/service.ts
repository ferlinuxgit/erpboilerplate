import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";

import {
  companySettings,
  customer,
  invoice,
  invoiceLine,
  invoiceLineTax,
  invoicePayment,
  invoicePaymentMethod,
  partner,
  paymentMethod,
  tax,
} from "@/db/schema";
import { getCompanyTemplate } from "@/lib/company-templates";
import { db, type AppDbTransaction, type DbClient } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { calculateInvoiceTotals, type InvoiceCalculationTax, type InvoiceTotals } from "@/lib/invoice-totals";
import { postCreditNote, postSalesInvoice } from "@/server/accounting/auto-post";
import { recordAudit } from "@/server/audit";
import { getCompanyDefaultsStatus, type CompanyDefaultsStatus } from "@/server/company/defaults";
import { createCustomerWithPartner } from "@/server/customers/service";
import { reserveSeriesNumber } from "@/server/documents/series";
import { assertFiscalPeriodOpen } from "@/server/fiscal/locks";
import { assertItemsBelongToCompany } from "@/server/inventory/ownership";
import { computeDueDate, effectivePaymentTermsDays } from "@/server/invoices/due-dates";
import {
  customerDefaultVatTreatment,
  derivePaymentStatus,
  invoiceLifecycle,
  outstandingCents,
  provisionalDraftNumber,
  type InvoiceLifecycle,
  type RectificationReason,
  type RectificationType,
  type SalesVatTreatmentCode,
  verifactuSalesVatTreatment,
} from "@/server/invoices/lifecycle";
import { buildInvoiceLineInsertValues, buildInvoiceLineTaxInsertValues, type InvoiceLineInput } from "@/server/invoices/line-values";
import {
  getRequestedPaymentMethodIds,
  replaceInvoicePaymentMethods,
  resolveInvoicePaymentMethods,
  type InvoicePaymentMethodSnapshot,
} from "@/server/invoices/payment-methods";
import {
  ISSUED_LOCKED_FIELDS,
  type CreateCreditNoteInput,
  type CreateInvoiceInput,
  type UpdateDraftInvoiceInput,
} from "@/server/invoices/schemas";
import { loadCustomerSnapshot, loadIssuerSnapshot } from "@/server/invoices/snapshot";
import { toCents } from "@/server/accounting/money";
import { applyCompanyTemplate } from "@/server/seeds/apply";
import { registerInvoiceAnnulmentRecord, registerIssuedInvoiceRecord } from "@/server/verifactu/hooks";

/**
 * Servicio de facturas emitidas: borrador → emisión → cobros / rectificativas.
 * Ver el ciclo de vida completo en `@/server/invoices/lifecycle`.
 */

export type InvoiceActor = {
  tenantId: string;
  companyId: string;
  actorUserId: string;
  countryCode: string;
  /** Ejercicio activo (solo para comprobar la configuración mínima de la empresa). */
  activeFiscalYearId: string;
  canCreateCustomer?: boolean;
};

/** Faltan cuentas/series por defecto para poder emitir y contabilizar. */
export class CompanyDefaultsMissingError extends HttpError {
  readonly status409Payload: {
    message: string;
    missingGroups: Array<{ key: string; label: string; missingCount: number; missingItems: Array<{ key: string; label: string }> }>;
  };

  constructor(status: CompanyDefaultsStatus) {
    const message = "Faltan ajustes de empresa necesarios para emitir facturas. Revisa Configuración > Maestros.";
    super(409, message);
    this.name = "CompanyDefaultsMissingError";
    this.status409Payload = {
      message,
      missingGroups: status.groups
        .filter((group) => group.missingCount > 0)
        .map((group) => ({
          key: group.key,
          label: group.label,
          missingCount: group.missingCount,
          missingItems: group.items.filter((item) => !item.created).map((item) => ({ key: item.key, label: item.label })),
        })),
    };
  }
}

type InvoiceRow = typeof invoice.$inferSelect;
type CalculatedLine = InvoiceLineInput & { taxes?: InvoiceCalculationTax[] };

const ISSUED_EDIT_MESSAGE =
  "La factura ya está emitida: su número, cliente, fechas, líneas e importes no se pueden modificar (art. 15 RD 1619/2012). Si hay un error, crea una factura rectificativa. Solo puedes cambiar las notas y las formas de pago.";

function parseDate(value: string | null | undefined, message: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, message);
  return date;
}

function money(value: number) {
  return value.toFixed(2);
}

/** Configuración mínima (cuentas, series, impuestos) necesaria para emitir; la crea si hay plantilla. */
export async function ensureCompanyDefaults(actor: InvoiceActor) {
  const statusInput = { companyId: actor.companyId, fiscalYearId: actor.activeFiscalYearId, countryCode: actor.countryCode };
  let status = await getCompanyDefaultsStatus(statusInput);
  if (!status.ready && getCompanyTemplate(actor.countryCode)) {
    await applyCompanyTemplate({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      activeFiscalYearId: actor.activeFiscalYearId,
      countryCode: actor.countryCode,
      actorUserId: actor.actorUserId,
      auditAction: "company.defaults.ensure",
    });
    status = await getCompanyDefaultsStatus(statusInput);
  }
  if (!status.ready) throw new CompanyDefaultsMissingError(status);
}

/** Resuelve los impuestos configurados de cada línea (siempre de la empresa). */
async function resolveLineTaxes(
  client: DbClient,
  companyId: string,
  lines: Array<{ taxIds?: string[] } & Omit<CalculatedLine, "taxes">>,
  options: { requireActive: boolean },
): Promise<CalculatedLine[]> {
  const selectedTaxIds = [...new Set(lines.flatMap((line) => line.taxIds ?? []))];
  const configuredTaxes = selectedTaxIds.length > 0
    ? await client
        .select({ id: tax.id, name: tax.name, rate: tax.rate, kind: tax.kind, operation: tax.operation, isActive: tax.isActive })
        .from(tax)
        .where(and(eq(tax.companyId, companyId), inArray(tax.id, selectedTaxIds)))
    : [];
  const usable = configuredTaxes.filter((configuredTax) => !options.requireActive || configuredTax.isActive);
  if (usable.length !== selectedTaxIds.length) {
    throw new HttpError(400, "Algún impuesto seleccionado no existe o ya no está activo.");
  }
  const byId = new Map(usable.map((configuredTax) => [configuredTax.id, configuredTax]));
  return lines.map((line) => ({
    ...line,
    ...(line.taxIds !== undefined
      ? {
          taxes: [...new Set(line.taxIds)].map((taxId) => {
            const configuredTax = byId.get(taxId)!;
            return {
              id: configuredTax.id,
              name: configuredTax.name,
              rate: Number(configuredTax.rate),
              kind: configuredTax.kind,
              operation: configuredTax.operation === "SUBTRACT" ? ("SUBTRACT" as const) : ("ADD" as const),
            };
          }),
        }
      : {}),
  }));
}

/** Líneas guardadas de una factura con sus impuestos congelados (`invoice_line_tax`). */
export async function loadStoredLines(client: DbClient, invoiceId: string): Promise<CalculatedLine[]> {
  const lines = await client
    .select({
      id: invoiceLine.id,
      itemId: invoiceLine.itemId,
      description: invoiceLine.description,
      quantity: invoiceLine.quantity,
      unitPrice: invoiceLine.unitPrice,
      discountPct: invoiceLine.discountPct,
      taxRate: invoiceLine.taxRate,
      retentionRate: invoiceLine.retentionRate,
    })
    .from(invoiceLine)
    .where(eq(invoiceLine.invoiceId, invoiceId))
    .orderBy(asc(sql`ctid`));
  const taxRows = lines.length > 0
    ? await client
        .select({
          invoiceLineId: invoiceLineTax.invoiceLineId,
          taxId: invoiceLineTax.taxId,
          name: invoiceLineTax.name,
          rate: invoiceLineTax.rate,
          kind: invoiceLineTax.kind,
          operation: invoiceLineTax.operation,
        })
        .from(invoiceLineTax)
        .where(inArray(invoiceLineTax.invoiceLineId, lines.map((line) => line.id)))
    : [];
  const taxesByLine = new Map<string, InvoiceCalculationTax[]>();
  for (const row of taxRows) {
    taxesByLine.set(row.invoiceLineId, [
      ...(taxesByLine.get(row.invoiceLineId) ?? []),
      { id: row.taxId, name: row.name, rate: Number(row.rate), kind: row.kind, operation: row.operation === "SUBTRACT" ? "SUBTRACT" : "ADD" },
    ]);
  }
  return lines.map((line) => ({
    itemId: line.itemId,
    description: line.description,
    quantity: Number(line.quantity),
    unitPrice: Number(line.unitPrice),
    discountPct: Number(line.discountPct),
    taxRate: Number(line.taxRate),
    retentionRate: Number(line.retentionRate),
    // Facturas antiguas sin impuestos detallados: se usan taxRate/retentionRate de la línea.
    ...(taxesByLine.has(line.id) ? { taxes: taxesByLine.get(line.id)! } : {}),
  }));
}

async function writeLines(tx: DbClient, invoiceId: string, lines: CalculatedLine[], allowNegative: boolean) {
  const lineIds = lines.map(() => randomUUID());
  await tx.insert(invoiceLine).values(buildInvoiceLineInsertValues(invoiceId, lines, lineIds, { allowNegative }));
  const lineTaxValues = buildInvoiceLineTaxInsertValues(lineIds, lines, { allowNegative });
  if (lineTaxValues.length > 0) await tx.insert(invoiceLineTax).values(lineTaxValues);
}

function paymentMethodColumns(methods: InvoicePaymentMethodSnapshot[]) {
  const primary = methods[0] ?? null;
  return {
    paymentMethodId: primary?.id ?? null,
    paymentMethodName: primary?.name ?? null,
    paymentMethodType: primary?.type ?? null,
    paymentBankAccountNumber: primary?.bankAccountNumber ?? null,
  };
}

async function resolvePaymentMethods(companyId: string, input: { paymentMethodIds?: string[]; paymentMethodId?: string }) {
  const ids = getRequestedPaymentMethodIds(input);
  if (ids === undefined) return undefined;
  const methods = await resolveInvoicePaymentMethods(companyId, ids);
  if (!methods) throw new HttpError(400, "Alguna forma de pago seleccionada no pertenece a la empresa.");
  return methods;
}

async function lockInvoice(tx: DbClient, companyId: string, invoiceId: string) {
  const [row] = await tx
    .select()
    .from(invoice)
    .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId)))
    .for("update")
    .limit(1);
  return row ?? null;
}

async function assertActiveCustomer(client: DbClient, companyId: string, customerId: string) {
  const [owned] = await client
    .select({ id: customer.id, countryCode: partner.countryCode })
    .from(customer)
    .leftJoin(partner, eq(partner.id, customer.partnerId))
    .where(and(eq(customer.id, customerId), eq(customer.companyId, companyId), eq(customer.status, "ACTIVE")))
    .limit(1);
  if (!owned) throw new HttpError(404, "Cliente no encontrado en la empresa activa.");
  return owned;
}

/** Saldo de una factura en céntimos: total, rectificado (rectificativas emitidas), cobrado y pendiente. */
export async function getInvoiceBalance(client: DbClient, companyId: string, invoiceId: string, totalAmount: string | number) {
  const [paid] = await client
    .select({ amount: sql<string>`coalesce(sum(${invoicePayment.amountApplied}), 0)` })
    .from(invoicePayment)
    .where(and(eq(invoicePayment.companyId, companyId), eq(invoicePayment.invoiceId, invoiceId)));
  const [credited] = await client
    .select({ amount: sql<string>`coalesce(sum(${invoice.totalAmount}), 0)` })
    .from(invoice)
    .where(and(
      eq(invoice.companyId, companyId),
      eq(invoice.rectifiedInvoiceId, invoiceId),
      eq(invoice.invoiceType, "CREDIT_NOTE"),
      isNotNull(invoice.issuedAt),
      ne(invoice.status, "VOID"),
    ));
  const totalCents = toCents(totalAmount);
  const creditedCents = toCents(credited?.amount ?? 0);
  const paidCents = toCents(paid?.amount ?? 0);
  return {
    totalCents,
    creditedCents,
    paidCents,
    outstandingCents: outstandingCents({ totalCents, creditedCents, paidCents }),
    paymentStatus: derivePaymentStatus({ totalCents, creditedCents, paidCents }),
  };
}

/** Recalcula el estado de cobro de una factura emitida (tras un cobro o una rectificativa). */
export async function refreshInvoicePaymentStatus(tx: DbClient, companyId: string, invoiceId: string) {
  const [row] = await tx
    .select({ totalAmount: invoice.totalAmount, invoiceType: invoice.invoiceType })
    .from(invoice)
    .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId)))
    .limit(1);
  if (!row || row.invoiceType !== "INVOICE") return null;
  const balance = await getInvoiceBalance(tx, companyId, invoiceId, row.totalAmount);
  await tx
    .update(invoice)
    .set({ paymentStatus: balance.paymentStatus, updatedAt: new Date() })
    .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId)));
  return balance;
}

/** Reglas legales mínimas antes de emitir según el tratamiento de IVA. */
export function assertVatTreatmentConsistency(input: {
  vatTreatment: SalesVatTreatmentCode;
  customerTaxId: string | null | undefined;
  totals: InvoiceTotals;
}) {
  if (input.vatTreatment === "DOMESTIC") return;
  const chargedVat = input.totals.taxBuckets.some(
    (bucket) => bucket.operation === "ADD" && bucket.rate > 0 && ["VAT", "SURCHARGE"].includes((bucket.kind ?? "").toUpperCase()),
  );
  if (chargedVat) {
    throw new HttpError(
      422,
      "Con este tratamiento de IVA la factura no puede repercutir IVA ni recargo de equivalencia. Quita esos impuestos de las líneas o cambia el tratamiento a Nacional.",
    );
  }
  if (["INTRA_EU", "INTRA_EU_SERVICES", "REVERSE_CHARGE"].includes(input.vatTreatment) && !input.customerTaxId?.trim()) {
    throw new HttpError(422, "Para una operación intracomunitaria o con inversión del sujeto pasivo el cliente debe tener NIF / NIF-IVA en su ficha.");
  }
}

export type CustomerBillingDefaults = {
  countryCode: string;
  termsDays: number;
  vatTreatment: SalesVatTreatmentCode;
  retentionRate: number | null;
  equivalenceSurcharge: boolean;
  /** Forma de pago preferida del cliente (si tiene) o las predeterminadas de la empresa. */
  paymentMethodIds: string[];
};

/** Condiciones de facturación de un cliente: días de pago, tratamiento de IVA, retención y formas de pago. */
export async function resolveCustomerBillingDefaults(client: DbClient, companyId: string, customerId: string): Promise<CustomerBillingDefaults> {
  const [[row], [settings], defaultMethods] = await Promise.all([
    client
      .select({
        countryCode: partner.countryCode,
        paymentTermsDays: partner.paymentTermsDays,
        paymentMethodId: partner.paymentMethodId,
        defaultVatTreatment: customer.defaultVatTreatment,
        defaultRetentionRate: customer.defaultRetentionRate,
        equivalenceSurcharge: customer.equivalenceSurcharge,
      })
      .from(customer)
      .leftJoin(partner, eq(partner.id, customer.partnerId))
      .where(and(eq(customer.id, customerId), eq(customer.companyId, companyId)))
      .limit(1),
    client.select({ paymentTermsDays: companySettings.paymentTermsDays }).from(companySettings).where(eq(companySettings.companyId, companyId)).limit(1),
    client
      .select({ id: paymentMethod.id })
      .from(paymentMethod)
      .where(and(eq(paymentMethod.companyId, companyId), eq(paymentMethod.isDefault, true))),
  ]);
  const retention = row?.defaultRetentionRate === null || row?.defaultRetentionRate === undefined ? null : Number(row.defaultRetentionRate);
  return {
    countryCode: row?.countryCode ?? "ES",
    termsDays: effectivePaymentTermsDays(row?.paymentTermsDays, settings?.paymentTermsDays),
    vatTreatment: customerDefaultVatTreatment(row),
    retentionRate: retention && retention > 0 ? retention : null,
    equivalenceSurcharge: Boolean(row?.equivalenceSurcharge),
    paymentMethodIds: row?.paymentMethodId ? [row.paymentMethodId] : defaultMethods.map((method) => method.id),
  };
}

type IssueResult = { id: string; number: string; status: string; invoiceType: string; totalAmount: string };

/**
 * Emite un borrador dentro de la transacción: número definitivo de la serie del ejercicio de la
 * fecha de emisión, snapshot fiscal de emisor y cliente, asiento contable y auditoría.
 */
export async function issueInvoiceInTransaction(tx: AppDbTransaction, actor: InvoiceActor, invoiceId: string): Promise<IssueResult> {
  const row = await lockInvoice(tx, actor.companyId, invoiceId);
  if (!row) throw new HttpError(404, "Factura no encontrada.");
  const lifecycle = invoiceLifecycle(row);
  if (lifecycle === "VOID") throw new HttpError(409, "La factura está anulada y no se puede emitir.");
  if (lifecycle === "ISSUED") throw new HttpError(409, `La factura ${row.number} ya está emitida.`);

  const isCreditNote = row.invoiceType === "CREDIT_NOTE";
  await assertFiscalPeriodOpen(actor.companyId, row.issueDate, tx);

  const lines = await loadStoredLines(tx, row.id);
  if (lines.length === 0) throw new HttpError(400, "La factura necesita al menos una línea para emitirse.");
  const totals = calculateInvoiceTotals(lines, { allowNegative: isCreditNote });
  if (!isCreditNote && totals.totalAmount <= 0) throw new HttpError(400, "El importe de la factura debe ser mayor que 0.");
  if (isCreditNote && totals.totalAmount === 0) throw new HttpError(400, "La rectificativa no puede tener importe cero.");

  const [issuer, customerSnapshot] = await Promise.all([
    loadIssuerSnapshot(tx, actor.companyId),
    loadCustomerSnapshot(tx, actor.companyId, row.customerId),
  ]);
  if (!issuer || !customerSnapshot) throw new HttpError(404, "Cliente o empresa no encontrados.");
  const billing = !isCreditNote && (!row.dueDate || !row.vatTreatment)
    ? await resolveCustomerBillingDefaults(tx, actor.companyId, row.customerId)
    : null;
  const vatTreatment = (row.vatTreatment as SalesVatTreatmentCode | null) ?? billing?.vatTreatment ?? customerDefaultVatTreatment({ countryCode: customerSnapshot.countryCode });
  assertVatTreatmentConsistency({ vatTreatment, customerTaxId: customerSnapshot.taxId, totals });
  // Sin vencimiento: fecha de emisión + días de pago del cliente (o de la empresa).
  const dueDate = row.dueDate ?? (billing ? computeDueDate(row.issueDate, billing.termsDays) : null);

  let original: InvoiceRow | null = null;
  if (isCreditNote) {
    if (!row.rectifiedInvoiceId) throw new HttpError(422, "La rectificativa debe indicar la factura que rectifica.");
    original = await lockInvoice(tx, actor.companyId, row.rectifiedInvoiceId);
    if (!original || invoiceLifecycle(original) !== "ISSUED") {
      throw new HttpError(409, "La factura original debe estar emitida para poder rectificarla.");
    }
    if (totals.totalAmount < 0) {
      const balance = await getInvoiceBalance(tx, actor.companyId, original.id, original.totalAmount);
      const creditableCents = balance.totalCents + balance.creditedCents;
      if (-toCents(totals.totalAmount) > creditableCents) {
        throw new HttpError(
          409,
          `La rectificativa (${money(totals.totalAmount)}) supera el importe pendiente de rectificar de la factura ${original.number} (${money(creditableCents / 100)}).`,
        );
      }
    }
  }

  const number = await reserveSeriesNumber(tx, {
    companyId: actor.companyId,
    type: isCreditNote ? "CREDIT_NOTE" : "SALES_INVOICE",
    referenceDate: row.issueDate,
    ...(isCreditNote ? { createIfMissing: { prefix: "R-" } } : {}),
  });

  const issuedAt = new Date();
  const [issued] = await tx
    .update(invoice)
    .set({
      number,
      status: "SENT",
      // Una rectificativa no se cobra: queda aplicada contra la factura original.
      paymentStatus: isCreditNote ? "PAID" : "PENDING",
      issuedAt,
      vatTreatment,
      dueDate,
      issuerSnapshot: issuer,
      customerSnapshot,
      totalAmount: money(totals.totalAmount),
      updatedAt: issuedAt,
    })
    .where(and(eq(invoice.id, row.id), eq(invoice.companyId, actor.companyId)))
    .returning({ id: invoice.id, number: invoice.number, status: invoice.status, invoiceType: invoice.invoiceType, totalAmount: invoice.totalAmount });

  const posting = {
    tenantId: actor.tenantId,
    companyId: actor.companyId,
    actorUserId: actor.actorUserId,
    invoiceId: row.id,
    postedAt: row.issueDate,
    subtotal: totals.subtotal,
    taxAmount: totals.taxAmount,
    retentionAmount: totals.retentionAmount,
    totalAmount: totals.totalAmount,
    dbClient: tx,
  };
  if (isCreditNote && original) {
    await postCreditNote({ ...posting, reference: `Rectificativa ${number} de factura ${original.number}` });
    await refreshInvoicePaymentStatus(tx, actor.companyId, original.id);
  } else {
    await postSalesInvoice({ ...posting, reference: `Factura ${number}` });
  }

  // Registro de facturación VeriFactu (alta), encadenado dentro de esta misma transacción.
  const verifactuRecord = await registerIssuedInvoiceRecord(tx, {
    companyId: actor.companyId,
    invoiceId: row.id,
    number,
    issueDate: row.issueDate,
    invoiceType: row.invoiceType,
    rectificationReason: row.rectificationReason,
    rectificationDescription: row.rectificationDescription,
    vatTreatment: verifactuSalesVatTreatment(vatTreatment),
    issuer,
    customer: customerSnapshot,
    totals,
    lineDescriptions: lines.map((line) => line.description ?? ""),
    original: original ? { id: original.id, number: original.number, issueDate: original.issueDate } : null,
  });

  await recordAudit({
    tenantId: actor.tenantId,
    companyId: actor.companyId,
    actorUserId: actor.actorUserId,
    action: isCreditNote ? "invoice.creditNote" : "invoice.issue",
    entityName: "invoice",
    entityId: row.id,
    payload: {
      number,
      provisionalNumber: row.number,
      issueDate: row.issueDate.toISOString(),
      totalAmount: totals.totalAmount,
      vatTreatment,
      ...(verifactuRecord ? { verifactuRecordId: verifactuRecord.id, verifactuHash: verifactuRecord.hash } : {}),
      ...(original ? { rectifiedInvoiceId: original.id, rectifiedNumber: original.number, reason: row.rectificationReason, type: row.rectificationType } : {}),
    },
  }, tx);

  return issued;
}

export async function issueInvoice(actor: InvoiceActor, invoiceId: string) {
  await ensureCompanyDefaults(actor);
  return db.transaction((tx) => issueInvoiceInTransaction(tx, actor, invoiceId));
}

export type DraftInvoiceInput = {
  customerId: string;
  issueDate: Date;
  dueDate: Date | null;
  paymentMethods: InvoicePaymentMethodSnapshot[];
  lines: CalculatedLine[];
  vatTreatment: SalesVatTreatmentCode | null;
  notes?: string | null;
  source?: { salesQuoteId?: string | null; salesOrderId?: string | null; deliveryNoteId?: string | null };
  auditPayload?: Record<string, unknown>;
};

/**
 * Crea un borrador (número provisional, sin asiento) dentro de la transacción. Es el único punto de
 * alta de facturas ordinarias: formulario, API, duplicados y conversiones desde presupuesto, pedido
 * o albarán. Para emitir, llamar después a `issueInvoiceInTransaction`.
 */
export async function createDraftInvoiceInTransaction(tx: DbClient, actor: InvoiceActor, input: DraftInvoiceInput) {
  const totals = calculateInvoiceTotals(input.lines);
  if (totals.totalAmount <= 0) throw new HttpError(400, "El importe de la factura debe ser mayor que 0.");
  if (input.dueDate && input.dueDate < input.issueDate) throw new HttpError(400, "El vencimiento no puede ser anterior a la fecha de emisión.");
  const id = randomUUID();
  const [created] = await tx
    .insert(invoice)
    .values({
      id,
      companyId: actor.companyId,
      customerId: input.customerId,
      ...paymentMethodColumns(input.paymentMethods),
      number: provisionalDraftNumber(id),
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      totalAmount: money(totals.totalAmount),
      status: "DRAFT",
      vatTreatment: input.vatTreatment,
      notes: input.notes?.trim() || null,
      salesQuoteId: input.source?.salesQuoteId ?? null,
      salesOrderId: input.source?.salesOrderId ?? null,
      deliveryNoteId: input.source?.deliveryNoteId ?? null,
    })
    .returning({ id: invoice.id, number: invoice.number, status: invoice.status });
  await replaceInvoicePaymentMethods(tx, created.id, input.paymentMethods);
  await writeLines(tx, created.id, input.lines, false);
  await recordAudit({
    tenantId: actor.tenantId,
    companyId: actor.companyId,
    actorUserId: actor.actorUserId,
    action: "invoice.create",
    entityName: "invoice",
    entityId: created.id,
    payload: {
      ...input.auditPayload,
      customerId: input.customerId,
      issueDate: input.issueDate.toISOString(),
      dueDate: input.dueDate?.toISOString() ?? null,
      totalAmount: totals.totalAmount,
      lineCount: input.lines.length,
      vatTreatment: input.vatTreatment,
      ...(input.source ? { source: input.source } : {}),
    },
  }, tx);
  return created;
}

export type CreatedInvoice = {
  id: string;
  number: string;
  status: string;
  lifecycle: InvoiceLifecycle;
  customer: { id: string; name: string } | null;
};

/** Crea una factura como borrador o emitida (por defecto emitida, compatible con integraciones). */
export async function createInvoice(actor: InvoiceActor, input: CreateInvoiceInput): Promise<CreatedInvoice> {
  const mode = input.mode ?? "issue";
  const issueDate = parseDate(input.issueDate, "La fecha de emisión no es válida.");
  const dueDate = parseDate(input.dueDate, "La fecha de vencimiento no es válida.");
  if (!issueDate) throw new HttpError(400, "Debes informar una fecha válida e importe mayor de 0.");
  if (dueDate && dueDate < issueDate) throw new HttpError(400, "El vencimiento no puede ser anterior a la fecha de emisión.");

  let customerId = input.customerId?.trim() ?? "";
  const shouldCreateCustomer = !customerId && Boolean(input.newCustomer);
  if (shouldCreateCustomer && !actor.canCreateCustomer) throw new HttpError(403, "No tienes permisos para crear clientes en esta empresa.");
  if (!customerId && !input.newCustomer) throw new HttpError(400, "Debes seleccionar un cliente o crear uno nuevo.");

  await assertItemsBelongToCompany(db, actor.companyId, input.lines.map((line) => line.itemId));
  const paymentMethods = (await resolvePaymentMethods(actor.companyId, input)) ?? [];
  const lines = await resolveLineTaxes(db, actor.companyId, input.lines, { requireActive: true });
  const totals = calculateInvoiceTotals(lines);
  if (totals.totalAmount <= 0) throw new HttpError(400, "Debes informar una fecha válida e importe mayor de 0.");
  if (customerId) await assertActiveCustomer(db, actor.companyId, customerId);
  if (mode === "issue") await ensureCompanyDefaults(actor);

  return db.transaction(async (tx) => {
    // Fallar pronto (antes de crear el cliente) si el periodo no admite facturas.
    if (mode === "issue") await assertFiscalPeriodOpen(actor.companyId, issueDate, tx);
    const createdCustomer = shouldCreateCustomer && input.newCustomer
      ? await createCustomerWithPartner(tx, actor.companyId, input.newCustomer)
      : null;
    if (createdCustomer) {
      await recordAudit({
        tenantId: actor.tenantId,
        companyId: actor.companyId,
        actorUserId: actor.actorUserId,
        action: "customer.create",
        entityName: "customer",
        entityId: createdCustomer.id,
        payload: { origin: "invoice", name: createdCustomer.name },
      }, tx);
    }
    customerId = createdCustomer?.id ?? customerId;

    const created = await createDraftInvoiceInTransaction(tx, actor, {
      customerId,
      issueDate,
      dueDate,
      paymentMethods,
      lines,
      vatTreatment: input.vatTreatment ?? null,
      notes: input.notes,
      auditPayload: { mode },
    });

    const result = mode === "issue" ? await issueInvoiceInTransaction(tx, actor, created.id) : created;
    return {
      id: result.id,
      number: result.number,
      status: result.status,
      lifecycle: mode === "issue" ? "ISSUED" : "DRAFT",
      customer: createdCustomer ? { id: createdCustomer.id, name: createdCustomer.name } : null,
    };
  });
}

/**
 * Actualiza una factura.
 * - Borrador: todo editable (cliente, fechas, líneas, tratamiento IVA, formas de pago, notas).
 * - Emitida: solo notas y formas de pago; cualquier otro campo → 409 con la explicación.
 */
export async function updateInvoice(actor: InvoiceActor, invoiceId: string, input: UpdateDraftInvoiceInput) {
  if (input.status === "PAID" || input.status === "OVERDUE") {
    throw new HttpError(400, "El estado de cobro se calcula a partir de los pagos y el vencimiento.");
  }
  if (input.status === "VOID") {
    throw new HttpError(400, "Usa la acción Anular (borradores) o crea una factura rectificativa (facturas emitidas).");
  }

  const [current] = await db
    .select({ status: invoice.status, number: invoice.number, issuedAt: invoice.issuedAt })
    .from(invoice)
    .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, actor.companyId)))
    .limit(1);
  if (!current) return null;
  const lifecycle = invoiceLifecycle(current);
  if (lifecycle === "VOID") throw new HttpError(409, "La factura está anulada y no se puede modificar.");

  const paymentMethods = await resolvePaymentMethods(actor.companyId, input);

  if (lifecycle === "ISSUED") {
    const lockedFields = ISSUED_LOCKED_FIELDS.filter((field) => input[field] !== undefined);
    if (lockedFields.length > 0 || input.issue) throw new HttpError(409, ISSUED_EDIT_MESSAGE);
    return db.transaction(async (tx) => {
      const row = await lockInvoice(tx, actor.companyId, invoiceId);
      if (!row) return null;
      const [updated] = await tx
        .update(invoice)
        .set({
          ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
          ...(paymentMethods ? paymentMethodColumns(paymentMethods) : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, actor.companyId)))
        .returning();
      if (paymentMethods) await replaceInvoicePaymentMethods(tx, invoiceId, paymentMethods);
      await recordAudit({
        tenantId: actor.tenantId,
        companyId: actor.companyId,
        actorUserId: actor.actorUserId,
        action: "invoice.update",
        entityName: "invoice",
        entityId: invoiceId,
        payload: { lifecycle: "ISSUED", notes: input.notes ?? undefined, paymentMethodIds: paymentMethods?.map((method) => method.id) },
      }, tx);
      return updated;
    });
  }

  const issueDate = parseDate(input.issueDate, "La fecha de emisión no es válida.");
  const dueDate = parseDate(input.dueDate, "La fecha de vencimiento no es válida.");
  if (input.lines) await assertItemsBelongToCompany(db, actor.companyId, input.lines.map((line) => line.itemId));
  const lines = input.lines ? await resolveLineTaxes(db, actor.companyId, input.lines, { requireActive: false }) : null;
  const totals = lines ? calculateInvoiceTotals(lines) : null;
  if (totals && totals.totalAmount <= 0) throw new HttpError(400, "El importe de la factura debe ser mayor que 0.");
  const customerId = input.customerId !== undefined ? input.customerId.trim() : undefined;
  if (customerId !== undefined) {
    if (!customerId) throw new HttpError(400, "Debes seleccionar un cliente activo de la empresa.");
    await assertActiveCustomer(db, actor.companyId, customerId).catch(() => {
      throw new HttpError(400, "Debes seleccionar un cliente activo de la empresa.");
    });
  }
  if (input.issue) await ensureCompanyDefaults(actor);

  return db.transaction(async (tx) => {
    const row = await lockInvoice(tx, actor.companyId, invoiceId);
    if (!row) return null;
    if (invoiceLifecycle(row) !== "DRAFT") throw new HttpError(409, ISSUED_EDIT_MESSAGE);
    const nextIssueDate = issueDate ?? row.issueDate;
    const nextDueDate = input.dueDate !== undefined ? dueDate : row.dueDate;
    if (nextDueDate && nextDueDate < nextIssueDate) throw new HttpError(400, "El vencimiento no puede ser anterior a la fecha de emisión.");

    const [updated] = await tx
      .update(invoice)
      .set({
        ...(customerId ? { customerId } : {}),
        issueDate: nextIssueDate,
        dueDate: nextDueDate,
        ...(paymentMethods ? paymentMethodColumns(paymentMethods) : {}),
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
        ...(input.vatTreatment !== undefined ? { vatTreatment: input.vatTreatment ?? null } : {}),
        ...(totals ? { totalAmount: money(totals.totalAmount) } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, actor.companyId)))
      .returning();
    if (lines) {
      await tx.delete(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId));
      await writeLines(tx, invoiceId, lines, row.invoiceType === "CREDIT_NOTE");
    }
    if (paymentMethods) await replaceInvoicePaymentMethods(tx, invoiceId, paymentMethods);
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "invoice.update",
      entityName: "invoice",
      entityId: invoiceId,
      payload: {
        lifecycle: "DRAFT",
        customerId: customerId ?? null,
        issueDate: issueDate?.toISOString() ?? null,
        dueDate: input.dueDate !== undefined ? dueDate?.toISOString() ?? null : undefined,
        totalAmount: totals?.totalAmount,
        vatTreatment: input.vatTreatment,
      },
    }, tx);

    if (input.issue) {
      const issued = await issueInvoiceInTransaction(tx, actor, invoiceId);
      return { ...updated, ...issued };
    }
    return updated;
  });
}

/** Anula un borrador. Una factura emitida no se anula: se rectifica. */
export async function voidInvoice(actor: InvoiceActor, invoiceId: string) {
  return db.transaction(async (tx) => {
    const row = await lockInvoice(tx, actor.companyId, invoiceId);
    if (!row) return null;
    const lifecycle = invoiceLifecycle(row);
    if (lifecycle === "VOID") throw new HttpError(409, "La factura ya está anulada.");
    if (lifecycle === "ISSUED") {
      throw new HttpError(
        409,
        `La factura ${row.number} ya está emitida y no se puede anular: la ley exige conservarla. Crea una factura rectificativa (anulación total) desde la ficha de la factura.`,
      );
    }
    const [voided] = await tx
      .update(invoice)
      .set({ status: "VOID", paymentStatus: "VOID", updatedAt: new Date() })
      .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, actor.companyId)))
      .returning({ id: invoice.id });
    // Si la factura tuviera un alta VeriFactu vigente se registra su anulación (un borrador no tiene).
    await registerInvoiceAnnulmentRecord(tx, { companyId: actor.companyId, invoiceId });
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "invoice.void",
      entityName: "invoice",
      entityId: invoiceId,
      payload: { number: row.number },
    }, tx);
    return voided;
  });
}

function negateLine(line: CalculatedLine): CalculatedLine {
  return { ...line, quantity: -line.quantity };
}

/** Líneas de una rectificativa (siempre en negativo lo que se abona) según tipo y alcance. */
async function buildCreditNoteLines(tx: DbClient, originalId: string, input: CreateCreditNoteInput, extraLines: CalculatedLine[]) {
  const originalLines = await loadStoredLines(tx, originalId);
  if (input.type === "SUBSTITUTION") return [...originalLines.map(negateLine), ...extraLines];
  return input.scope === "FULL" ? originalLines.map(negateLine) : extraLines.map(negateLine);
}

/**
 * Edita un borrador de rectificativa: se reconstruye con las mismas reglas que al crearla (causa,
 * tipo, alcance, motivo, fecha y líneas) y, si se pide, se emite en la misma operación.
 */
export async function updateCreditNoteDraft(actor: InvoiceActor, creditNoteId: string, input: CreateCreditNoteInput) {
  const issueDate = parseDate(input.issueDate, "La fecha de la rectificativa no es válida.");
  const shouldIssue = input.issue === true;
  if (input.lines) await assertItemsBelongToCompany(db, actor.companyId, input.lines.map((line) => line.itemId));
  const extraLines = input.lines ? await resolveLineTaxes(db, actor.companyId, input.lines, { requireActive: false }) : [];
  if (shouldIssue) await ensureCompanyDefaults(actor);

  return db.transaction(async (tx) => {
    const row = await lockInvoice(tx, actor.companyId, creditNoteId);
    if (!row) return null;
    if (row.invoiceType !== "CREDIT_NOTE") throw new HttpError(409, "Este documento no es una rectificativa.");
    if (invoiceLifecycle(row) !== "DRAFT") throw new HttpError(409, ISSUED_EDIT_MESSAGE);
    if (!row.rectifiedInvoiceId) throw new HttpError(422, "La rectificativa debe indicar la factura que rectifica.");
    const original = await lockInvoice(tx, actor.companyId, row.rectifiedInvoiceId);
    if (!original) throw new HttpError(404, "Factura original no encontrada.");
    const nextIssueDate = issueDate ?? row.issueDate;
    if (nextIssueDate < original.issueDate) throw new HttpError(400, "La rectificativa no puede tener fecha anterior a la factura original.");

    const lines = await buildCreditNoteLines(tx, original.id, input, extraLines);
    const totals = calculateInvoiceTotals(lines, { allowNegative: true });
    if (totals.totalAmount === 0) throw new HttpError(400, "La rectificativa no puede tener importe cero.");
    const description = input.description.trim();
    await tx
      .update(invoice)
      .set({
        issueDate: nextIssueDate,
        totalAmount: money(totals.totalAmount),
        rectificationReason: input.reason as RectificationReason,
        rectificationType: input.type as RectificationType,
        rectificationDescription: description,
        notes: `Rectifica la factura ${original.number}. ${description}`,
        updatedAt: new Date(),
      })
      .where(and(eq(invoice.id, row.id), eq(invoice.companyId, actor.companyId)));
    await tx.delete(invoiceLine).where(eq(invoiceLine.invoiceId, row.id));
    await writeLines(tx, row.id, lines, true);
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "invoice.update",
      entityName: "invoice",
      entityId: row.id,
      payload: { lifecycle: "DRAFT", invoiceType: "CREDIT_NOTE", reason: input.reason, type: input.type, scope: input.scope, totalAmount: totals.totalAmount },
    }, tx);
    const result = shouldIssue ? await issueInvoiceInTransaction(tx, actor, row.id) : { id: row.id, number: row.number, status: row.status };
    return { id: result.id, number: result.number, status: result.status, totalAmount: totals.totalAmount, rectifiedInvoiceId: original.id };
  });
}

/**
 * Crea (y por defecto emite) una factura rectificativa de una factura emitida.
 * - FULL + DIFFERENCES: anula íntegramente (líneas de la original en negativo).
 * - PARTIAL + DIFFERENCES: abona solo los importes indicados (en negativo).
 * - SUBSTITUTION: anula la original y añade las líneas correctas en la misma rectificativa.
 */
export async function createCreditNote(actor: InvoiceActor, originalId: string, input: CreateCreditNoteInput) {
  const issueDate = parseDate(input.issueDate, "La fecha de la rectificativa no es válida.") ?? new Date();
  const shouldIssue = input.issue !== false;
  if (input.lines) await assertItemsBelongToCompany(db, actor.companyId, input.lines.map((line) => line.itemId));
  const extraLines = input.lines ? await resolveLineTaxes(db, actor.companyId, input.lines, { requireActive: false }) : [];
  if (shouldIssue) await ensureCompanyDefaults(actor);

  return db.transaction(async (tx) => {
    const original = await lockInvoice(tx, actor.companyId, originalId);
    if (!original) return null;
    if (original.invoiceType !== "INVOICE") throw new HttpError(409, "No se puede rectificar una factura rectificativa; rectifica la factura original.");
    if (invoiceLifecycle(original) !== "ISSUED") {
      throw new HttpError(409, "Solo se pueden rectificar facturas emitidas. Un borrador se edita directamente.");
    }
    if (issueDate < original.issueDate) throw new HttpError(400, "La rectificativa no puede tener fecha anterior a la factura original.");

    const type = input.type as RectificationType;
    const lines = await buildCreditNoteLines(tx, original.id, input, extraLines);
    const totals = calculateInvoiceTotals(lines, { allowNegative: true });
    if (totals.totalAmount === 0) throw new HttpError(400, "La rectificativa no puede tener importe cero.");

    const id = randomUUID();
    const reasonLabel = input.description.trim();
    const [created] = await tx
      .insert(invoice)
      .values({
        id,
        companyId: actor.companyId,
        customerId: original.customerId,
        number: provisionalDraftNumber(id),
        issueDate,
        dueDate: null,
        totalAmount: money(totals.totalAmount),
        status: "DRAFT",
        invoiceType: "CREDIT_NOTE",
        rectifiedInvoiceId: original.id,
        rectificationReason: input.reason as RectificationReason,
        rectificationType: type,
        rectificationDescription: reasonLabel,
        vatTreatment: original.vatTreatment,
        notes: `Rectifica la factura ${original.number}. ${reasonLabel}`,
      })
      .returning({ id: invoice.id, number: invoice.number, status: invoice.status });
    await writeLines(tx, created.id, lines, true);
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "invoice.create",
      entityName: "invoice",
      entityId: created.id,
      payload: {
        invoiceType: "CREDIT_NOTE",
        rectifiedInvoiceId: original.id,
        rectifiedNumber: original.number,
        reason: input.reason,
        type,
        scope: input.scope,
        totalAmount: totals.totalAmount,
      },
    }, tx);

    const result = shouldIssue ? await issueInvoiceInTransaction(tx, actor, created.id) : created;
    return { id: result.id, number: result.number, status: result.status, totalAmount: totals.totalAmount, rectifiedInvoiceId: original.id };
  });
}

/** Duplica una factura (emitida o borrador) como nuevo borrador con fecha de hoy. Útil para facturas recurrentes. */
export async function duplicateInvoice(actor: InvoiceActor, invoiceId: string, options: { issueDate?: Date } = {}) {
  return db.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(invoice)
      .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, actor.companyId)))
      .limit(1);
    if (!source) return null;
    if (source.invoiceType !== "INVOICE") throw new HttpError(409, "Las facturas rectificativas no se pueden duplicar.");

    const lines = await loadStoredLines(tx, source.id);
    const methods = await tx
      .select({
        id: invoicePaymentMethod.paymentMethodId,
        name: invoicePaymentMethod.name,
        type: invoicePaymentMethod.type,
        bankAccountNumber: invoicePaymentMethod.bankAccountNumber,
      })
      .from(invoicePaymentMethod)
      .where(eq(invoicePaymentMethod.invoiceId, source.id))
      .orderBy(asc(invoicePaymentMethod.position));
    const paymentMethods = methods.filter((method): method is InvoicePaymentMethodSnapshot => Boolean(method.id));

    const issueDate = options.issueDate ?? new Date();
    const termMs = source.dueDate ? source.dueDate.getTime() - source.issueDate.getTime() : null;
    const dueDate = termMs !== null && termMs >= 0 ? new Date(issueDate.getTime() + termMs) : null;
    const totals = calculateInvoiceTotals(lines);
    const id = randomUUID();
    const [created] = await tx
      .insert(invoice)
      .values({
        id,
        companyId: actor.companyId,
        customerId: source.customerId,
        ...paymentMethodColumns(paymentMethods),
        number: provisionalDraftNumber(id),
        issueDate,
        dueDate,
        totalAmount: money(totals.totalAmount),
        status: "DRAFT",
        vatTreatment: source.vatTreatment,
        notes: source.notes,
      })
      .returning({ id: invoice.id, number: invoice.number, status: invoice.status });
    await replaceInvoicePaymentMethods(tx, created.id, paymentMethods);
    await writeLines(tx, created.id, lines, false);
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "invoice.duplicate",
      entityName: "invoice",
      entityId: created.id,
      payload: { sourceInvoiceId: source.id, sourceNumber: source.number, totalAmount: totals.totalAmount },
    }, tx);
    return created;
  });
}
