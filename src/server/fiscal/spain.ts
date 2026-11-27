import { and, eq, gte, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";

import { buildModelo420, buildModelo425, buildModelo450, type AiemBucket } from "@/server/fiscal/canarias-calc";
import { igicExemptRegime } from "@/lib/country-packs/igic";
import { getCompanyTaxTerritory } from "@/server/company/fiscal-context";
import { standardVatRate } from "@/lib/country-packs/vat-rates";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";

import { accountChart, companySettings, customer, fiscalReport, invoice, invoiceLine, invoiceLineTax, item, journalEntry, journalLine, partner, payment, paymentMethod, supplierInvoice, supplierInvoiceLine } from "@/db/schema";
import { db } from "@/lib/db";
import {
  CANARY_MODEL_CODES,
  FISCAL_TIME_ZONE_CANARY,
  FISCAL_TIME_ZONE_PENINSULA,
  fiscalCivilDate,
  fiscalQuarterIndex,
  fiscalRangeInstants,
  fiscalTimeZoneFor,
  getDaysUntilDue,
  getFiscalDueStatus,
  getSpanishFiscalDirectDebitDate,
  getSpanishFiscalDueDate,
  getSpanishFiscalModel,
  isLastVatPeriodOfYear,
  isSpanishFiscalModelCode,
  localMidnightInstant,
  normalizeTaxpayerType,
  previousPeriodsOfYear,
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
  buildModelo390Summary,
  computeIssuedVat,
  computeIncomeTaxExpenseCents,
  computeModelo130,
  computeModelo303Compensation,
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
  type IssuedLineInput,
  type IssuedVatResult,
  type Modelo303Box,
  type SupplierVatResult,
} from "@/server/fiscal/spain-calc";
import { ACCRUAL_LOCKING_MODEL_CODES, resolveAccrualDate, type AccrualBasis, type FiledVatPeriod } from "@/server/fiscal/accrual";
import { isValidSpanishTaxId } from "@/lib/spanish-tax-id";
import { lineBaseCents } from "@/server/taxation/engine";
import { DRAFT_NUMBER_PREFIX } from "@/server/invoices/lifecycle";

export type { FiscalSourceDocument, Modelo130Result, Modelo303Box, Modelo349Result } from "@/server/fiscal/spain-calc";

export type SpanishFiscalSummary = {
  code: SpanishFiscalModelCode;
  modelName: string;
  periodLabel: string;
  dueDate: string | null;
  /** Último día para presentar con domiciliación bancaria (modelos con ingreso de la AEAT). */
  directDebitDate?: string | null;
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
   * Liquidación del 303 con las cuotas a compensar de periodos anteriores (solo en el 303):
   * 110 = pendingBefore, 78 = applied, 87 = pendingAfter, 69/71 = result.
   */
  vatSettlement?: {
    /** Saldo de ejercicios anteriores configurado para el ejercicio. */
    openingAmount: number;
    pendingBefore: number;
    applied: number;
    pendingAfter: number;
    result: number;
    /** Saldo a favor al terminar el periodo (87 + el generado en él). */
    carryForward: number;
    lastPeriod: boolean;
  };
  /**
   * Importe a ingresar (o a compensar si es negativo) del modelo concreto: 303 → resultado de la
   * liquidación tras compensar (casilla 71); 111/115 → retenciones; 130 → pago fraccionado. null en
   * modelos informativos (347, 349 y 390: el resumen anual no se paga; se paga cada 303).
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
  thirdPartyOperations?: ThirdPartyOperation[];
  warnings: string[];
  fiscalProfile: FiscalAutomationProfile;
  modelo303Boxes: Modelo303Box[];
  /** Resumen anual del IVA para el 390, sin numeración oficial de casillas (solo en el 390). */
  annualSummaryBoxes?: Modelo303Box[];
  /** Casillas de los modelos de la Agencia Tributaria Canaria (420, 425, 450). */
  canaryBoxes?: Modelo303Box[];
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
  fiscalRegime: "general" | "recargo_equivalencia" | "cash_accounting" | "exempt" | "comerciante_minorista" | "pequeno_empresario";
  /** Territorio fiscal de la empresa (ES, ES-CN, ES-CE, ES-ML). */
  territory: string;
  taxPeriodicity: "monthly" | "quarterly";
  siiEnabled: boolean;
  verifactuMode: "pending" | "verifactu" | "non_verifactu";
  prorrataPct: number;
  taxpayerType: TaxpayerType;
  /** Cuotas de IVA a compensar de ejercicios anteriores, por ejercicio ("2026" → importe). */
  vatCompensationOpening: Record<string, number>;
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
/** Cliente genérico del TPV (mismo nombre que `GENERIC_CUSTOMER_NAME` de `@/server/pos/service`). */
const GENERIC_POS_CUSTOMER_NAME = "Clientes varios (TPV)";
const STANDARD_VAT_RATES = new Set([0, 4, 5, 10, 21]);
/** Asientos que no son operaciones del periodo y no deben entrar en la conciliación de IVA. */
const NON_OPERATIONAL_SOURCES = ["fiscalYearRegularization", "fiscalYearClosing", "fiscalYearOpening"];

function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function unsupportedWarnings(code: SpanishFiscalModelCode) {
  const warnings = [
    CANARY_MODEL_CODES.has(code)
      ? "Borrador interno: no sustituye la presentación oficial en la Agencia Tributaria Canaria ni genera fichero oficial."
      : "Borrador interno: no sustituye la presentación oficial en AEAT ni genera fichero oficial.",
  ];
  if (code === "420" || code === "425") {
    warnings.push("No incluye cuotas a compensar de periodos anteriores, regularizaciones (prorrata, bienes de inversión, inicio de actividad), devoluciones en régimen de viajeros ni complementarias: añádelas tú en el programa de ayuda de la ATC.");
  }
  if (code === "450") {
    warnings.push("El 450 suma los impuestos «AIEM» de tus facturas emitidas. No incluye el régimen simplificado del AIEM, los productos derivados del petróleo ni rectificaciones de cuotas de periodos anteriores.");
  }

  if (code === "111") {
    warnings.push("El Modelo 111 se calcula con las retenciones que practicas en facturas recibidas (salvo gastos de alquiler, cuenta 621, que van al 115).");
  }
  if (code === "115") {
    warnings.push("El Modelo 115 toma las retenciones de facturas recibidas cuyo gasto está en la cuenta 621 (arrendamientos). Revisa que los alquileres usen esa cuenta.");
  }
  if (code === "303") {
    warnings.push("Las cuotas a compensar (casillas 110, 78 y 87) salen de encadenar los resultados de los periodos anteriores del ejercicio (el presentado, si el modelo guarda su foto; si no, el calculado hoy) más el saldo de ejercicios anteriores de Configuración › Fiscalidad. Se supone que los resultados negativos se dejaron a compensar, sin pedir devolución.");
  }
  if (code === "390") {
    warnings.push("Resumen anual sin numeración oficial: las casillas del 390 no se han contrastado con sus instrucciones, así que cada importe va identificado por su concepto. Trasládalo al formulario de la AEAT buscando el apartado equivalente. No incluye regularizaciones, régimen simplificado ni el detalle por actividades.");
  }
  if (code === "347") {
    warnings.push("El 347 excluye operaciones con retención (se declaran en 190/180) y operaciones con el extranjero (349). Los importes van por trimestres naturales. No distingue arrendamientos de locales, operaciones de seguros ni anticipos, que llevan claves propias; los cobros en metálico solo se detectan si el cobro está registrado con una forma de pago en efectivo.");
  }
  if (code === "349") {
    warnings.push("El 349 incluye facturas con tratamiento intracomunitario. En ventas, «Servicios a empresa de la UE» va con clave S; una «Entrega intracomunitaria» va con clave E (bienes) salvo las líneas con un artículo marcado como servicio. En compras, la cuenta 62x indica servicio. No comprueba los NIF-IVA en el censo VIES.");
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
      vatCompensationOpening: companySettings.vatCompensationOpening,
    })
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);

  const territory = await getCompanyTaxTerritory(companyId);
  const fiscalRegime = normalizeFiscalRegime(settings?.fiscalRegime);
  return {
    territory,
    fiscalRegime,
    taxPeriodicity: normalizeTaxPeriodicity(settings?.taxPeriodicity),
    siiEnabled: settings?.siiEnabled ?? false,
    verifactuMode: normalizeVerifactuMode(settings?.verifactuMode),
    // IGIC en régimen de comerciante minorista o REPEP: el soportado no se deduce.
    prorrataPct: igicExemptRegime(territory, fiscalRegime) ? 0 : clampPct(toNumber(settings?.prorrataPct ?? 100)),
    taxpayerType: normalizeTaxpayerType(settings?.taxpayerType),
    vatCompensationOpening: normalizeVatCompensationOpening(settings?.vatCompensationOpening),
  };
}

