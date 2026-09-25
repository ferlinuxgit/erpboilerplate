import { and, eq, gte, inArray, lt, ne, notInArray, or, sql, isNull } from "drizzle-orm";

import { alias } from "drizzle-orm/pg-core";

import { accountChart, companySettings, customer, invoice, invoiceLine, invoiceLineTax, item, journalEntry, journalLine, partner, supplierInvoice, supplierInvoiceLine } from "@/db/schema";
import { db } from "@/lib/db";
import {
  getDaysUntilDue,
  getFiscalDueStatus,
  getSpanishFiscalDueDate,
  getSpanishFiscalModel,
  normalizeTaxpayerType,
  parseSpanishFiscalPeriod,
  isIntraEuSalesTreatment,
  resolveSalesVatTreatment,
  resolveSupplierVatTreatment,
  type SpanishFiscalModelCode,
  type TaxpayerType,
  type VatBucket,
} from "@/lib/fiscal-spain";
import { centsToNumber, toCents } from "@/server/accounting/money";
import {
  bucketsToNumbers,
  buildModelo303Boxes,
  computeIssuedVat,
  computeIncomeTaxExpenseCents,
  computeModelo130,
  computeModelo303Totals,
  computeModelo349,
  computeSupplierVat,
  isServiceExpenseAccount,
  modelo349Key,
  type Modelo130QuarterInput,
  type Modelo130Result,
  type Modelo349Entry,
  type Modelo349Result,
  type SupplierLineInput,
  type FiscalSourceDocument,
  type IssuedVatResult,
  type Modelo303Box,
  type SupplierVatResult,
} from "@/server/fiscal/spain-calc";
import { isValidSpanishTaxId } from "@/lib/spanish-tax-id";
import { lineBaseCents } from "@/server/taxation/engine";
import { DRAFT_NUMBER_PREFIX } from "@/server/invoices/lifecycle";

export type { FiscalSourceDocument, Modelo130Result, Modelo303Box, Modelo349Result } from "@/server/fiscal/spain-calc";

export type SpanishFiscalSummary = {
  code: SpanishFiscalModelCode;
  modelName: string;
  periodLabel: string;
  dueDate: string | null;
  daysUntilDue: number | null;
  dueStatus: "upcoming" | "due-soon" | "overdue" | null;
  range: {
    start: string;
    endExclusive: string;
  };
  salesInvoiceCount: number;
  supplierInvoiceCount: number;
  /** Base del IVA devengado en régimen general (sin recargo ni autorepercusiones). */
  outputTaxBase: number;
  /** Casilla 27: total cuota devengada (IVA + recargo de equivalencia + autorepercusiones). */
  outputTaxAmount: number;
  domesticOutputTaxAmount: number;
  surchargeAmount: number;
  selfAssessedTaxAmount: number;
  inputTaxBase: number;
  inputTaxAmount: number;
  /** Casilla 45: IVA deducible tras % deducible por línea y prorrata. */
  deductibleInputTaxAmount: number;
  nonDeductibleInputTaxAmount: number;
  /** Casilla 46: resultado (27 − 45). */
  settlementAmount: number;
  /**
   * Importe a ingresar (o a compensar si es negativo) del modelo concreto: 303/390 → resultado del IVA;
   * 111/115 → retenciones; 130 → pago fraccionado. null en modelos informativos (347, 349).
   */
  amountDue: number | null;
  /** Retenciones practicadas del modelo (111: profesionales, 115: alquileres; resto: ambas). */
  withholdingBase: number;
  withholdingAmount: number;
  /** Retenciones que nos han practicado los clientes (473), informativo. */
  salesWithholdingAmount: number;
  buckets: VatBucket[];
  surchargeBuckets: VatBucket[];
  inputBuckets: VatBucket[];
  withholdingBuckets: VatBucket[];
  /** Modelo 349 (solo en ese modelo). */
  modelo349?: Modelo349Result;
  /** Modelo 130 (solo en ese modelo). */
  modelo130?: Modelo130Result;
  thirdPartyOperations?: Array<{
    type: "customer" | "supplier";
    taxId: string;
    name: string;
    amount: number;
  }>;
  warnings: string[];
  fiscalProfile: FiscalAutomationProfile;
  modelo303Boxes: Modelo303Box[];
  automationChecks: FiscalAutomationCheck[];
  sourceDocuments: {
    salesInvoices: FiscalSourceDocument[];
    supplierInvoices: FiscalSourceDocument[];
  };
  accountingReconciliation: {
    outputVat: ReconciliationLine;
    inputVat: ReconciliationLine;
    withholdings: ReconciliationLine;
    salesWithholdings: ReconciliationLine;
    balanced: boolean;
  };
};

export type FiscalAutomationProfile = {
  fiscalRegime: "general" | "recargo_equivalencia" | "cash_accounting" | "exempt";
  taxPeriodicity: "monthly" | "quarterly";
  siiEnabled: boolean;
  verifactuMode: "pending" | "verifactu" | "non_verifactu";
  prorrataPct: number;
  taxpayerType: TaxpayerType;
};

export type FiscalAutomationCheck = {
  code: string;
  status: "ok" | "warning" | "blocking";
  title: string;
  detail: string;
  action: string;
};

type ReconciliationLine = {
  fiscalAmount: number;
  accountingAmount: number;
  difference: number;
};

