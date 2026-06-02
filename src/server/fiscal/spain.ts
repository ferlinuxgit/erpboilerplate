import { and, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";

import { accountChart, companySettings, customer, invoice, invoiceLine, journalEntry, journalLine, partner, supplierInvoice, supplierInvoiceLine } from "@/db/schema";
import { db } from "@/lib/db";
import {
  aggregateOutputVat,
  aggregateWithholdings,
  getDaysUntilDue,
  getFiscalDueStatus,
  getSpanishFiscalDueDate,
  getSpanishFiscalModel,
  parseSpanishFiscalPeriod,
  roundFiscalMoney,
  type VatBucket,
  type SpanishFiscalModelCode,
} from "@/lib/fiscal-spain";
import { isValidSpanishTaxId } from "@/lib/spanish-tax-id";

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
  outputTaxBase: number;
  outputTaxAmount: number;
  inputTaxBase: number;
  inputTaxAmount: number;
  deductibleInputTaxAmount: number;
  nonDeductibleInputTaxAmount: number;
  settlementAmount: number;
  withholdingBase: number;
  withholdingAmount: number;
  buckets: VatBucket[];
  inputBuckets: VatBucket[];
  withholdingBuckets: VatBucket[];
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
    balanced: boolean;
  };
};

export type FiscalAutomationProfile = {
  fiscalRegime: "general" | "recargo_equivalencia" | "cash_accounting" | "exempt";
  taxPeriodicity: "monthly" | "quarterly";
  siiEnabled: boolean;
  verifactuMode: "pending" | "verifactu" | "non_verifactu";
  prorrataPct: number;
};