/** Saldos iniciales a compensar por ejercicio: solo años de cuatro cifras e importes positivos. */
export function normalizeVatCompensationOpening(value: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  if (!value || typeof value !== "object") return result;
  for (const [year, amount] of Object.entries(value as Record<string, unknown>)) {
    const parsed = Number(amount);
    if (/^20\d{2}$/.test(year) && Number.isFinite(parsed) && parsed > 0) result[year] = centsToNumber(toCents(parsed));
  }
  return result;
}

function normalizeFiscalRegime(value: string | null | undefined): FiscalAutomationProfile["fiscalRegime"] {
  if (value === "recargo_equivalencia" || value === "cash_accounting" || value === "exempt" || value === "comerciante_minorista" || value === "pequeno_empresario") return value;
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

/** Facturas emitidas que computan fiscalmente: de la empresa, sin anuladas (VOID) ni borradores del ciclo de emisión. */
function issuedInvoiceBaseFilter(companyId: string) {
  return and(
    eq(invoice.companyId, companyId),
    ne(invoice.status, "VOID"),
    sql`${invoice.number} NOT LIKE ${`${DRAFT_NUMBER_PREFIX}%`}`,
  );
}

/**
 * Facturas emitidas que computan en un periodo: de la empresa, por fecha de expedición y sin anuladas (VOID).
 * Excluye los borradores del ciclo borrador → emisión (número provisional BORRADOR-…, sin asiento);
 * las facturas antiguas en estado DRAFT sí computan porque ya están numeradas y contabilizadas.
 * Las rectificativas emitidas computan con su signo (negativas si abonan).
 *
 * Los límites se aplican en hora local (ver «HORA LOCAL DE LOS PERIODOS FISCALES» en
 * `@/lib/fiscal-spain`): un límite dado como fecha civil (00:00 UTC) pasa a la medianoche de
 * `timeZone`. Lo usan los modelos que van por fecha de expedición (347, 450) y la detección de
 * obligaciones; el 303, el 390, el 349 y el 130 van por devengo (`fetchIssuedLines`).
 */
export function issuedInvoiceFiscalFilter(companyId: string, start: Date, endExclusive: Date, timeZone: string = FISCAL_TIME_ZONE_PENINSULA) {
  const range = fiscalRangeInstants({ start, endExclusive }, timeZone);
  return and(
    issuedInvoiceBaseFilter(companyId),
    gte(invoice.issueDate, range.start),
    lt(invoice.issueDate, range.endExclusive),
  );
}

/**
 * Candidatas a un periodo por devengo: expedidas en él o con fecha de operación en él. La fecha que
 * decide (`resolveAccrualDate`) se resuelve después, factura a factura. Límites ya en instantes.
 */
function issuedInvoiceAccrualFilter(companyId: string, start: Date, endExclusive: Date) {
  return and(
    issuedInvoiceBaseFilter(companyId),
    or(
      and(gte(invoice.issueDate, start), lt(invoice.issueDate, endExclusive)),
      and(isNotNull(invoice.operationDate), gte(invoice.operationDate, start), lt(invoice.operationDate, endExclusive)),
    ),
  );
}

/**
 * Facturas recibidas que computan en un periodo: sin anuladas (VOID) ni borradores, por su fecha de
 * registro (la misma que usa el 303), que es el periodo en que se anotan en el libro registro.
 * Límites en hora local, igual que en las emitidas.
 */
export function supplierInvoiceFiscalFilter(companyId: string, start: Date, endExclusive: Date, timeZone: string = FISCAL_TIME_ZONE_PENINSULA) {
  const range = fiscalRangeInstants({ start, endExclusive }, timeZone);
  return and(
    eq(supplierInvoice.companyId, companyId),
    notInArray(supplierInvoice.status, ["VOID", "DRAFT"]),
    gte(supplierInvoice.accountingDate, range.start),
    lt(supplierInvoice.accountingDate, range.endExclusive),
  );
}

type InstantRange = { start: Date; endExclusive: Date };

function inInstantRange(date: Date, range: InstantRange) {
  return date >= range.start && date < range.endExclusive;
}

export type FiledVatPeriodRow = FiledVatPeriod & {
  /** Resultado del régimen general (casilla 46) según la foto de lo presentado; null si no hay foto. */
  filedResultCents: number | null;
};

/** Periodos de IVA/IGIC presentados de la empresa (303, 390, 420 y 425), con sus límites en hora local. */
export async function loadFiledVatPeriods(companyId: string, timeZone: string): Promise<FiledVatPeriodRow[]> {
  const rows = await db
    .select({
      code: fiscalReport.code,
      period: fiscalReport.period,
      snapshotAt: fiscalReport.filedSnapshotAt,
      filedResult: sql<string | null>`${fiscalReport.filedSnapshot} -> 'summary' ->> 'settlementAmount'`,
    })
    .from(fiscalReport)
    .where(and(eq(fiscalReport.companyId, companyId), eq(fiscalReport.status, "FILED"), inArray(fiscalReport.code, [...ACCRUAL_LOCKING_MODEL_CODES])));

  return rows.flatMap((row) => {
    if (!isSpanishFiscalModelCode(row.code)) return [];
    const range = parseSpanishFiscalPeriod(row.period, row.code);
    if (!range) return [];
    const filedResult = row.filedResult === null || row.filedResult === undefined ? Number.NaN : Number(row.filedResult);
    return [{
      code: row.code,
      period: row.period,
      ...fiscalRangeInstants(range, timeZone),
      snapshotAt: row.snapshotAt ?? null,
      filedResultCents: Number.isFinite(filedResult) ? toCents(filedResult) : null,
    }];
  });
}

type IssuedFiscalLine = IssuedLineInput & {
  accrualDate: Date;
  accrualBasis: AccrualBasis;
  filedPeriod?: { code: string; period: string };
};

/** Máximo de identificadores por consulta `IN (...)` (PostgreSQL admite 65.535 parámetros). */
const ID_BATCH_SIZE = 10_000;

/**
 * Líneas de las facturas emitidas candidatas a un rango (por expedición o por fecha de operación),
 * cada una con su fecha de devengo ya resuelta. Los límites son instantes reales.
 */
async function fetchIssuedLines(
  companyId: string,
  start: Date,
  endExclusive: Date,
  options: { homeCountry?: string | null; filedPeriods: FiledVatPeriod[] },
): Promise<IssuedFiscalLine[]> {
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
      operationDate: invoice.operationDate,
      issuedAt: invoice.issuedAt,
      invoiceType: invoice.invoiceType,
      totalAmount: invoice.totalAmount,
      status: invoice.status,
      vatTreatment: invoice.vatTreatment,
      countryCode: partner.countryCode,
    })
    .from(invoiceLine)
    .innerJoin(invoice, eq(invoiceLine.invoiceId, invoice.id))
    .innerJoin(customer, eq(customer.id, invoice.customerId))
    .leftJoin(partner, eq(partner.id, customer.partnerId))
    .where(issuedInvoiceAccrualFilter(companyId, start, endExclusive));

  const lineIds = lines.map((line) => line.lineId);
  const taxesByLine = new Map<string, Array<{ rate: string; kind: string | null; operation: string; baseAmount: string | null; amount: string | null }>>();
  for (let offset = 0; offset < lineIds.length; offset += ID_BATCH_SIZE) {
    const selectedTaxes = await db.select({
      invoiceLineId: invoiceLineTax.invoiceLineId,
      rate: invoiceLineTax.rate,
      kind: invoiceLineTax.kind,
      operation: invoiceLineTax.operation,
      baseAmount: invoiceLineTax.baseAmount,
      amount: invoiceLineTax.amount,
    }).from(invoiceLineTax).where(inArray(invoiceLineTax.invoiceLineId, lineIds.slice(offset, offset + ID_BATCH_SIZE)));
    for (const selectedTax of selectedTaxes) {
      taxesByLine.set(selectedTax.invoiceLineId, [...(taxesByLine.get(selectedTax.invoiceLineId) ?? []), selectedTax]);
    }
  }

  return lines.map((line) => {
    const accrual = resolveAccrualDate(line, options.filedPeriods);
    return {
      ...line,
      treatment: resolveSalesVatTreatment(line.vatTreatment, line.countryCode, options.homeCountry),
      taxes: taxesByLine.get(line.lineId) ?? null,
      accrualDate: accrual.date,
      accrualBasis: accrual.basis,
      filedPeriod: accrual.filedPeriod,
    };
  });
}