const THIRD_PARTY_THRESHOLD = 3005.06;
const STANDARD_VAT_RATES = new Set([0, 4, 5, 10, 21]);
/** Asientos que no son operaciones del periodo y no deben entrar en la conciliación de IVA. */
const NON_OPERATIONAL_SOURCES = ["fiscalYearRegularization", "fiscalYearClosing", "fiscalYearOpening"];

function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function unsupportedWarnings(code: SpanishFiscalModelCode) {
  const warnings = [
    "Borrador interno: no sustituye la presentación oficial en AEAT ni genera fichero oficial.",
  ];

  if (code === "111") {
    warnings.push("El Modelo 111 se calcula con las retenciones que practicas en facturas recibidas (salvo gastos de alquiler, cuenta 621, que van al 115).");
  }
  if (code === "115") {
    warnings.push("El Modelo 115 toma las retenciones de facturas recibidas cuyo gasto está en la cuenta 621 (arrendamientos). Revisa que los alquileres usen esa cuenta.");
  }
  if (code === "347") {
    warnings.push("El 347 excluye operaciones con retención (se declaran en 190/180) y operaciones con el extranjero (349).");
  }
  if (code === "349") {
    warnings.push("El 349 incluye facturas con tratamiento intracomunitario. Bienes o servicios: en ventas se decide por el artículo (servicio o no); las líneas sin artículo cuentan como servicios. En compras, la cuenta 62x indica servicio.");
  }
  if (code === "130") {
    warnings.push("El 130 usa las bases de facturas emitidas como ingresos y las facturas recibidas (sin bienes de inversión, más el IVA no deducible) como gastos. Añade tú amortizaciones, cuotas de autónomo y otros gastos sin factura.");
  }

  return warnings;
}

async function fetchFiscalAutomationProfile(companyId: string): Promise<FiscalAutomationProfile> {
  const [settings] = await db
    .select({
      fiscalRegime: companySettings.fiscalRegime,
      taxPeriodicity: companySettings.taxPeriodicity,
      siiEnabled: companySettings.siiEnabled,
      verifactuMode: companySettings.verifactuMode,
      prorrataPct: companySettings.prorrataPct,
      taxpayerType: companySettings.taxpayerType,
    })
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);

  return {
    fiscalRegime: normalizeFiscalRegime(settings?.fiscalRegime),
    taxPeriodicity: normalizeTaxPeriodicity(settings?.taxPeriodicity),
    siiEnabled: settings?.siiEnabled ?? false,
    verifactuMode: normalizeVerifactuMode(settings?.verifactuMode),
    prorrataPct: clampPct(toNumber(settings?.prorrataPct ?? 100)),
    taxpayerType: normalizeTaxpayerType(settings?.taxpayerType),
  };
}

function normalizeFiscalRegime(value: string | null | undefined): FiscalAutomationProfile["fiscalRegime"] {
  if (value === "recargo_equivalencia" || value === "cash_accounting" || value === "exempt") return value;
  return "general";
}

function normalizeTaxPeriodicity(value: string | null | undefined): FiscalAutomationProfile["taxPeriodicity"] {
  return value === "monthly" ? "monthly" : "quarterly";
}

function normalizeVerifactuMode(value: string | null | undefined): FiscalAutomationProfile["verifactuMode"] {
  if (value === "verifactu" || value === "non_verifactu") return value;
  return "pending";
}

function clampPct(value: number) {
  return Math.min(Math.max(value, 0), 100);
}

/**
 * Facturas emitidas que computan en un periodo: de la empresa, por fecha de expedición y sin anuladas (VOID).
 * Excluye los borradores del ciclo borrador → emisión (número provisional BORRADOR-…, sin asiento);
 * las facturas antiguas en estado DRAFT sí computan porque ya están numeradas y contabilizadas.
 * Las rectificativas emitidas computan con su signo (negativas si abonan).
 */
export function issuedInvoiceFiscalFilter(companyId: string, start: Date, endExclusive: Date) {
  return and(
    eq(invoice.companyId, companyId),
    ne(invoice.status, "VOID"),
    sql`${invoice.number} NOT LIKE ${`${DRAFT_NUMBER_PREFIX}%`}`,
    gte(invoice.issueDate, start),
    lt(invoice.issueDate, endExclusive),
  );
}

/** Facturas recibidas que computan en un periodo: sin anuladas (VOID) ni borradores. */
export function supplierInvoiceFiscalFilter(companyId: string, start: Date, endExclusive: Date) {
  return and(
    eq(supplierInvoice.companyId, companyId),
    notInArray(supplierInvoice.status, ["VOID", "DRAFT"]),
    gte(supplierInvoice.issueDate, start),
    lt(supplierInvoice.issueDate, endExclusive),
  );
}