export type Modelo303Box = {
  box: string;
  label: string;
  amount: number;
  kind: "base" | "tax" | "settlement";
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

export type FiscalSourceDocument = {
  id: string;
  number: string;
  issueDate: string;
  totalAmount: number;
  taxBase: number;
  taxAmount: number;
  withholdingAmount?: number;
};

const THIRD_PARTY_THRESHOLD = 3005.06;
const STANDARD_VAT_RATES = new Set([0, 4, 10, 21]);

function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function totalsFromBuckets(buckets: VatBucket[]) {
  return {
    outputTaxBase: roundFiscalMoney(buckets.reduce((total, bucket) => total + bucket.base, 0)),
    outputTaxAmount: roundFiscalMoney(buckets.reduce((total, bucket) => total + bucket.tax, 0)),
  };
}

function unsupportedWarnings(code: SpanishFiscalModelCode) {
  const warnings = [
    "Borrador interno: no sustituye la presentación oficial en AEAT ni genera fichero oficial.",
  ];

  if (code === "111") {
    warnings.push("El Modelo 111 se calcula desde retenciones guardadas en líneas de factura emitida; revisa que la clasificación sea correcta antes de presentar.");
  }

  if (code === "115") {
    warnings.push("El Modelo 115 requiere clasificar facturas de alquiler antes de calcular una autoliquidación fiable.");
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

async function fetchIssuedInvoiceVat(companyId: string, start: Date, endExclusive: Date) {
  const lines = await db
    .select({
      quantity: invoiceLine.quantity,
      unitPrice: invoiceLine.unitPrice,
      taxRate: invoiceLine.taxRate,
      discountPct: invoiceLine.discountPct,
      retentionRate: invoiceLine.retentionRate,
      invoiceId: invoice.id,
      number: invoice.number,
      issueDate: invoice.issueDate,
      totalAmount: invoice.totalAmount,
    })
    .from(invoiceLine)
    .innerJoin(invoice, eq(invoiceLine.invoiceId, invoice.id))
    .where(and(eq(invoice.companyId, companyId), ne(invoice.status, "VOID"), gte(invoice.issueDate, start), lt(invoice.issueDate, endExclusive)));

  return {
    invoiceIds: new Set(lines.map((line) => line.invoiceId)),
    buckets: aggregateOutputVat(lines),
    withholdingBuckets: aggregateWithholdings(lines),
    documents: aggregateSourceDocuments(lines),
  };
}

async function fetchSupplierInvoiceVat(companyId: string, start: Date, endExclusive: Date) {
  const lines = await db
    .select({
      quantity: supplierInvoiceLine.quantity,
      unitPrice: supplierInvoiceLine.unitPrice,
      taxRate: supplierInvoiceLine.taxRate,
      invoiceId: supplierInvoice.id,
      number: supplierInvoice.number,
      issueDate: supplierInvoice.issueDate,
      totalAmount: supplierInvoice.totalAmount,
    })
    .from(supplierInvoiceLine)
    .innerJoin(supplierInvoice, eq(supplierInvoiceLine.supplierInvoiceId, supplierInvoice.id))
    .where(and(eq(supplierInvoice.companyId, companyId), gte(supplierInvoice.issueDate, start), lt(supplierInvoice.issueDate, endExclusive)));

  return {
    invoiceIds: new Set(lines.map((line) => line.invoiceId)),
    buckets: aggregateOutputVat(lines),
    documents: aggregateSourceDocuments(lines),
  };
}

function aggregateSourceDocuments(
  lines: Array<{
    invoiceId: string;
    number: string;
    issueDate: Date;
    totalAmount: string | number;
    quantity: string | number;
    unitPrice: string | number;
    taxRate: string | number;
    discountPct?: string | number | null;
    retentionRate?: string | number | null;
  }>,
) {
  const documents = new Map<string, FiscalSourceDocument>();

  for (const line of lines) {
    const discountPct = Math.min(Math.max(toNumber(line.discountPct), 0), 100);
    const base = roundFiscalMoney(toNumber(line.quantity) * toNumber(line.unitPrice) * (1 - discountPct / 100));
    const taxAmount = roundFiscalMoney((base * toNumber(line.taxRate)) / 100);
    const withholdingAmount = roundFiscalMoney((base * toNumber(line.retentionRate)) / 100);
    const document = documents.get(line.invoiceId) ?? {
      id: line.invoiceId,
      number: line.number,
      issueDate: line.issueDate.toISOString(),
      totalAmount: roundFiscalMoney(toNumber(line.totalAmount)),
      taxBase: 0,
      taxAmount: 0,
      withholdingAmount: 0,
    };

    document.taxBase = roundFiscalMoney(document.taxBase + base);
    document.taxAmount = roundFiscalMoney(document.taxAmount + taxAmount);
    document.withholdingAmount = roundFiscalMoney((document.withholdingAmount ?? 0) + withholdingAmount);
    documents.set(line.invoiceId, document);
  }

  return [...documents.values()].sort((left, right) => right.issueDate.localeCompare(left.issueDate));
}

async function fetchThirdPartyOperations(companyId: string, start: Date, endExclusive: Date) {
  const rows = await db
    .select({
      type: sql<"customer">`'customer'`,
      taxId: partner.taxId,
      partnerName: partner.name,
      customerName: customer.name,
      amount: sql<string>`sum(${invoice.totalAmount})`,
    })
    .from(invoice)
    .innerJoin(customer, eq(customer.id, invoice.customerId))
    .leftJoin(partner, eq(partner.id, customer.partnerId))
    .where(and(eq(invoice.companyId, companyId), ne(invoice.status, "VOID"), gte(invoice.issueDate, start), lt(invoice.issueDate, endExclusive)))
    .groupBy(partner.taxId, partner.name, customer.name);

  return rows
    .map((row) => ({
      type: row.type,
      taxId: row.taxId?.trim() || "Sin NIF",
      name: row.partnerName ?? row.customerName,
      amount: roundFiscalMoney(toNumber(row.amount)),
    }))
    .filter((row) => row.amount >= THIRD_PARTY_THRESHOLD)
    .sort((left, right) => right.amount - left.amount);
}

async function fetchSupplierThirdPartyOperations(companyId: string, start: Date, endExclusive: Date) {
  const rows = await db
    .select({
      type: sql<"supplier">`'supplier'`,
      taxId: partner.taxId,
      name: partner.name,
      amount: sql<string>`sum(${supplierInvoice.totalAmount})`,
    })
    .from(supplierInvoice)
    .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
    .where(and(eq(supplierInvoice.companyId, companyId), gte(supplierInvoice.issueDate, start), lt(supplierInvoice.issueDate, endExclusive)))
    .groupBy(partner.taxId, partner.name);

  return rows
    .map((row) => ({
      type: row.type,
      taxId: row.taxId?.trim() || "Sin NIF",
      name: row.name,
      amount: roundFiscalMoney(toNumber(row.amount)),
    }))
    .filter((row) => row.amount >= THIRD_PARTY_THRESHOLD)
    .sort((left, right) => right.amount - left.amount);
}

async function fetchAccountingTaxBalances(companyId: string, start: Date, endExclusive: Date) {
  const rows = await db
    .select({
      code: accountChart.code,
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
        inArray(accountChart.code, ["477000", "472000", "475100"]),
      ),
    )
    .groupBy(accountChart.code);

  const balances = new Map(rows.map((row) => [row.code, { debit: toNumber(row.debit), credit: toNumber(row.credit) }]));
  const outputVat = balances.get("477000");
  const inputVat = balances.get("472000");
  const withholdings = balances.get("475100");

  return {
    outputVat: roundFiscalMoney((outputVat?.credit ?? 0) - (outputVat?.debit ?? 0)),
    inputVat: roundFiscalMoney((inputVat?.debit ?? 0) - (inputVat?.credit ?? 0)),
    withholdings: roundFiscalMoney((withholdings?.debit ?? 0) - (withholdings?.credit ?? 0)),
  };
}

function reconcile(fiscalAmount: number, accountingAmount: number): ReconciliationLine {
  return {
    fiscalAmount,
    accountingAmount,
    difference: roundFiscalMoney(fiscalAmount - accountingAmount),
  };
}

function buildModelo303Boxes(buckets: VatBucket[], deductibleInputTaxAmount: number, settlementAmount: number): Modelo303Box[] {
  const byRate = new Map(buckets.map((bucket) => [bucket.rate, bucket]));
  const boxes: Modelo303Box[] = [
    { box: "01", label: "Base IVA devengado 4%", amount: byRate.get(4)?.base ?? 0, kind: "base" },
    { box: "03", label: "Cuota IVA devengado 4%", amount: byRate.get(4)?.tax ?? 0, kind: "tax" },
    { box: "04", label: "Base IVA devengado 10%", amount: byRate.get(10)?.base ?? 0, kind: "base" },
    { box: "06", label: "Cuota IVA devengado 10%", amount: byRate.get(10)?.tax ?? 0, kind: "tax" },
    { box: "07", label: "Base IVA devengado 21%", amount: byRate.get(21)?.base ?? 0, kind: "base" },
    { box: "09", label: "Cuota IVA devengado 21%", amount: byRate.get(21)?.tax ?? 0, kind: "tax" },
    { box: "29", label: "IVA soportado deducible", amount: deductibleInputTaxAmount, kind: "tax" },
    { box: "46", label: "Resultado estimado autoliquidación", amount: settlementAmount, kind: "settlement" },
  ];

  const nonStandard = buckets.filter((bucket) => ![0, 4, 10, 21].includes(bucket.rate));
  for (const bucket of nonStandard) {
    boxes.push({ box: "REV", label: `Revisar tipo IVA ${bucket.rate}%`, amount: bucket.tax, kind: "tax" });
  }

  return boxes.map((box) => ({ ...box, amount: roundFiscalMoney(box.amount) }));
}

function buildAutomationChecks({
  accountingBalanced,
  code,
  dueStatus,
  modelo303Boxes,
  profile,
  thirdPartyOperations,
  vatRates,
}: {
  accountingBalanced: boolean;
  code: SpanishFiscalModelCode;
  dueStatus: SpanishFiscalSummary["dueStatus"];
  modelo303Boxes: Modelo303Box[];
  profile: FiscalAutomationProfile;
  thirdPartyOperations?: SpanishFiscalSummary["thirdPartyOperations"];
  vatRates: number[];
}): FiscalAutomationCheck[] {
  const checks: FiscalAutomationCheck[] = [
    {
      code: "accounting-reconciliation",
      status: accountingBalanced ? "ok" : "blocking",
      title: "Conciliación fiscal-contable",
      detail: accountingBalanced
        ? "Las cuentas fiscales cuadran con el cálculo del periodo."
        : "Hay diferencias entre el cálculo fiscal y las cuentas 477000, 472000 o 475100.",
      action: accountingBalanced ? "Listo para cierre operativo." : "Revisa asientos, facturas y cuentas fiscales antes de presentar.",
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

  if (dueStatus === "due-soon" || dueStatus === "overdue") {
    checks.push({
      code: "deadline",
      status: dueStatus === "overdue" ? "blocking" : "warning",
      title: "Vencimiento fiscal",
      detail: dueStatus === "overdue" ? "El periodo figura vencido." : "El periodo vence en los próximos 7 días.",
      action: "Completa validaciones y cierra el periodo fiscal.",
    });
  }

  const invalidVatRates = vatRates.filter((rate) => !STANDARD_VAT_RATES.has(rate));
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

export async function calculateSpanishFiscalSummary(companyId: string, code: SpanishFiscalModelCode, period: string): Promise<SpanishFiscalSummary> {
  const model = getSpanishFiscalModel(code);
  const range = parseSpanishFiscalPeriod(period, code);

  if (!model || !range) {
    throw new Error("Modelo o periodo fiscal español no soportado.");
  }

  const [profile, issuedVat, supplierVat] = await Promise.all([
    fetchFiscalAutomationProfile(companyId),
    fetchIssuedInvoiceVat(companyId, range.start, range.endExclusive),
    fetchSupplierInvoiceVat(companyId, range.start, range.endExclusive),
  ]);
  const totals = totalsFromBuckets(issuedVat.buckets);
  const inputTotals = totalsFromBuckets(supplierVat.buckets);
  const deductibleInputTaxAmount = roundFiscalMoney((inputTotals.outputTaxAmount * profile.prorrataPct) / 100);
  const nonDeductibleInputTaxAmount = roundFiscalMoney(inputTotals.outputTaxAmount - deductibleInputTaxAmount);
  const withholdingTotals = totalsFromBuckets(issuedVat.withholdingBuckets);
  const accountingBalances = await fetchAccountingTaxBalances(companyId, range.start, range.endExclusive);
  const dueDate = getSpanishFiscalDueDate(period, code);
  const thirdPartyOperations =
    code === "347"
      ? [
          ...(await fetchThirdPartyOperations(companyId, range.start, range.endExclusive)),
          ...(await fetchSupplierThirdPartyOperations(companyId, range.start, range.endExclusive)),
        ].sort((left, right) => right.amount - left.amount)
      : undefined;
  const settlementAmount = roundFiscalMoney(totals.outputTaxAmount - deductibleInputTaxAmount);
  const outputVatReconciliation = reconcile(totals.outputTaxAmount, accountingBalances.outputVat);
  const inputVatReconciliation = reconcile(deductibleInputTaxAmount, accountingBalances.inputVat);
  const withholdingReconciliation = reconcile(withholdingTotals.outputTaxAmount, accountingBalances.withholdings);
  const accountingBalanced = [outputVatReconciliation, inputVatReconciliation, withholdingReconciliation]
    .every((line) => Math.abs(line.difference) < 0.01);
  const modelo303Boxes = buildModelo303Boxes(issuedVat.buckets, deductibleInputTaxAmount, settlementAmount);
  const dueStatus = dueDate ? getFiscalDueStatus(dueDate) : null;

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
    salesInvoiceCount: issuedVat.invoiceIds.size,
    supplierInvoiceCount: supplierVat.invoiceIds.size,
    outputTaxBase: totals.outputTaxBase,
    outputTaxAmount: totals.outputTaxAmount,
    inputTaxBase: inputTotals.outputTaxBase,
    inputTaxAmount: inputTotals.outputTaxAmount,
    deductibleInputTaxAmount,
    nonDeductibleInputTaxAmount,
    settlementAmount,
    withholdingBase: withholdingTotals.outputTaxBase,
    withholdingAmount: withholdingTotals.outputTaxAmount,
    buckets: issuedVat.buckets,
    inputBuckets: supplierVat.buckets,
    withholdingBuckets: issuedVat.withholdingBuckets,
    thirdPartyOperations,
    warnings: unsupportedWarnings(code),
    fiscalProfile: profile,
    modelo303Boxes,
    automationChecks: buildAutomationChecks({
      accountingBalanced,
      code,
      dueStatus,
      modelo303Boxes,
      profile,
      thirdPartyOperations,
      vatRates: [...issuedVat.buckets, ...supplierVat.buckets].map((bucket) => bucket.rate),
    }),
    sourceDocuments: {
      salesInvoices: issuedVat.documents,
      supplierInvoices: supplierVat.documents,
    },
    accountingReconciliation: {
      outputVat: outputVatReconciliation,
      inputVat: inputVatReconciliation,
      withholdings: withholdingReconciliation,
      balanced: accountingBalanced,
    },
  };
}