/**
 * IVA devengado de las facturas emitidas de un periodo, por fecha de devengo (ver `accrual.ts`).
 * `start` y `endExclusive` pueden ser fechas civiles (00:00 UTC) o instantes: se aplican en hora local.
 */
export async function fetchIssuedInvoiceVat(
  companyId: string,
  start: Date,
  endExclusive: Date,
  homeCountry?: string | null,
  timeZone: string = fiscalTimeZoneFor(homeCountry),
): Promise<IssuedVatResult> {
  const range = fiscalRangeInstants({ start, endExclusive }, timeZone);
  const filedPeriods = await loadFiledVatPeriods(companyId, timeZone);
  const lines = await fetchIssuedLines(companyId, range.start, range.endExclusive, { homeCountry, filedPeriods });
  return computeIssuedVat(lines.filter((line) => inInstantRange(line.accrualDate, range)));
}

/** Fecha que decide el periodo de una línea recibida: la de registro, o la de anulación en la fila que resta. */
function supplierLinePeriodDate(line: SupplierLineInput) {
  return (line.sign === -1 ? line.voidedAt : null) ?? line.accountingDate ?? line.issueDate;
}

/**
 * Líneas de facturas recibidas del periodo de IVA, con su tratamiento y su prorrata:
 * - cada factura computa en su fecha de registro (por defecto la de la factura);
 * - una factura anulada sigue en su periodo y su anulación resta (sign −1) en el periodo del asiento
 *   de anulación, como en el diario; las anuladas sin fecha de anulación (antiguas) no computan.
 * Los límites son instantes reales (medianoche local).
 */