async function fetchIssuedInvoiceVat(companyId: string, start: Date, endExclusive: Date): Promise<IssuedVatResult> {
  const lines = await db
    .select({
      lineId: invoiceLine.id,
      quantity: invoiceLine.quantity,
      unitPrice: invoiceLine.unitPrice,
      taxRate: invoiceLine.taxRate,
      discountPct: invoiceLine.discountPct,
      retentionRate: invoiceLine.retentionRate,
      invoiceId: invoice.id,
      number: invoice.number,
      issueDate: invoice.issueDate,
      totalAmount: invoice.totalAmount,
      status: invoice.status,
      vatTreatment: invoice.vatTreatment,
      countryCode: partner.countryCode,
    })
    .from(invoiceLine)
    .innerJoin(invoice, eq(invoiceLine.invoiceId, invoice.id))
    .innerJoin(customer, eq(customer.id, invoice.customerId))
    .leftJoin(partner, eq(partner.id, customer.partnerId))
    .where(issuedInvoiceFiscalFilter(companyId, start, endExclusive));
  const selectedTaxes = lines.length > 0
    ? await db.select({
        invoiceLineId: invoiceLineTax.invoiceLineId,
        rate: invoiceLineTax.rate,
        kind: invoiceLineTax.kind,
        operation: invoiceLineTax.operation,
        baseAmount: invoiceLineTax.baseAmount,
        amount: invoiceLineTax.amount,
      }).from(invoiceLineTax).where(inArray(invoiceLineTax.invoiceLineId, lines.map((line) => line.lineId)))
    : [];
  const taxesByLine = new Map<string, typeof selectedTaxes>();
  for (const selectedTax of selectedTaxes) {
    taxesByLine.set(selectedTax.invoiceLineId, [...(taxesByLine.get(selectedTax.invoiceLineId) ?? []), selectedTax]);
  }

  return computeIssuedVat(lines.map((line) => ({
    ...line,
    treatment: resolveSalesVatTreatment(line.vatTreatment, line.countryCode),
    taxes: taxesByLine.get(line.lineId) ?? null,
  })));
}

/** Líneas de facturas recibidas del periodo (sin anuladas ni borradores) con su tratamiento IVA. */
async function fetchSupplierLines(companyId: string, start: Date, endExclusive: Date): Promise<SupplierLineInput[]> {
  const lines = await db
    .select({
      subtotal: supplierInvoiceLine.subtotalAmount,
      taxAmount: supplierInvoiceLine.taxAmount,
      taxRate: supplierInvoiceLine.taxRate,
      taxDeductiblePct: supplierInvoiceLine.taxDeductiblePct,
      retentionAmount: supplierInvoiceLine.retentionAmount,
      retentionRate: supplierInvoiceLine.retentionRate,
      expenseAccountCode: accountChart.code,
      invoiceId: supplierInvoice.id,
      number: supplierInvoice.number,
      issueDate: supplierInvoice.issueDate,
      totalAmount: supplierInvoice.totalAmount,
      vatTreatment: supplierInvoice.vatTreatment,
      countryCode: partner.countryCode,
    })
    .from(supplierInvoiceLine)
    .innerJoin(supplierInvoice, eq(supplierInvoiceLine.supplierInvoiceId, supplierInvoice.id))
    .leftJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
    .leftJoin(accountChart, eq(accountChart.id, supplierInvoiceLine.expenseAccountId))
    .where(supplierInvoiceFiscalFilter(companyId, start, endExclusive));

  return lines.map((line) => ({
    ...line,
    treatment: resolveSupplierVatTreatment(line.vatTreatment, line.countryCode),
  }));
}

/** Facturas recibidas del periodo. Excluye anuladas (VOID) y borradores si los hubiera. */
async function fetchSupplierInvoiceVat(companyId: string, start: Date, endExclusive: Date, prorrataPct: number): Promise<SupplierVatResult> {
  return computeSupplierVat(await fetchSupplierLines(companyId, start, endExclusive), prorrataPct);
}

function quarterIndex(date: Date) {
  return Math.floor(date.getUTCMonth() / 3);
}

/** Etiqueta de periodo de una fecha con la misma forma (mes o trimestre) que el periodo declarado. */
function periodOf(date: Date, likePeriod: string) {
  const year = date.getUTCFullYear();
  if (/^\d{4}-\d{2}$/.test(likePeriod.trim())) return `${year}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${year}-Q${quarterIndex(date) + 1}`;
}

/**
 * Modelo 349: facturas emitidas y recibidas con tratamiento intracomunitario, agrupadas por NIF-IVA y clave.
 * Las rectificativas de facturas de otro periodo se declaran como rectificaciones de ese periodo.
 */
async function fetchModelo349(companyId: string, start: Date, endExclusive: Date, period: string): Promise<Modelo349Result> {
  const original = alias(invoice, "original_invoice");
  const salesLines = await db
    .select({
      quantity: invoiceLine.quantity,
      unitPrice: invoiceLine.unitPrice,
      discountPct: invoiceLine.discountPct,
      isService: item.isService,
      hasItem: invoiceLine.itemId,
      vatTreatment: invoice.vatTreatment,
      invoiceType: invoice.invoiceType,
      originalIssueDate: original.issueDate,
      customerName: customer.name,
      partnerName: partner.name,
      taxId: partner.taxId,
      countryCode: partner.countryCode,
    })
    .from(invoiceLine)
    .innerJoin(invoice, eq(invoiceLine.invoiceId, invoice.id))
    .innerJoin(customer, eq(customer.id, invoice.customerId))
    .leftJoin(partner, eq(partner.id, customer.partnerId))
    .leftJoin(item, eq(item.id, invoiceLine.itemId))
    .leftJoin(original, eq(original.id, invoice.rectifiedInvoiceId))
    .where(issuedInvoiceFiscalFilter(companyId, start, endExclusive));

  const entries: Modelo349Entry[] = [];
  for (const line of salesLines) {
    const treatment = resolveSalesVatTreatment(line.vatTreatment, line.countryCode);
    if (!isIntraEuSalesTreatment(treatment)) continue;
    const baseCents = lineBaseCents(
      { quantity: toNumber(line.quantity), unitPrice: toNumber(line.unitPrice), discountPct: toNumber(line.discountPct) },
      { allowNegative: true },
    );
    const originalOutside = line.invoiceType === "CREDIT_NOTE" && line.originalIssueDate
      && (line.originalIssueDate < start || line.originalIssueDate >= endExclusive);
    entries.push({
      // Servicios a empresas de la UE → clave S siempre; entregas → según el artículo (sin artículo, servicio).
      key: modelo349Key("sale", treatment === "INTRA_EU_SERVICES" || (line.hasItem ? Boolean(line.isService) : true)),
      operatorName: line.partnerName ?? line.customerName,
      operatorTaxId: line.taxId,
      countryCode: line.countryCode,
      baseCents,
      rectifiesPeriod: originalOutside && line.originalIssueDate ? periodOf(line.originalIssueDate, period) : null,
    });
  }

  const purchaseLines = await db
    .select({
      subtotal: supplierInvoiceLine.subtotalAmount,
      expenseAccountCode: accountChart.code,
      vatTreatment: supplierInvoice.vatTreatment,
      name: partner.name,
      taxId: partner.taxId,
      countryCode: partner.countryCode,
    })
    .from(supplierInvoiceLine)
    .innerJoin(supplierInvoice, eq(supplierInvoiceLine.supplierInvoiceId, supplierInvoice.id))
    .leftJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
    .leftJoin(accountChart, eq(accountChart.id, supplierInvoiceLine.expenseAccountId))
    .where(supplierInvoiceFiscalFilter(companyId, start, endExclusive));
  for (const line of purchaseLines) {
    if (resolveSupplierVatTreatment(line.vatTreatment, line.countryCode) !== "INTRA_EU") continue;
    entries.push({
      key: modelo349Key("purchase", isServiceExpenseAccount(line.expenseAccountCode)),
      operatorName: line.name ?? "Proveedor",
      operatorTaxId: line.taxId,
      countryCode: line.countryCode,
      baseCents: toCents(line.subtotal),
    });
  }
  return computeModelo349(entries);
}

/** Modelo 130: ingresos, gastos y retenciones por trimestre desde el 1 de enero hasta el trimestre declarado. */
async function fetchModelo130(companyId: string, rangeStart: Date, endExclusive: Date, prorrataPct: number): Promise<Modelo130Result> {
  const yearStart = new Date(Date.UTC(rangeStart.getUTCFullYear(), 0, 1));
  const [issued, supplierLines] = await Promise.all([
    fetchIssuedInvoiceVat(companyId, yearStart, endExclusive),
    fetchSupplierLines(companyId, yearStart, endExclusive),
  ]);
  const quarters: Modelo130QuarterInput[] = [0, 1, 2, 3].map(() => ({ incomeCents: 0, expenseCents: 0, withholdingCents: 0, withheldIncomeCents: 0 }));
  for (const document of issued.documents) {
    const quarter = quarters[quarterIndex(new Date(document.issueDate))];
    const baseCents = toCents(document.taxBase);
    quarter.incomeCents += baseCents;
    const withholdingCents = toCents(document.withholdingAmount ?? 0);
    quarter.withholdingCents += withholdingCents;
    if (withholdingCents !== 0) quarter.withheldIncomeCents = (quarter.withheldIncomeCents ?? 0) + baseCents;
  }
  for (let index = 0; index < 4; index += 1) {
    quarters[index].expenseCents = computeIncomeTaxExpenseCents(
      supplierLines.filter((line) => quarterIndex(line.issueDate) === index),
      prorrataPct,
    );
  }
  return computeModelo130(quarters, quarterIndex(new Date(endExclusive.getTime() - 1)) + 1);
}

/** Clientes españoles (> 3.005,06 €/año): sin anuladas, sin facturas con retención (van al 190). */
async function fetchThirdPartyOperations(companyId: string, start: Date, endExclusive: Date) {
  const withholdingLine = sql`exists (select 1 from ${invoiceLine} il where il."invoiceId" = ${invoice.id} and il."retentionRate" > 0)`;
  const withholdingTax = sql`exists (select 1 from ${invoiceLineTax} ilt inner join ${invoiceLine} il2 on il2.id = ilt."invoiceLineId" where il2."invoiceId" = ${invoice.id} and ilt.operation = 'SUBTRACT')`;
  const rows = await db
    .select({
      taxId: partner.taxId,
      partnerName: partner.name,
      customerName: customer.name,
      amount: sql<string>`sum(${invoice.totalAmount})`,
    })
    .from(invoice)
    .innerJoin(customer, eq(customer.id, invoice.customerId))
    .leftJoin(partner, eq(partner.id, customer.partnerId))
    .where(and(
      issuedInvoiceFiscalFilter(companyId, start, endExclusive),
      or(isNull(partner.countryCode), eq(partner.countryCode, "ES")),
      sql`not ${withholdingLine}`,
      sql`not ${withholdingTax}`,
    ))
    .groupBy(partner.taxId, partner.name, customer.name);

  return rows
    .map((row) => ({
      type: "customer" as const,
      taxId: row.taxId?.trim() || "Sin NIF",
      name: row.partnerName ?? row.customerName,
      amount: centsToNumber(toCents(row.amount)),
    }))
    .filter((row) => row.amount >= THIRD_PARTY_THRESHOLD)
    .sort((left, right) => right.amount - left.amount);
}