async function fetchSupplierLines(companyId: string, start: Date, endExclusive: Date, homeCountry?: string | null): Promise<SupplierLineInput[]> {
  const columns = {
    subtotal: supplierInvoiceLine.subtotalAmount,
    taxAmount: supplierInvoiceLine.taxAmount,
    taxRate: supplierInvoiceLine.taxRate,
    taxDeductiblePct: supplierInvoiceLine.taxDeductiblePct,
    retentionAmount: supplierInvoiceLine.retentionAmount,
    retentionRate: supplierInvoiceLine.retentionRate,
    expenseAccountCode: accountChart.code,
    isInvestmentGood: supplierInvoiceLine.isInvestmentGood,
    invoiceId: supplierInvoice.id,
    number: supplierInvoice.number,
    issueDate: supplierInvoice.issueDate,
    accountingDate: supplierInvoice.accountingDate,
    voidedAt: supplierInvoice.voidedAt,
    prorrataPct: supplierInvoice.prorrataPct,
    totalAmount: supplierInvoice.totalAmount,
    vatTreatment: supplierInvoice.vatTreatment,
    countryCode: partner.countryCode,
  };
  const query = () => db
    .select(columns)
    .from(supplierInvoiceLine)
    .innerJoin(supplierInvoice, eq(supplierInvoiceLine.supplierInvoiceId, supplierInvoice.id))
    .leftJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
    .leftJoin(accountChart, eq(accountChart.id, supplierInvoiceLine.expenseAccountId));
  const [registered, voided] = await Promise.all([
    query().where(and(
      eq(supplierInvoice.companyId, companyId),
      ne(supplierInvoice.status, "DRAFT"),
      or(ne(supplierInvoice.status, "VOID"), isNotNull(supplierInvoice.voidedAt)),
      gte(supplierInvoice.accountingDate, start),
      lt(supplierInvoice.accountingDate, endExclusive),
    )),
    query().where(and(
      eq(supplierInvoice.companyId, companyId),
      eq(supplierInvoice.status, "VOID"),
      gte(supplierInvoice.voidedAt, start),
      lt(supplierInvoice.voidedAt, endExclusive),
    )),
  ]);

  return [
    ...registered.map((line) => ({ ...line, sign: 1 as const })),
    ...voided.map((line) => ({ ...line, sign: -1 as const })),
  ].map((line) => ({
    ...line,
    treatment: resolveSupplierVatTreatment(line.vatTreatment, line.countryCode, null, homeCountry),
  }));
}

/** Facturas recibidas del periodo. Excluye anuladas (VOID) y borradores si los hubiera. */
export async function fetchSupplierInvoiceVat(
  companyId: string,
  start: Date,
  endExclusive: Date,
  prorrataPct: number,
  homeCountry?: string | null,
  timeZone: string = fiscalTimeZoneFor(homeCountry),
): Promise<SupplierVatResult> {
  const range = fiscalRangeInstants({ start, endExclusive }, timeZone);
  return computeSupplierVat(await fetchSupplierLines(companyId, range.start, range.endExclusive, homeCountry), prorrataPct, standardVatRate(homeCountry));
}

/** Etiqueta de periodo de una fecha con la misma forma (mes o trimestre) que el periodo declarado. */
function periodOf(date: Date, likePeriod: string, timeZone: string) {
  const civil = fiscalCivilDate(date, timeZone);
  if (/^\d{4}-\d{2}$/.test(likePeriod.trim())) return `${civil.year}-${String(civil.month).padStart(2, "0")}`;
  return `${civil.year}-Q${Math.floor((civil.month - 1) / 3) + 1}`;
}

/**
 * Clave de una venta intracomunitaria en el 349. «Servicios a empresa de la UE» es siempre S. Una
 * «Entrega intracomunitaria» es E (bienes) salvo que la línea lleve un artículo marcado como
 * servicio: una línea sin artículo de una entrega de bienes es un bien, no un servicio.
 */
export function modelo349SaleKey(treatment: string, itemIsService: boolean | null | undefined) {
  return modelo349Key("sale", treatment === "INTRA_EU_SERVICES" || Boolean(itemIsService));
}

/**
 * Modelo 349: facturas emitidas y recibidas con tratamiento intracomunitario, agrupadas por NIF-IVA y clave.
 * Las emitidas van por fecha de devengo, como la casilla 59 del 303. Las rectificativas de facturas
 * de otro periodo se declaran como rectificaciones de ese periodo.
 */