/** Proveedores españoles (> 3.005,06 €/año): sin anuladas ni facturas con retención. */
async function fetchSupplierThirdPartyOperations(companyId: string, start: Date, endExclusive: Date) {
  const rows = await db
    .select({
      taxId: partner.taxId,
      name: partner.name,
      amount: sql<string>`sum(${supplierInvoice.totalAmount})`,
    })
    .from(supplierInvoice)
    .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
    .where(and(
      supplierInvoiceFiscalFilter(companyId, start, endExclusive),
      eq(partner.countryCode, "ES"),
      sql`${supplierInvoice.retentionAmount} = 0`,
    ))
    .groupBy(partner.taxId, partner.name);

  return rows
    .map((row) => ({
      type: "supplier" as const,
      taxId: row.taxId?.trim() || "Sin NIF",
      name: row.name,
      amount: centsToNumber(toCents(row.amount)),
    }))
    .filter((row) => row.amount >= THIRD_PARTY_THRESHOLD)
    .sort((left, right) => right.amount - left.amount);
}

/** Saldos del periodo de 477, 472, 4751 y 473 (incluye subcuentas), sin asientos de cierre/apertura. */
async function fetchAccountingTaxBalances(companyId: string, start: Date, endExclusive: Date) {
  const group = sql<string>`case
    when ${accountChart.code} like '477%' then '477'
    when ${accountChart.code} like '472%' then '472'
    when ${accountChart.code} like '4751%' then '4751'
    when ${accountChart.code} like '473%' then '473'
  end`;
  const rows = await db
    .select({
      group,
      debit: sql<string>`coalesce(sum(${journalLine.debit}), '0')`,
      credit: sql<string>`coalesce(sum(${journalLine.credit}), '0')`,
    })
    .from(journalLine)
    .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
    .innerJoin(accountChart, eq(accountChart.id, journalLine.accountId))
    .where(
      and(
        eq(journalEntry.companyId, companyId),
        gte(journalEntry.postedAt, start),
        lt(journalEntry.postedAt, endExclusive),
        or(isNull(journalEntry.sourceType), notInArray(journalEntry.sourceType, NON_OPERATIONAL_SOURCES)),
        sql`(${accountChart.code} like '477%' or ${accountChart.code} like '472%' or ${accountChart.code} like '4751%' or ${accountChart.code} like '473%')`,
      ),
    )
    .groupBy(group);

  const balances = new Map(rows.map((row) => [row.group, { debit: toCents(row.debit), credit: toCents(row.credit) }]));
  const net = (code: string, side: "debit" | "credit") => {
    const entry = balances.get(code);
    if (!entry) return 0;
    return centsToNumber(side === "debit" ? entry.debit - entry.credit : entry.credit - entry.debit);
  };

  return {
    outputVat: net("477", "credit"),
    inputVat: net("472", "debit"),
    withholdings: net("4751", "credit"),
    salesWithholdings: net("473", "debit"),
  };
}

function reconcile(fiscalAmount: number, accountingAmount: number): ReconciliationLine {
  return {
    fiscalAmount,
    accountingAmount,
    difference: centsToNumber(toCents(fiscalAmount) - toCents(accountingAmount)),
  };
}

function buildAutomationChecks({
  accountingBalanced,
  code,
  dueStatus,
  issued,
  modelo303Boxes,
  profile,
  supplier,
  thirdPartyOperations,
  vatRates,
  modelo130,
  modelo349,
}: {
  modelo130?: Modelo130Result;
  modelo349?: Modelo349Result;
  accountingBalanced: boolean;
  code: SpanishFiscalModelCode;
  dueStatus: SpanishFiscalSummary["dueStatus"];
  issued: IssuedVatResult;
  modelo303Boxes: Modelo303Box[];
  profile: FiscalAutomationProfile;
  supplier: SupplierVatResult;
  thirdPartyOperations?: SpanishFiscalSummary["thirdPartyOperations"];
  vatRates: number[];
}): FiscalAutomationCheck[] {
  const checks: FiscalAutomationCheck[] = [
    {
      code: "accounting-reconciliation",
      status: accountingBalanced ? "ok" : "blocking",
      title: "Conciliación fiscal-contable",
      detail: accountingBalanced
        ? "Las cuentas 477, 472, 4751 y 473 cuadran con el cálculo del periodo."
        : "Hay diferencias entre el cálculo fiscal y las cuentas 477, 472, 4751 o 473.",
      action: accountingBalanced ? "Listo para cierre operativo." : "Revisa asientos manuales en esas cuentas y documentos con fechas fuera de periodo antes de presentar.",
    },
    {
      code: "verifactu-profile",
      status: profile.verifactuMode === "pending" ? "warning" : "ok",
      title: "Modo VERI*FACTU",
      detail: profile.verifactuMode === "pending"
        ? "La empresa todavía no tiene definido el modo de cumplimiento VERI*FACTU."
        : `Modo configurado: ${profile.verifactuMode === "verifactu" ? "VERI*FACTU" : "NO VERI*FACTU"}.`,
      action: profile.verifactuMode === "pending" ? "Configura el modo antes de emitir facturas en producción." : "Mantén evidencias y registros de facturación encadenados.",
    },
    {
      code: "sii-profile",
      status: profile.siiEnabled ? "warning" : "ok",
      title: "SII",
      detail: profile.siiEnabled
        ? "La empresa está marcada como SII, pero el envío automático a AEAT no está activado en este MVP."
        : "La empresa no está marcada como SII.",
      action: profile.siiEnabled ? "Activa integración web service AEAT antes de depender del cierre automático." : "Sin acción si no hay obligación SII.",
    },
  ];

  if (profile.prorrataPct < 100) {
    checks.push({
      code: "prorrata",
      status: "warning",
      title: `Prorrata del ${profile.prorrataPct}%`,
      detail: "El IVA deducible se ha limitado con la prorrata provisional; la parte no deducible se contabiliza como mayor gasto.",
      action: "En el último periodo del año calcula la prorrata definitiva y regulariza en la casilla 44.",
    });
  }
  if (profile.fiscalRegime === "cash_accounting") {
    checks.push({
      code: "cash-accounting",
      status: "warning",
      title: "Criterio de caja",
      detail: "El cálculo usa la fecha de factura, no la de cobro o pago.",
      action: "Ajusta el IVA de facturas no cobradas/pagadas antes de presentar.",
    });
  }
  if (profile.fiscalRegime === "recargo_equivalencia") {
    checks.push({
      code: "own-surcharge-regime",
      status: "warning",
      title: "Empresa en recargo de equivalencia",
      detail: "Los comerciantes minoristas en recargo de equivalencia no presentan 303 por esa actividad.",
      action: "Confirma si debes presentar el modelo.",
    });
  }
  if (issued.draftInvoiceCount > 0) {
    checks.push({
      code: "draft-invoices",
      status: "warning",
      title: "Facturas en borrador incluidas",
      detail: `${issued.draftInvoiceCount} factura(s) en borrador ya están numeradas y contabilizadas, así que se incluyen.`,
      action: "Emite o anula esas facturas antes de presentar.",
    });
  }
  if (issued.otherTaxCents !== 0) {
    checks.push({
      code: "other-taxes",
      status: "warning",
      title: "Impuestos de tipo \"Otro\" en ventas",
      detail: `${centsToNumber(issued.otherTaxCents)} € de impuestos sin clasificar como IVA o recargo se han contabilizado en 477.`,
      action: "Clasifica esos impuestos o corrige las facturas.",
    });
  }
  if (supplier.defaultRateLines > 0) {
    checks.push({
      code: "self-assessed-default-rate",
      status: "warning",
      title: "Autorepercusión al 21% por defecto",
      detail: `${supplier.defaultRateLines} línea(s) de compras intracomunitarias o con inversión del sujeto pasivo no indicaban tipo y se han autorepercutido al 21%.`,
      action: "Si el tipo aplicable es otro (4% o 10%), indícalo en la línea de la factura.",
    });
  }
  if (supplier.invoicesWithChargedSelfAssessedVat > 0) {
    checks.push({
      code: "self-assessed-total",
      status: "warning",
      title: "Facturas con autorepercusión y total incorrecto",
      detail: `${supplier.invoicesWithChargedSelfAssessedVat} factura(s) intracomunitarias o con inversión del sujeto pasivo tienen un total a pagar distinto de base − retención (probablemente incluyen el IVA, que el proveedor no cobra).`,
      action: "Corrige el total de esas facturas: debe ser la base menos la retención.",
    });
  }

  if (dueStatus === "due-soon" || dueStatus === "overdue") {
    checks.push({
      code: "deadline",
      status: dueStatus === "overdue" ? "blocking" : "warning",
      title: "Vencimiento fiscal",
      detail: dueStatus === "overdue" ? "El periodo figura vencido." : "El periodo vence en los próximos 7 días.",
      action: "Completa validaciones y cierra el periodo fiscal.",
    });
  }

  const invalidVatRates = [...new Set(vatRates.filter((rate) => !STANDARD_VAT_RATES.has(rate)))];
  if (invalidVatRates.length > 0) {
    checks.push({
      code: "vat-rates",
      status: "warning",
      title: "Tipos de IVA no estándar",
      detail: `Se detectaron tipos ${invalidVatRates.join(", ")}%.`,
      action: "Clasifica si son operaciones exentas, no sujetas o casos especiales antes de presentar.",
    });
  }

  const missingTaxId347 = thirdPartyOperations?.filter((operation) => operation.taxId === "Sin NIF") ?? [];
  const invalidTaxId347 = thirdPartyOperations?.filter((operation) => operation.taxId !== "Sin NIF" && !isValidSpanishTaxId(operation.taxId)) ?? [];
  if (missingTaxId347.length > 0) {
    checks.push({
      code: "model-347-tax-id",
      status: "blocking",
      title: "Modelo 347 con terceros sin NIF",
      detail: `${missingTaxId347.length} tercero(s) superan ${THIRD_PARTY_THRESHOLD} EUR sin NIF informado.`,
      action: "Completa datos fiscales del tercero antes de cerrar el 347.",
    });
  }
  if (invalidTaxId347.length > 0) {
    checks.push({
      code: "model-347-tax-id-format",
      status: "blocking",
      title: "Modelo 347 con NIF/CIF inválido",
      detail: `${invalidTaxId347.length} tercero(s) superan ${THIRD_PARTY_THRESHOLD} EUR con identificador fiscal inválido.`,
      action: "Corrige NIF, NIE o CIF antes de cerrar el 347.",
    });
  }

  if (code === "130" && profile.taxpayerType !== "individual") {
    checks.push({
      code: "model-130-taxpayer",
      status: "blocking",
      title: "El 130 es solo para autónomos",
      detail: "La empresa está configurada como sociedad. Las sociedades hacen pagos fraccionados del Impuesto sobre Sociedades (modelo 202), no el 130.",
      action: "Si eres autónomo, cambia el tipo de contribuyente en Fiscalidad › Configuración.",
    });
  }
  if (code === "130" && modelo130 && modelo130.withheldIncomePct >= 70) {
    checks.push({
      code: "model-130-withholding-rule",
      status: "warning",
      title: `El ${modelo130.withheldIncomePct} % de tus ingresos lleva retención`,
      detail: "Si en el año anterior al menos el 70 % de tus ingresos profesionales tuvo retención, no estás obligado a presentar el 130.",
      action: "Confírmalo con los datos del año anterior antes de presentar.",
    });
  }
  for (const issue of modelo349?.issues ?? []) {
    checks.push({ code: issue.code, status: "warning", title: "Modelo 349: revisar operadores", detail: issue.message, action: "Completa el NIF-IVA del cliente o proveedor en su ficha." });
  }

  if (code === "303" && modelo303Boxes.every((box) => box.amount === 0)) {
    checks.push({
      code: "model-303-empty",
      status: "warning",
      title: "Modelo 303 sin importes",
      detail: "El borrador 303 no tiene IVA devengado ni deducible.",
      action: "Confirma que no faltan facturas emitidas o recibidas en el periodo.",
    });
  }

  return checks;
}