async function fetchModelo349(companyId: string, range: InstantRange, period: string, timeZone: string, filedPeriods: FiledVatPeriod[]): Promise<Modelo349Result> {
  const original = alias(invoice, "original_invoice");
  const salesLines = await db
    .select({
      quantity: invoiceLine.quantity,
      unitPrice: invoiceLine.unitPrice,
      discountPct: invoiceLine.discountPct,
      isService: item.isService,
      vatTreatment: invoice.vatTreatment,
      invoiceType: invoice.invoiceType,
      issueDate: invoice.issueDate,
      operationDate: invoice.operationDate,
      issuedAt: invoice.issuedAt,
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
    .where(issuedInvoiceAccrualFilter(companyId, range.start, range.endExclusive));

  const entries: Modelo349Entry[] = [];
  for (const line of salesLines) {
    if (!inInstantRange(resolveAccrualDate(line, filedPeriods).date, range)) continue;
    const treatment = resolveSalesVatTreatment(line.vatTreatment, line.countryCode);
    if (!isIntraEuSalesTreatment(treatment)) continue;
    const baseCents = lineBaseCents(
      { quantity: toNumber(line.quantity), unitPrice: toNumber(line.unitPrice), discountPct: toNumber(line.discountPct) },
      { allowNegative: true },
    );
    const originalOutside = line.invoiceType === "CREDIT_NOTE" && line.originalIssueDate && !inInstantRange(line.originalIssueDate, range);
    entries.push({
      key: modelo349SaleKey(treatment, line.isService),
      operatorName: line.partnerName ?? line.customerName,
      operatorTaxId: line.taxId,
      countryCode: line.countryCode,
      baseCents,
      rectifiesPeriod: originalOutside && line.originalIssueDate ? periodOf(line.originalIssueDate, period, timeZone) : null,
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
    .where(supplierInvoiceFiscalFilter(companyId, range.start, range.endExclusive, timeZone));
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

/**
 * Modelo 130: ingresos, gastos y retenciones por trimestre desde el 1 de enero hasta el trimestre
 * declarado. Los trimestres se cuentan en hora local; los ingresos, por fecha de devengo.
 */
async function fetchModelo130(companyId: string, range: InstantRange, periodYear: number, prorrataPct: number, timeZone: string, filedPeriods: FiledVatPeriod[]): Promise<Modelo130Result> {
  const yearRange = { start: localMidnightInstant(periodYear, 0, 1, timeZone), endExclusive: range.endExclusive };
  const [issuedLines, supplierLines] = await Promise.all([
    fetchIssuedLines(companyId, yearRange.start, yearRange.endExclusive, { filedPeriods }),
    fetchSupplierLines(companyId, yearRange.start, yearRange.endExclusive),
  ]);
  const issued = computeIssuedVat(issuedLines.filter((line) => inInstantRange(line.accrualDate, yearRange)));
  const quarters: Modelo130QuarterInput[] = [0, 1, 2, 3].map(() => ({ incomeCents: 0, expenseCents: 0, withholdingCents: 0, withheldIncomeCents: 0 }));
  for (const document of issued.documents) {
    const quarter = quarters[fiscalQuarterIndex(new Date(document.accrualDate ?? document.issueDate), timeZone)];
    const baseCents = toCents(document.taxBase);
    quarter.incomeCents += baseCents;
    const withholdingCents = toCents(document.withholdingAmount ?? 0);
    quarter.withholdingCents += withholdingCents;
    if (withholdingCents !== 0) quarter.withheldIncomeCents = (quarter.withheldIncomeCents ?? 0) + baseCents;
  }
  for (let index = 0; index < 4; index += 1) {
    quarters[index].expenseCents = computeIncomeTaxExpenseCents(
      // Mismo criterio que el filtro: fecha de registro, o la de anulación en la fila que resta.
      supplierLines.filter((line) => fiscalQuarterIndex(supplierLinePeriodDate(line), timeZone) === index),
      prorrataPct,
    );
  }
  return computeModelo130(quarters, fiscalQuarterIndex(new Date(range.endExclusive.getTime() - 1), timeZone) + 1);
}

/** NIF sin espacios, guiones ni prefijo de país: dos fichas del mismo tercero suman juntas. */
function normalizeThirdPartyTaxId(taxId: string | null | undefined) {
  const value = (taxId ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return value.startsWith("ES") && value.length === 11 ? value.slice(2) : value;
}

export type ThirdPartyOperation<T extends "customer" | "supplier" = "customer" | "supplier"> = {
  type: T;
  taxId: string;
  name: string;
  amount: number;
  /** Importe de cada trimestre natural (1T a 4T); el 347 pide el desglose trimestral. */
  quarters: [number, number, number, number];
  /** Cobros en metálico del año de ese cliente, si superan 6.000 € (solo clientes). */
  cashAmount?: number;
};

/**
 * Agrupa por NIF (una persona o entidad es un solo declarado aunque tenga varias fichas) y deja las
 * que superan 3.005,06 € en valor absoluto. Sin NIF no se puede agrupar: cada ficha va por separado.
 * `quarter` (1-4) reparte el importe por trimestres; sin él, todo queda sin repartir (ceros).
 */
export function groupThirdPartyOperations<T extends "customer" | "supplier">(
  type: T,
  rows: Array<{ taxId: string | null; name: string; amount: string | number; quarter?: number | null }>,
): ThirdPartyOperation<T>[] {
  const groups = new Map<string, { taxId: string; name: string; cents: number; quarters: [number, number, number, number] }>();
  for (const row of rows) {
    const taxId = normalizeThirdPartyTaxId(row.taxId);
    const key = taxId || `sin-nif:${row.name}`;
    const group = groups.get(key) ?? { taxId: taxId || "Sin NIF", name: row.name, cents: 0, quarters: [0, 0, 0, 0] };
    const cents = toCents(row.amount);
    group.cents += cents;
    const quarter = Math.trunc(Number(row.quarter));
    if (quarter >= 1 && quarter <= 4) group.quarters[quarter - 1] += cents;
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      type,
      taxId: group.taxId,
      name: group.name,
      amount: centsToNumber(group.cents),
      quarters: group.quarters.map((cents) => centsToNumber(cents)) as [number, number, number, number],
    }))
    .filter((row) => Math.abs(row.amount) > THIRD_PARTY_THRESHOLD)
    .sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount));
}

/** Trimestre natural (1-4) de una columna de fecha en la zona horaria fiscal (una de las dos constantes del sistema). */
function quarterOf(column: AnyPgColumn, timeZone: string) {
  const zone = timeZone === FISCAL_TIME_ZONE_CANARY ? FISCAL_TIME_ZONE_CANARY : FISCAL_TIME_ZONE_PENINSULA;
  return sql<number>`extract(quarter from (${column} at time zone ${sql.raw(`'${zone}'`)}))::int`;
}

/**
 * Clientes españoles (> 3.005,06 €/año): sin anuladas, sin facturas con retención (van al 190) y
 * sin el cliente genérico del TPV (ventas a consumidores no identificados, que no se declaran).
 */
async function fetchThirdPartyOperations(companyId: string, start: Date, endExclusive: Date, timeZone: string) {
  const withholdingLine = sql`exists (select 1 from ${invoiceLine} il where il."invoiceId" = ${invoice.id} and il."retentionRate" > 0)`;
  const withholdingTax = sql`exists (select 1 from ${invoiceLineTax} ilt inner join ${invoiceLine} il2 on il2.id = ilt."invoiceLineId" where il2."invoiceId" = ${invoice.id} and ilt.operation = 'SUBTRACT')`;
  const quarter = quarterOf(invoice.issueDate, timeZone);
  const rows = await db
    .select({
      taxId: partner.taxId,
      partnerName: partner.name,
      customerName: customer.name,
      quarter,
      amount: sql<string>`sum(${invoice.totalAmount})`,
    })
    .from(invoice)
    .innerJoin(customer, eq(customer.id, invoice.customerId))
    .leftJoin(partner, eq(partner.id, customer.partnerId))
    .where(and(
      issuedInvoiceFiscalFilter(companyId, start, endExclusive, timeZone),
      or(isNull(partner.countryCode), eq(partner.countryCode, "ES")),
      sql`not ${withholdingLine}`,
      sql`not ${withholdingTax}`,
      sql`not (${customer.name} = ${GENERIC_POS_CUSTOMER_NAME} and coalesce(${partner.taxId}, '') = '')`,
    ))
    .groupBy(partner.taxId, partner.name, customer.name, quarter);

  return groupThirdPartyOperations("customer", rows.map((row) => ({ taxId: row.taxId, name: row.partnerName ?? row.customerName, amount: row.amount, quarter: row.quarter })));
}

/** Proveedores españoles (> 3.005,06 €/año): sin anuladas ni facturas con retención. */
async function fetchSupplierThirdPartyOperations(companyId: string, start: Date, endExclusive: Date, timeZone: string) {
  const quarter = quarterOf(supplierInvoice.accountingDate, timeZone);
  const rows = await db
    .select({
      taxId: partner.taxId,
      name: partner.name,
      quarter,
      amount: sql<string>`sum(${supplierInvoice.totalAmount})`,
    })
    .from(supplierInvoice)
    .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
    .where(and(
      supplierInvoiceFiscalFilter(companyId, start, endExclusive, timeZone),
      eq(partner.countryCode, "ES"),
      sql`${supplierInvoice.retentionAmount} = 0`,
    ))
    .groupBy(partner.taxId, partner.name, quarter);

  return groupThirdPartyOperations("supplier", rows);
}

/** El 347 informa aparte de los importes percibidos en metálico de un mismo tercero por encima de este límite. */
export const CASH_COLLECTION_THRESHOLD = 6000;

/** Suma por NIF y deja los que superan 6.000 € cobrados en metálico en el año (función pura). */
export function groupCashCollections(rows: Array<{ taxId: string | null; name: string; amount: string | number }>) {
  const groups = new Map<string, number>();
  for (const row of rows) {
    const key = normalizeThirdPartyTaxId(row.taxId) || `sin-nif:${row.name}`;
    groups.set(key, (groups.get(key) ?? 0) + toCents(row.amount));
  }
  return new Map([...groups].filter(([, cents]) => cents > toCents(CASH_COLLECTION_THRESHOLD)).map(([key, cents]) => [key, centsToNumber(cents)]));
}

/**
 * Cobros en metálico del año por cliente: cobros registrados con una forma de pago de tipo
 * «Efectivo», por su fecha de cobro. Solo cuentan los cobros anotados en el programa con su forma
 * de pago; un cobro sin forma de pago no se puede clasificar.
 */
async function fetchCashCollections(companyId: string, range: InstantRange) {
  const rows = await db
    .select({
      taxId: partner.taxId,
      partnerName: partner.name,
      customerName: customer.name,
      amount: sql<string>`sum(${payment.amount})`,
    })
    .from(payment)
    .innerJoin(paymentMethod, eq(paymentMethod.id, payment.paymentMethodId))
    .innerJoin(invoice, eq(invoice.id, payment.invoiceId))
    .innerJoin(customer, eq(customer.id, invoice.customerId))
    .leftJoin(partner, eq(partner.id, customer.partnerId))
    .where(and(
      eq(payment.companyId, companyId),
      eq(paymentMethod.type, "CASH"),
      ne(invoice.status, "VOID"),
      gte(payment.postedAt, range.start),
      lt(payment.postedAt, range.endExclusive),
      sql`not (${customer.name} = ${GENERIC_POS_CUSTOMER_NAME} and coalesce(${partner.taxId}, '') = '')`,
    ))
    .groupBy(partner.taxId, partner.name, customer.name);
  return groupCashCollections(rows.map((row) => ({ taxId: row.taxId, name: row.partnerName ?? row.customerName, amount: row.amount })));
}

/** Saldos del periodo de 477, 472, 4751 y 473 (incluye subcuentas), sin asientos de cierre/apertura. */
export async function fetchAccountingTaxBalances(companyId: string, startBoundary: Date, endBoundary: Date, timeZone: string = FISCAL_TIME_ZONE_PENINSULA) {
  // Mismos límites en hora local que el cálculo fiscal, para que la conciliación compare lo mismo.
  const { start, endExclusive } = fiscalRangeInstants({ start: startBoundary, endExclusive: endBoundary }, timeZone);
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
  // Los periodos empiezan y acaban a medianoche local (península o Canarias), no a medianoche UTC.
  const timeZone = fiscalTimeZoneFor(profile.territory);
  const instants = fiscalRangeInstants(range, timeZone);
  const periodYear = range.start.getUTCFullYear();
  const yearStart = localMidnightInstant(periodYear, 0, 1, timeZone);
  // El 303 se carga desde el 1 de enero: hace falta el resultado de los periodos anteriores del
  // ejercicio para las cuotas a compensar y, en el último periodo, el volumen de operaciones del año.
  const loadRange: InstantRange = code === "303" ? { start: yearStart, endExclusive: instants.endExclusive } : instants;
  const filedPeriods = await loadFiledVatPeriods(companyId, timeZone);
  // Territorio de la empresa: tratamientos de facturas antiguas sin tratamiento guardado y tipo de
  // autorepercusión (7 % IGIC en Canarias).
  const [issuedLines, supplierLines, accountingBalances] = await Promise.all([
    fetchIssuedLines(companyId, loadRange.start, loadRange.endExclusive, { homeCountry: profile.territory, filedPeriods }),
    fetchSupplierLines(companyId, loadRange.start, loadRange.endExclusive, profile.territory),
    fetchAccountingTaxBalances(companyId, instants.start, instants.endExclusive, timeZone),
  ]);
  const selfAssessmentRate = standardVatRate(profile.territory);
  const issuedIn = (target: InstantRange) => computeIssuedVat(issuedLines.filter((line) => inInstantRange(line.accrualDate, target)));
  const supplierIn = (target: InstantRange) => computeSupplierVat(supplierLines.filter((line) => inInstantRange(supplierLinePeriodDate(line), target)), profile.prorrataPct, selfAssessmentRate);
  const issued = issuedIn(instants);
  const supplier = supplierIn(instants);

  // Devengo: facturas que se declaran en un periodo distinto del de su expedición. El asiento va con
  // la fecha de expedición, así que la conciliación con la 477 y la 473 se hace por expedición.
  const currentLines = issuedLines.filter((line) => inInstantRange(line.accrualDate, instants));
  const issuedHereLines = issuedLines.filter((line) => inInstantRange(line.issueDate, instants));
  const movedIn = currentLines.filter((line) => !inInstantRange(line.issueDate, instants));
  const movedOut = issuedHereLines.filter((line) => !inInstantRange(line.accrualDate, instants));
  const filedFallback = currentLines.filter((line) => line.accrualBasis === "issue-filed-period");
  const issuedByIssueDate = movedIn.length > 0 || movedOut.length > 0 ? computeIssuedVat(issuedHereLines) : issued;

  const canary = code === "420"
    ? buildModelo420(issued, supplier)
    : code === "425"
      ? buildModelo425(issued, supplier, profile.fiscalRegime)
      : code === "450"
        ? buildModelo450(await fetchAiemBuckets(companyId, instants.start, instants.endExclusive))
        : null;
  const totals = computeModelo303Totals(issued, supplier);

  // Resultado (casilla 46) de un periodo del ejercicio: el presentado si hay foto; si no, el calculado hoy.
  const periodResultCents = (key: string) => {
    const filed = filedPeriods.find((candidate) => candidate.code === "303" && candidate.period === key);
    if (filed && filed.filedResultCents !== null) return filed.filedResultCents;
    const target = parseSpanishFiscalPeriod(key, "303");
    if (!target) return 0;
    const targetRange = fiscalRangeInstants(target, timeZone);
    return computeModelo303Totals(issuedIn(targetRange), supplierIn(targetRange)).resultCents;
  };
  const openingCents = toCents(profile.vatCompensationOpening[String(periodYear)] ?? 0);
  const lastPeriod = code === "303" && isLastVatPeriodOfYear(period);
  const compensation = code === "303"
    ? computeModelo303Compensation({ openingCents, previousResultsCents: previousPeriodsOfYear(period).map(periodResultCents), resultCents: totals.resultCents })
    : null;
  const modelo303Boxes = buildModelo303Boxes(issued, supplier, {
    periodYear,
    compensation: compensation ?? undefined,
    yearIssued: lastPeriod ? issuedIn({ start: yearStart, endExclusive: instants.endExclusive }) : undefined,
  });
  const annualPeriods = profile.taxPeriodicity === "monthly"
    ? Array.from({ length: 12 }, (_, index) => `${periodYear}-${String(index + 1).padStart(2, "0")}`)
    : [1, 2, 3, 4].map((quarter) => `${periodYear}-Q${quarter}`);
  const annualSummaryBoxes = code === "390"
    ? buildModelo390Summary(issued, supplier, { openingCents, periodResults: annualPeriods.map((key) => ({ period: key, resultCents: periodResultCents(key) })) })
    : undefined;

  const dueDate = getSpanishFiscalDueDate(period, code);
  const directDebitDate = getSpanishFiscalDirectDebitDate(period, code);
  let thirdPartyOperations: ThirdPartyOperation[] | undefined;
  if (code === "347") {
    const [customers, suppliers, cash] = await Promise.all([
      fetchThirdPartyOperations(companyId, instants.start, instants.endExclusive, timeZone),
      fetchSupplierThirdPartyOperations(companyId, instants.start, instants.endExclusive, timeZone),
      fetchCashCollections(companyId, instants),
    ]);
    thirdPartyOperations = [
      ...customers.map((row) => {
        const cashAmount = cash.get(row.taxId === "Sin NIF" ? `sin-nif:${row.name}` : row.taxId);
        return cashAmount === undefined ? row : { ...row, cashAmount };
      }),
      ...suppliers,
    ].sort((left, right) => right.amount - left.amount);
  }

  const modelo349 = code === "349" ? await fetchModelo349(companyId, instants, period, timeZone, filedPeriods) : undefined;
  const modelo130 = code === "130" ? await fetchModelo130(companyId, instants, periodYear, profile.prorrataPct, timeZone, filedPeriods) : undefined;

  const practicedWithholdings = code === "111" ? supplier.professional : code === "115" ? supplier.rent : mergeBuckets(supplier.professional, supplier.rent);
  const allPracticed = mergeBuckets(supplier.professional, supplier.rent);
  const sum = (map: Map<number, { base: number; tax: number }>) => [...map.values()].reduce((acc, bucket) => ({ base: acc.base + bucket.base, tax: acc.tax + bucket.tax }), { base: 0, tax: 0 });
  const practicedTotals = sum(practicedWithholdings);
  const allPracticedTotals = sum(allPracticed);
  const salesWithholdingTotals = sum(issued.withholdings);
  const outputVatTotals = sum(issued.vat);
  const inputTotals = sum(supplier.input);

  const ledgerTotals = issuedByIssueDate === issued ? totals : computeModelo303Totals(issuedByIssueDate, supplier);
  const outputVatReconciliation = reconcile(centsToNumber(ledgerTotals.accruedCents), accountingBalances.outputVat);
  const inputVatReconciliation = reconcile(centsToNumber(totals.deductibleCents), accountingBalances.inputVat);
  const withholdingReconciliation = reconcile(centsToNumber(allPracticedTotals.tax), accountingBalances.withholdings);
  const salesWithholdingReconciliation = reconcile(centsToNumber(sum(issuedByIssueDate.withholdings).tax), accountingBalances.salesWithholdings);
  const accountingBalanced = [outputVatReconciliation, inputVatReconciliation, withholdingReconciliation, salesWithholdingReconciliation]
    .every((line) => Math.abs(line.difference) < 0.005);
  const dueStatus = dueDate ? getFiscalDueStatus(dueDate) : null;
  const buckets = bucketsToNumbers(issued.vat);
  const inputBuckets = bucketsToNumbers(supplier.input);

  const automationChecks = buildAutomationChecks({
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
  });
  const invoiceCount = (lines: IssuedFiscalLine[]) => new Set(lines.map((line) => line.invoiceId)).size;
  const usesAccrual = code === "303" || code === "390" || code === "349" || code === "130" || code === "420" || code === "425";
  if (usesAccrual && (movedIn.length > 0 || movedOut.length > 0)) {
    automationChecks.push({
      code: "accrual-shift",
      status: "warning",
      title: "Facturas declaradas por su fecha de operación",
      detail: `${invoiceCount(movedIn)} factura(s) expedidas en otro periodo se declaran aquí porque su fecha de operación cae en este, y ${invoiceCount(movedOut)} expedida(s) en este periodo se declaran en otro anterior. El IVA se devenga cuando se hace la operación, no cuando se factura.`,
      action: "La conciliación con las cuentas 477 y 473 se hace por fecha de expedición, que es la fecha del asiento: por eso su importe puede no coincidir con la casilla 27. Revisa la fecha de operación de esas facturas.",
    });
  }
  if (usesAccrual && filedFallback.length > 0) {
    const periods = [...new Set(filedFallback.map((line) => `${line.filedPeriod?.code} ${line.filedPeriod?.period}`))].join(", ");
    automationChecks.push({
      code: "accrual-filed-period",
      status: "warning",
      title: "Fecha de operación en un periodo ya presentado",
      detail: `${invoiceCount(filedFallback)} factura(s) tienen la fecha de operación en un periodo ya presentado (${periods}) y se emitieron después de presentarlo. Para no alterar ese modelo se han incluido aquí, en el periodo de expedición.`,
      action: "Lo correcto es una autoliquidación complementaria del periodo de la operación: reabre aquel modelo para recalcularlo, o corrige la fecha de operación si era un error.",
    });
  }
  if (compensation && lastPeriod && compensation.carryForwardCents > 0) {
    automationChecks.push({
      code: "model-303-refund-option",
      status: "warning",
      title: "Último periodo del año con saldo a tu favor",
      detail: `Quedan ${centsToNumber(compensation.carryForwardCents).toFixed(2)} € a tu favor al cerrar el ejercicio (lo generado en este periodo más la casilla 87).`,
      action: `En el último periodo puedes pedir la devolución (casilla 73) en vez de dejarlo a compensar (casilla 72): el programa no elige por ti. Si lo dejas a compensar, anótalo como saldo inicial de ${periodYear + 1} en Configuración › Fiscalidad.`,
    });
  }
  const cashThirdParties = thirdPartyOperations?.filter((operation) => operation.cashAmount !== undefined) ?? [];
  if (cashThirdParties.length > 0) {
    automationChecks.push({
      code: "model-347-cash",
      status: "warning",
      title: "Cobros en metálico de más de 6.000 €",
      detail: `${cashThirdParties.length} cliente(s) te han pagado en efectivo más de ${CASH_COLLECTION_THRESHOLD.toLocaleString("es-ES")} € en el año: ${cashThirdParties.slice(0, 5).map((operation) => operation.name).join(", ")}.`,
      action: "Declara ese importe en la casilla de «importe percibido en metálico» del 347 y recuerda el límite de pagos en efectivo de 1.000 € entre empresarios (Ley 7/2012).",
    });
  }

  return {
    code,
    modelName: model.name,
    periodLabel: range.label,
    dueDate: dueDate?.toISOString() ?? null,
    directDebitDate: directDebitDate?.toISOString() ?? null,
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
    vatSettlement: compensation
      ? {
          openingAmount: centsToNumber(openingCents),
          pendingBefore: centsToNumber(compensation.pendingBeforeCents),
          applied: centsToNumber(compensation.appliedCents),
          pendingAfter: centsToNumber(compensation.pendingAfterCents),
          result: centsToNumber(compensation.resultCents),
          carryForward: centsToNumber(compensation.carryForwardCents),
          lastPeriod,
        }
      : undefined,
    amountDue: canary
      ? centsToNumber(canary.resultCents)
      : code === "303" && compensation
        ? centsToNumber(compensation.resultCents)
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
    annualSummaryBoxes,
    canaryBoxes: canary?.boxes,
    automationChecks,
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

/**
 * AIEM repercutido en las facturas emitidas del periodo, por tipo: impuestos de clase "Otro"
 * cuyo nombre empieza por "AIEM" (los que crea la configuración fiscal de Canarias).
 */
export async function fetchAiemBuckets(companyId: string, start: Date, endExclusive: Date, timeZone: string = FISCAL_TIME_ZONE_CANARY): Promise<AiemBucket[]> {
  const rows = await db
    .select({
      rate: invoiceLineTax.rate,
      base: sql<string>`coalesce(sum(${invoiceLineTax.baseAmount}), 0)`,
      amount: sql<string>`coalesce(sum(${invoiceLineTax.amount}), 0)`,
    })
    .from(invoiceLineTax)
    .innerJoin(invoiceLine, eq(invoiceLine.id, invoiceLineTax.invoiceLineId))
    .innerJoin(invoice, eq(invoice.id, invoiceLine.invoiceId))
    .where(and(issuedInvoiceFiscalFilter(companyId, start, endExclusive, timeZone), eq(invoiceLineTax.kind, "OTHER"), eq(invoiceLineTax.operation, "ADD"), sql`upper(${invoiceLineTax.name}) LIKE 'AIEM%'`))
    .groupBy(invoiceLineTax.rate);
  return rows.map((row) => ({ rate: toNumber(row.rate), baseCents: toCents(row.base), taxCents: toCents(row.amount) }));
}

export type VatRegisterRow = {
  id: string;
  issueDate: string;
  /** Fecha de registro (solo recibidas): determina el periodo de deducción. */
  registrationDate?: string;
  number: string;
  /** Número de factura del proveedor (solo recibidas). */
  supplierNumber: string | null;
  counterpartyName: string;
  counterpartyTaxId: string | null;
  vatTreatment: string | null;
  taxBase: number;
  /** Expedidas: IVA repercutido. Recibidas: IVA deducible (el que computa en el 303). */
  taxAmount: number;
  /** Recibidas: cuota de IVA soportada según la factura. */
  chargedTaxAmount?: number;
  withholdingAmount: number;
  totalAmount: number;
};

/**
 * Libros registro de IVA (facturas expedidas y recibidas) del periodo, con los mismos filtros y
 * los mismos importes que el modelo 303 (sin anuladas ni borradores del ciclo de emisión).
 */
export async function loadVatRegisters(companyId: string, start: Date, endExclusive: Date): Promise<{ issued: VatRegisterRow[]; received: VatRegisterRow[] }> {
  const profile = await fetchFiscalAutomationProfile(companyId);
  // Sin territorio para los tratamientos (como hasta ahora), pero con la hora local de la empresa.
  const timeZone = fiscalTimeZoneFor(profile.territory);
  const [issued, supplier] = await Promise.all([
    fetchIssuedInvoiceVat(companyId, start, endExclusive, undefined, timeZone),
    fetchSupplierInvoiceVat(companyId, start, endExclusive, profile.prorrataPct, undefined, timeZone),
  ]);
  const issuedIds = issued.documents.map((document) => document.id);
  const receivedIds = [...new Set(supplier.documents.map((document) => document.sourceId ?? document.id))];
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
    received: supplier.documents.map((document) => {
      const source = supplierById.get(document.sourceId ?? document.id);
      return {
        id: document.id,
        issueDate: document.issueDate,
        registrationDate: document.registrationDate ?? document.issueDate,
        number: document.number,
        supplierNumber: source?.supplierNumber ?? null,
        counterpartyName: source?.name ?? "",
        counterpartyTaxId: source?.taxId ?? null,
        vatTreatment: document.vatTreatment ?? null,
        taxBase: document.taxBase,
        taxAmount: document.taxAmount,
        chargedTaxAmount: document.chargedTaxAmount ?? document.taxAmount,
        withholdingAmount: document.withholdingAmount ?? 0,
        totalAmount: document.totalAmount,
      };
    }).sort((left, right) => (left.registrationDate ?? left.issueDate).localeCompare(right.registrationDate ?? right.issueDate) || left.number.localeCompare(right.number)),
  };
}