function mergeBuckets(...maps: Array<Map<number, { rate: number; base: number; tax: number }>>) {
  const merged = new Map<number, { rate: number; base: number; tax: number }>();
  for (const map of maps) {
    for (const bucket of map.values()) {
      const target = merged.get(bucket.rate) ?? { rate: bucket.rate, base: 0, tax: 0 };
      target.base += bucket.base;
      target.tax += bucket.tax;
      merged.set(bucket.rate, target);
    }
  }
  return merged;
}

export async function calculateSpanishFiscalSummary(companyId: string, code: SpanishFiscalModelCode, period: string): Promise<SpanishFiscalSummary> {
  const model = getSpanishFiscalModel(code);
  const range = parseSpanishFiscalPeriod(period, code);

  if (!model || !range) {
    throw new Error("Modelo o periodo fiscal español no soportado.");
  }

  const profile = await fetchFiscalAutomationProfile(companyId);
  const [issued, supplier, accountingBalances] = await Promise.all([
    fetchIssuedInvoiceVat(companyId, range.start, range.endExclusive),
    fetchSupplierInvoiceVat(companyId, range.start, range.endExclusive, profile.prorrataPct),
    fetchAccountingTaxBalances(companyId, range.start, range.endExclusive),
  ]);
  const totals = computeModelo303Totals(issued, supplier);
  const modelo303Boxes = buildModelo303Boxes(issued, supplier, { periodYear: range.start.getUTCFullYear() });
  const dueDate = getSpanishFiscalDueDate(period, code);
  const thirdPartyOperations =
    code === "347"
      ? [
          ...(await fetchThirdPartyOperations(companyId, range.start, range.endExclusive)),
          ...(await fetchSupplierThirdPartyOperations(companyId, range.start, range.endExclusive)),
        ].sort((left, right) => right.amount - left.amount)
      : undefined;

  const modelo349 = code === "349" ? await fetchModelo349(companyId, range.start, range.endExclusive, period) : undefined;
  const modelo130 = code === "130" ? await fetchModelo130(companyId, range.start, range.endExclusive, profile.prorrataPct) : undefined;

  const practicedWithholdings = code === "111" ? supplier.professional : code === "115" ? supplier.rent : mergeBuckets(supplier.professional, supplier.rent);
  const allPracticed = mergeBuckets(supplier.professional, supplier.rent);
  const sum = (map: Map<number, { base: number; tax: number }>) => [...map.values()].reduce((acc, bucket) => ({ base: acc.base + bucket.base, tax: acc.tax + bucket.tax }), { base: 0, tax: 0 });
  const practicedTotals = sum(practicedWithholdings);
  const allPracticedTotals = sum(allPracticed);
  const salesWithholdingTotals = sum(issued.withholdings);
  const outputVatTotals = sum(issued.vat);
  const inputTotals = sum(supplier.input);

  const outputVatReconciliation = reconcile(centsToNumber(totals.accruedCents), accountingBalances.outputVat);
  const inputVatReconciliation = reconcile(centsToNumber(totals.deductibleCents), accountingBalances.inputVat);
  const withholdingReconciliation = reconcile(centsToNumber(allPracticedTotals.tax), accountingBalances.withholdings);
  const salesWithholdingReconciliation = reconcile(centsToNumber(salesWithholdingTotals.tax), accountingBalances.salesWithholdings);
  const accountingBalanced = [outputVatReconciliation, inputVatReconciliation, withholdingReconciliation, salesWithholdingReconciliation]
    .every((line) => Math.abs(line.difference) < 0.005);
  const dueStatus = dueDate ? getFiscalDueStatus(dueDate) : null;
  const buckets = bucketsToNumbers(issued.vat);
  const inputBuckets = bucketsToNumbers(supplier.input);

  return {
    code,
    modelName: model.name,
    periodLabel: range.label,
    dueDate: dueDate?.toISOString() ?? null,
    daysUntilDue: dueDate ? getDaysUntilDue(dueDate) : null,
    dueStatus,
    range: {
      start: range.start.toISOString(),
      endExclusive: range.endExclusive.toISOString(),
    },
    salesInvoiceCount: issued.invoiceIds.size,
    supplierInvoiceCount: supplier.invoiceIds.size,
    outputTaxBase: centsToNumber(outputVatTotals.base),
    outputTaxAmount: centsToNumber(totals.accruedCents),
    domesticOutputTaxAmount: centsToNumber(totals.domesticOutputCents),
    surchargeAmount: centsToNumber(totals.surchargeCents),
    selfAssessedTaxAmount: centsToNumber(totals.selfAssessedCents),
    inputTaxBase: centsToNumber(inputTotals.base),
    inputTaxAmount: centsToNumber(inputTotals.tax),
    deductibleInputTaxAmount: centsToNumber(totals.deductibleCents),
    nonDeductibleInputTaxAmount: centsToNumber(inputTotals.tax - totals.deductibleCents),
    settlementAmount: centsToNumber(totals.resultCents),
    amountDue: code === "303" || code === "390"
      ? centsToNumber(totals.resultCents)
      : code === "111" || code === "115"
        ? centsToNumber(practicedTotals.tax)
        : code === "130" && modelo130
          ? centsToNumber(modelo130.resultCents)
          : null,
    modelo349,
    modelo130,
    withholdingBase: centsToNumber(practicedTotals.base),
    withholdingAmount: centsToNumber(practicedTotals.tax),
    salesWithholdingAmount: centsToNumber(salesWithholdingTotals.tax),
    buckets,
    surchargeBuckets: bucketsToNumbers(issued.surcharge),
    inputBuckets,
    withholdingBuckets: bucketsToNumbers(practicedWithholdings),
    thirdPartyOperations,
    warnings: unsupportedWarnings(code),
    fiscalProfile: profile,
    modelo303Boxes,
    automationChecks: buildAutomationChecks({
      accountingBalanced,
      code,
      dueStatus,
      issued,
      modelo303Boxes,
      profile,
      supplier,
      thirdPartyOperations,
      vatRates: [...buckets, ...inputBuckets].map((bucket) => bucket.rate),
      modelo130,
      modelo349,
    }),
    sourceDocuments: {
      salesInvoices: issued.documents,
      supplierInvoices: supplier.documents,
    },
    accountingReconciliation: {
      outputVat: outputVatReconciliation,
      inputVat: inputVatReconciliation,
      withholdings: withholdingReconciliation,
      salesWithholdings: salesWithholdingReconciliation,
      balanced: accountingBalanced,
    },
  };
}

export type VatRegisterRow = {
  id: string;
  issueDate: string;
  number: string;
  /** Número de factura del proveedor (solo recibidas). */
  supplierNumber: string | null;
  counterpartyName: string;
  counterpartyTaxId: string | null;
  vatTreatment: string | null;
  taxBase: number;
  taxAmount: number;
  withholdingAmount: number;
  totalAmount: number;
};

/**
 * Libros registro de IVA (facturas expedidas y recibidas) del periodo, con los mismos filtros y
 * los mismos importes que el modelo 303 (sin anuladas ni borradores del ciclo de emisión).
 */
export async function loadVatRegisters(companyId: string, start: Date, endExclusive: Date): Promise<{ issued: VatRegisterRow[]; received: VatRegisterRow[] }> {
  const profile = await fetchFiscalAutomationProfile(companyId);
  const [issued, supplier] = await Promise.all([
    fetchIssuedInvoiceVat(companyId, start, endExclusive),
    fetchSupplierInvoiceVat(companyId, start, endExclusive, profile.prorrataPct),
  ]);
  const issuedIds = issued.documents.map((document) => document.id);
  const receivedIds = supplier.documents.map((document) => document.id);
  const [customers, suppliers] = await Promise.all([
    issuedIds.length
      ? db
          .select({ id: invoice.id, name: sql<string>`coalesce(${partner.name}, ${customer.name})`, taxId: partner.taxId })
          .from(invoice)
          .innerJoin(customer, eq(customer.id, invoice.customerId))
          .leftJoin(partner, eq(partner.id, customer.partnerId))
          .where(and(eq(invoice.companyId, companyId), inArray(invoice.id, issuedIds)))
      : Promise.resolve([]),
    receivedIds.length
      ? db
          .select({ id: supplierInvoice.id, name: partner.name, taxId: partner.taxId, supplierNumber: supplierInvoice.supplierDocumentNumber })
          .from(supplierInvoice)
          .leftJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
          .where(and(eq(supplierInvoice.companyId, companyId), inArray(supplierInvoice.id, receivedIds)))
      : Promise.resolve([]),
  ]);
  const customerById = new Map(customers.map((row) => [row.id, row]));
  const supplierById = new Map(suppliers.map((row) => [row.id, row]));
  const byDate = (left: VatRegisterRow, right: VatRegisterRow) => left.issueDate.localeCompare(right.issueDate) || left.number.localeCompare(right.number);

  return {
    issued: issued.documents.map((document) => ({
      id: document.id,
      issueDate: document.issueDate,
      number: document.number,
      supplierNumber: null,
      counterpartyName: customerById.get(document.id)?.name ?? "",
      counterpartyTaxId: customerById.get(document.id)?.taxId ?? null,
      vatTreatment: document.vatTreatment ?? null,
      taxBase: document.taxBase,
      taxAmount: document.taxAmount,
      withholdingAmount: document.withholdingAmount ?? 0,
      totalAmount: document.totalAmount,
    })).sort(byDate),
    received: supplier.documents.map((document) => ({
      id: document.id,
      issueDate: document.issueDate,
      number: document.number,
      supplierNumber: supplierById.get(document.id)?.supplierNumber ?? null,
      counterpartyName: supplierById.get(document.id)?.name ?? "",
      counterpartyTaxId: supplierById.get(document.id)?.taxId ?? null,
      vatTreatment: document.vatTreatment ?? null,
      taxBase: document.taxBase,
      taxAmount: document.taxAmount,
      withholdingAmount: document.withholdingAmount ?? 0,
      totalAmount: document.totalAmount,
    })).sort(byDate),
  };
}
