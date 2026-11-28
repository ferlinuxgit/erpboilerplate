import { and, eq, gte, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";

import { buildModelo420, buildModelo425, buildModelo450, type AiemBucket } from "@/server/fiscal/canarias-calc";
import { igicExemptRegime } from "@/lib/country-packs/igic";
import { getCompanyTaxTerritory } from "@/server/company/fiscal-context";
import { standardVatRate } from "@/lib/country-packs/vat-rates";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";

import { accountChart, companySettings, customer, fiscalReport, invoice, invoiceLine, invoiceLineTax, invoicePayment, item, journalEntry, journalLine, partner, payment, paymentMethod, supplierInvoice, supplierInvoiceLine, supplierInvoicePayment, supplierPayment } from "@/db/schema";
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
  isSelfAssessedTreatment,
  isSpanishFiscalModelCode,
  localMidnightInstant,
  normalizeTaxpayerType,
  previousPeriodsOfYear,
  parseSpanishFiscalPeriod,
  isIntraEuSalesTreatment,
  resolveSalesVatTreatment,
  resolveSupplierVatTreatment,
  reverseChargeTaxAmount,
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
  modelo349RequiresMonthly,
  MODELO_349_MONTHLY_THRESHOLD,
  type Modelo303Adjustments,
  type Modelo303CashInfo,
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
import { expandIssuedLinesForCash, expandSupplierLinesForCash, resolveCashAccrualEvents, type CashMovement } from "@/server/fiscal/cash-accounting";
import {
  computeFinalProrrata,
  computeInvestmentGoodsRegularization,
  computeProrrataRegularization,
  normalizeVatProrataFinal,
  type InvestmentGoodInput,
} from "@/server/fiscal/prorrata";
import { readFiledSnapshot } from "@/server/fiscal/snapshot";
import { isValidSpanishTaxId } from "@/lib/spanish-tax-id";
import { lineBaseCents } from "@/server/taxation/engine";
import { DRAFT_NUMBER_PREFIX } from "@/server/invoices/lifecycle";
import { isWithholdingModelCode } from "@/server/fiscal/withholdings";
import { loadWithholdingModel, sumPayrollLedgerWithholdings, type WithholdingModelSummary } from "@/server/payroll/withholding-data";

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
  /**
   * Criterio de caja (solo 303 y 390 calculados con soporte del régimen; las fotos antiguas no lo
   * llevan). `ownRegime`: la empresa está acogida y devenga al cobro; si no, solo se difieren las
   * facturas recibidas de proveedores acogidos. Importes según la regla general de devengo.
   */
  cashAccounting?: {
    ownRegime: boolean;
    /** Casillas 62 y 63. */
    salesBase: number;
    salesTax: number;
    /** Casillas 74 y 75. */
    purchaseBase: number;
    purchaseTax: number;
    /** Facturas que se devengan o deducen en el periodo por llegar el 31 de diciembre del año siguiente sin cobro o pago. */
    deadlineSalesInvoices: number;
    deadlinePurchaseInvoices: number;
  };
  /** Prorrata definitiva y regularizaciones del último periodo (303 del 4T o mes 12, y 390). */
  prorrata?: FiscalProrrataSummary;
  /** Modelo 349 (solo en ese modelo). */
  modelo349?: Modelo349Result;
  /** Modelo 130 (solo en ese modelo). */
  modelo130?: Modelo130Result;
  /** Modelos de retenciones (111, 115, 123, 190, 180 y 193): casillas, perceptores y cuadre anual. */
  withholdingModel?: WithholdingModelSummary;
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

export type FiscalProrrataSummary = {
  year: number;
  /** Prorrata provisional configurada (la que se aplica al registrar las facturas). */
  provisionalPct: number;
  /** Porcentaje definitivo calculado con las operaciones del año (null si no hubo operaciones). */
  computedPct: number | null;
  /** Total de operaciones del año y parte con derecho a deducción (art. 104 LIVA). */
  totalOperations: number;
  deductibleOperations: number;
  exemptOperations: number;
  /** Porcentaje definitivo confirmado por el usuario; null mientras no lo confirme. */
  confirmedPct: number | null;
  /** Casilla 44 aplicada (solo con porcentaje confirmado). */
  regularizationAmount: number | null;
  /** Lo que resultaría en la casilla 44 con el porcentaje calculado, mientras no se confirme. */
  previewRegularizationAmount: number | null;
  /** Casilla 43 aplicada (solo con porcentaje confirmado). */
  investmentRegularizationAmount: number | null;
  /** Bienes de inversión todavía en periodo de regularización. */
  investmentGoods: Array<{
    number: string;
    description: string;
    purchaseYear: number;
    base: number;
    tax: number;
    purchasePct: number;
    purchasePctConfirmed: boolean;
    years: number;
    yearNumber: number;
    differencePoints: number;
    regularizationAmount: number;
  }>;
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
  /** Porcentaje definitivo de prorrata confirmado por ejercicio ("2026" → 83). Las fotos antiguas no lo llevan. */
  vatProrataFinal?: Record<string, number>;
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
    warnings.push("El Modelo 111 suma las retenciones de las nóminas contabilizadas (rendimientos del trabajo) y las de las facturas recibidas de profesionales (actividades económicas; los alquileres, cuenta 621, van al 115). No calcula premios, ganancias forestales ni cesión de derechos de imagen: esas casillas salen a cero.");
  }
  if (code === "115") {
    warnings.push("El Modelo 115 toma las retenciones de facturas recibidas cuyo gasto está en la cuenta 621 (arrendamientos). Revisa que los alquileres usen esa cuenta.");
  }
  if (code === "190") {
    warnings.push("El 190 lista a empleados (clave A) y administradores (clave E) de las nóminas, y a los profesionales de las facturas recibidas con retención (clave G: subclave 03 si el tipo es el 7 %, 01 en otro caso). No distingue otras claves (F, H, I, L…) ni guarda hijos, ascendientes, reducciones o gastos deducibles de la clave A.");
  }
  if (code === "180") {
    warnings.push("El 180 toma los arrendadores de las facturas recibidas con retención y gasto en la cuenta 621, y el inmueble de Nóminas y retenciones › Inmuebles alquilados. Genera un registro por arrendador, no por inmueble.");
  }
  if (code === "123") {
    warnings.push("El 123 sale de los dividendos e intereses registrados en Nóminas y retenciones › Dividendos e intereses. No calcula la periodificación (casillas 10 y 11).");
  }
  if (code === "193") {
    warnings.push("El 193 declara los dividendos con clave A y naturaleza 02, y los intereses de préstamos con clave B y naturaleza 03. No contempla la clave D (préstamos de socios vinculados por el exceso sobre el triple de los fondos propios) ni otras naturalezas.");
  }
  if (code === "303") {
    warnings.push("Las cuotas a compensar (casillas 110, 78 y 87) salen de encadenar los resultados de los periodos anteriores del ejercicio (el presentado, si el modelo guarda su foto; si no, el calculado hoy) más el saldo de ejercicios anteriores de Configuración › Fiscalidad. Se supone que los resultados negativos se dejaron a compensar, sin pedir devolución.");
  }
  if (code === "390") {
    warnings.push("Las casillas siguen la numeración del modelo 390 del ejercicio 2025 y siguientes (instrucciones y diseño de registro de la AEAT). Solo aparecen las que el programa calcula: no incluye operaciones intragrupo, regímenes especiales (simplificado, agricultura, bienes usados, agencias de viajes), créditos incobrables, tributación por territorios, devoluciones mensuales ni el detalle por actividades. Un importe marcado «REV» no tiene casilla vigente y hay que revisarlo a mano.");
  }
  if (code === "347") {
    warnings.push("El 347 excluye operaciones con retención (se declaran en 190/180), operaciones con el extranjero (349) y los envíos de bienes entre la Península o Baleares y Canarias, Ceuta o Melilla (facturas con tratamiento de exportación o importación; art. 33.2 RGAT). Los importes van por trimestres naturales. Las operaciones con inversión del sujeto pasivo, en criterio de caja y los posibles arrendamientos de local (gasto en la cuenta 621) salen en fila aparte, porque el modelo las pide en registro separado. No distingue operaciones de seguros, anticipos ni transmisiones de inmuebles; los cobros en metálico solo se detectan si el cobro está registrado con una forma de pago en efectivo.");
  }
  if (code === "349") {
    warnings.push("El 349 incluye facturas con tratamiento intracomunitario. En ventas, «Servicios a empresa de la UE» va con clave S; una «Entrega intracomunitaria» va con clave E (bienes) salvo las líneas con un artículo marcado como servicio. En compras, la cuenta 62x indica servicio. No comprueba los NIF-IVA en el censo VIES. No asigna las claves T (operaciones triangulares), M y H (entregas tras una importación exenta) ni R, D y C (ventas en consigna): el programa no tiene datos que las distingan; si haces esas operaciones, cambia la clave al presentar.");
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
      vatProrataFinal: companySettings.vatProrataFinal,
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
    vatProrataFinal: normalizeVatProrataFinal(settings?.vatProrataFinal),
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
    // La factura que sustituye a una simplificada (canje, F3) no vuelve a computar: su base e
    // IVA ya se declararon con la simplificada.
    eq(invoice.isSubstitutive, false),
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
  /** La foto se calculó ya con soporte del criterio de caja (difería las facturas de proveedores acogidos). */
  cashAware?: boolean;
  /** La foto se calculó con la empresa en criterio de caja (devengo al cobro). */
  cashOwn?: boolean;
};

/** Periodos de IVA/IGIC presentados de la empresa (303, 390, 420 y 425), con sus límites en hora local. */
export async function loadFiledVatPeriods(companyId: string, timeZone: string): Promise<FiledVatPeriodRow[]> {
  const rows = await db
    .select({
      code: fiscalReport.code,
      period: fiscalReport.period,
      snapshotAt: fiscalReport.filedSnapshotAt,
      filedResult: sql<string | null>`${fiscalReport.filedSnapshot} -> 'summary' ->> 'settlementAmount'`,
      cashOwn: sql<string | null>`${fiscalReport.filedSnapshot} -> 'summary' -> 'cashAccounting' ->> 'ownRegime'`,
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
      cashAware: row.cashOwn !== null && row.cashOwn !== undefined,
      cashOwn: row.cashOwn === "true",
    }];
  });
}

type IssuedFiscalLine = IssuedLineInput & {
  rectifiedInvoiceId?: string | null;
  cashReason?: string;
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
      rectifiedInvoiceId: invoice.rectifiedInvoiceId,
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
  // Criterio de caja: el tramo se deduce en la fecha de su pago.
  if (line.deductionDate) return line.deductionDate;
  return (line.sign === -1 ? line.voidedAt : null) ?? line.accountingDate ?? line.issueDate;
}

/**
 * Cobros aplicados a facturas emitidas (`invoice_payment`, con la fecha del cobro), por factura.
 * Es la misma tabla con la que el programa calcula el saldo pendiente de una factura.
 */
async function fetchInvoiceCollections(companyId: string, invoiceIds: string[]) {
  const result = new Map<string, CashMovement[]>();
  for (let offset = 0; offset < invoiceIds.length; offset += ID_BATCH_SIZE) {
    const rows = await db
      .select({ invoiceId: invoicePayment.invoiceId, amount: invoicePayment.amountApplied, date: payment.postedAt })
      .from(invoicePayment)
      .innerJoin(payment, eq(payment.id, invoicePayment.paymentId))
      .where(and(eq(invoicePayment.companyId, companyId), inArray(invoicePayment.invoiceId, invoiceIds.slice(offset, offset + ID_BATCH_SIZE))));
    for (const row of rows) result.set(row.invoiceId, [...(result.get(row.invoiceId) ?? []), { date: row.date, amount: row.amount }]);
  }
  return result;
}

/** Pagos aplicados a facturas recibidas (`supplier_invoice_payment`, con la fecha del pago), por factura. */
async function fetchSupplierInvoicePayments(companyId: string, invoiceIds: string[]) {
  const result = new Map<string, CashMovement[]>();
  for (let offset = 0; offset < invoiceIds.length; offset += ID_BATCH_SIZE) {
    const rows = await db
      .select({ invoiceId: supplierInvoicePayment.supplierInvoiceId, amount: supplierInvoicePayment.amountApplied, date: supplierPayment.postedAt })
      .from(supplierInvoicePayment)
      .innerJoin(supplierPayment, eq(supplierPayment.id, supplierInvoicePayment.supplierPaymentId))
      .where(and(eq(supplierInvoicePayment.companyId, companyId), inArray(supplierInvoicePayment.supplierInvoiceId, invoiceIds.slice(offset, offset + ID_BATCH_SIZE))));
    for (const row of rows) result.set(row.invoiceId, [...(result.get(row.invoiceId) ?? []), { date: row.date, amount: row.amount }]);
  }
  return result;
}

/** ¿Hay alguna factura recibida marcada como de proveedor en criterio de caja? (consulta barata). */
async function hasCashAccountingSupplierInvoices(companyId: string) {
  const rows = await db
    .select({ id: supplierInvoice.id })
    .from(supplierInvoice)
    .where(and(eq(supplierInvoice.companyId, companyId), eq(supplierInvoice.supplierCashAccounting, true)))
    .limit(1);
  return rows.length > 0;
}

/** Cuentas de terrenos y edificaciones (inmovilizado material e inversiones inmobiliarias): regularización en diez años. */
function isRealEstateAccount(code: string | null | undefined) {
  return /^(210|211|220|221)/.test(code ?? "");
}

/**
 * Bienes de inversión comprados en los nueve años anteriores a `year` (líneas marcadas como bien de
 * inversión o con cuenta del grupo 2), para la regularización de los arts. 107 a 109 LIVA.
 */
async function fetchInvestmentGoods(companyId: string, year: number, timeZone: string, homeCountry: string | null, selfAssessmentRate: number): Promise<InvestmentGoodInput[]> {
  const rows = await db
    .select({
      invoiceId: supplierInvoice.id,
      number: supplierInvoice.number,
      description: supplierInvoiceLine.description,
      accountingDate: supplierInvoice.accountingDate,
      subtotal: supplierInvoiceLine.subtotalAmount,
      taxAmount: supplierInvoiceLine.taxAmount,
      taxDeductiblePct: supplierInvoiceLine.taxDeductiblePct,
      prorrataPct: supplierInvoice.prorrataPct,
      vatTreatment: supplierInvoice.vatTreatment,
      countryCode: partner.countryCode,
      accountCode: accountChart.code,
    })
    .from(supplierInvoiceLine)
    .innerJoin(supplierInvoice, eq(supplierInvoiceLine.supplierInvoiceId, supplierInvoice.id))
    .leftJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
    .leftJoin(accountChart, eq(accountChart.id, supplierInvoiceLine.expenseAccountId))
    .where(and(
      eq(supplierInvoice.companyId, companyId),
      notInArray(supplierInvoice.status, ["VOID", "DRAFT"]),
      gte(supplierInvoice.accountingDate, localMidnightInstant(year - 9, 0, 1, timeZone)),
      lt(supplierInvoice.accountingDate, localMidnightInstant(year, 0, 1, timeZone)),
      or(eq(supplierInvoiceLine.isInvestmentGood, true), sql`${accountChart.code} like '2%'`),
    ));
  return rows.map((row) => {
    const treatment = resolveSupplierVatTreatment(row.vatTreatment, row.countryCode, null, homeCountry);
    const vat = isSelfAssessedTreatment(treatment) ? reverseChargeTaxAmount(toNumber(row.subtotal), toNumber(row.taxAmount), selfAssessmentRate) : toNumber(row.taxAmount);
    return {
      invoiceId: row.invoiceId,
      number: row.number,
      description: row.description,
      purchaseYear: fiscalCivilDate(row.accountingDate, timeZone).year,
      baseCents: toCents(row.subtotal),
      vatCents: toCents(vat),
      deductiblePct: clampPct(toNumber(row.taxDeductiblePct ?? 100)),
      appliedProrrataPct: clampPct(toNumber(row.prorrataPct ?? 100)),
      realEstate: isRealEstateAccount(row.accountCode),
    };
  });
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
    documentKind: supplierInvoice.documentKind,
    rectifiedInvoiceId: supplierInvoice.rectifiedInvoiceId,
    operationDate: supplierInvoice.operationDate,
    supplierCashAccounting: supplierInvoice.supplierCashAccounting,
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

type Modelo349DatedEntry = Modelo349Entry & { date: Date };

/**
 * Operaciones intracomunitarias de un rango: facturas emitidas (por fecha de devengo, como la
 * casilla 59 del 303) y recibidas (por fecha de registro). Una rectificativa de una factura de otro
 * periodo lleva `rectifiesPeriod` con el periodo original.
 */
async function collectModelo349Entries(
  companyId: string,
  range: InstantRange,
  period: string,
  timeZone: string,
  filedPeriods: FiledVatPeriod[],
  options: { salesOnly?: boolean } = {},
): Promise<Modelo349DatedEntry[]> {
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

  const entries: Modelo349DatedEntry[] = [];
  for (const line of salesLines) {
    const accrualDate = resolveAccrualDate(line, filedPeriods).date;
    if (!inInstantRange(accrualDate, range)) continue;
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
      date: accrualDate,
    });
  }
  if (options.salesOnly) return entries;

  const originalSupplier = alias(supplierInvoice, "original_supplier_invoice");
  const purchaseLines = await db
    .select({
      subtotal: supplierInvoiceLine.subtotalAmount,
      expenseAccountCode: accountChart.code,
      vatTreatment: supplierInvoice.vatTreatment,
      documentKind: supplierInvoice.documentKind,
      accountingDate: supplierInvoice.accountingDate,
      rectifiedIssueDate: supplierInvoice.rectifiedIssueDate,
      originalAccountingDate: originalSupplier.accountingDate,
      name: partner.name,
      taxId: partner.taxId,
      countryCode: partner.countryCode,
    })
    .from(supplierInvoiceLine)
    .innerJoin(supplierInvoice, eq(supplierInvoiceLine.supplierInvoiceId, supplierInvoice.id))
    .leftJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
    .leftJoin(accountChart, eq(accountChart.id, supplierInvoiceLine.expenseAccountId))
    .leftJoin(originalSupplier, eq(originalSupplier.id, supplierInvoice.rectifiedInvoiceId))
    .where(supplierInvoiceFiscalFilter(companyId, range.start, range.endExclusive, timeZone));
  for (const line of purchaseLines) {
    if (resolveSupplierVatTreatment(line.vatTreatment, line.countryCode) !== "INTRA_EU") continue;
    // Rectificativa recibida de una adquisición de otro periodo: se declara como rectificación de aquel.
    const originalDate = line.documentKind === "RECTIFICATION" ? line.originalAccountingDate ?? line.rectifiedIssueDate ?? null : null;
    entries.push({
      key: modelo349Key("purchase", isServiceExpenseAccount(line.expenseAccountCode)),
      operatorName: line.name ?? "Proveedor",
      operatorTaxId: line.taxId,
      countryCode: line.countryCode,
      baseCents: toCents(line.subtotal),
      rectifiesPeriod: originalDate && !inInstantRange(originalDate, range) ? periodOf(originalDate, period, timeZone) : null,
      date: line.accountingDate ?? range.start,
    });
  }
  return entries;
}

/** Entregas de bienes y prestaciones de servicios (claves E y S): lo que cuenta para el umbral del art. 81.2 RIVA. */
function modelo349DeliveriesCents(entries: Modelo349Entry[]) {
  return entries.reduce((total, entry) => total + (entry.key === "E" || entry.key === "S" ? entry.baseCents : 0), 0);
}

/**
 * Modelo 349: facturas emitidas y recibidas con tratamiento intracomunitario, agrupadas por NIF-IVA y clave.
 *
 * - Rectificaciones: el modelo pide la «base imponible declarada anteriormente» y la «base imponible
 *   rectificada» (el total correcto del operador en el periodo que se corrige, no la diferencia). Lo
 *   declarado se toma de la foto del 349 presentado de aquel periodo; si no hay foto, se recalcula
 *   con los datos actuales de aquel periodo. No tiene en cuenta otras rectificaciones del mismo
 *   periodo presentadas entre medias.
 * - Umbral (art. 81.2 RIVA): en un 349 trimestral se comprueba si las entregas y servicios del
 *   trimestre o de alguno de los cuatro anteriores superan 50.000 €.
 */
async function fetchModelo349(companyId: string, range: InstantRange, period: string, timeZone: string, filedPeriods: FiledVatPeriod[]): Promise<Modelo349Result> {
  const entries = await collectModelo349Entries(companyId, range, period, timeZone, filedPeriods);
  const result = computeModelo349(entries);

  const originalPeriods = [...new Set(result.rectifications.map((row) => row.originalPeriod))];
  if (originalPeriods.length > 0) {
    const filedReports = await db
      .select({ period: fiscalReport.period, status: fiscalReport.status, filedSnapshot: fiscalReport.filedSnapshot })
      .from(fiscalReport)
      .where(and(eq(fiscalReport.companyId, companyId), eq(fiscalReport.code, "349"), inArray(fiscalReport.period, originalPeriods)));
    const declared = new Map<string, Map<string, number>>();
    for (const originalPeriod of originalPeriods) {
      const report = filedReports.find((row) => row.period === originalPeriod && row.status === "FILED");
      let operators = report ? readFiledSnapshot(report.filedSnapshot)?.modelo349?.operators : undefined;
      if (!operators) {
        const originalRange = parseSpanishFiscalPeriod(originalPeriod, "349");
        if (!originalRange) continue;
        const originalEntries = await collectModelo349Entries(companyId, fiscalRangeInstants(originalRange, timeZone), originalPeriod, timeZone, filedPeriods);
        operators = computeModelo349(originalEntries).operators;
      }
      declared.set(originalPeriod, new Map(operators.map((operator) => [`${operator.key}|${operator.taxId}`, toCents(operator.amount)])));
    }
    result.rectifications = result.rectifications.map((row) => {
      const previousCents = declared.get(row.originalPeriod)?.get(`${row.key}|${row.taxId}`);
      if (previousCents === undefined) return row;
      return { ...row, previousAmount: centsToNumber(previousCents), rectifiedAmount: centsToNumber(previousCents + toCents(row.amount)) };
    });
    const unmatched = result.rectifications.filter((row) => row.previousAmount === undefined);
    if (unmatched.length > 0) {
      result.issues.push({
        code: "model-349-rectification-original",
        message: `${unmatched.length} rectificación(es) corrigen un periodo en el que ese operador no figura con esa clave: ${unmatched.slice(0, 5).map((row) => `${row.name} (${row.originalPeriod})`).join(", ")}. Indica tú la base declarada anteriormente y la base rectificada.`,
      });
    }
  }

  const deliveriesCents = modelo349DeliveriesCents(entries);
  result.deliveriesAmount = centsToNumber(deliveriesCents);
  if (/-Q[1-4]$/.test(period.trim())) {
    const civil = fiscalCivilDate(range.start, timeZone);
    const previousStart = localMidnightInstant(civil.year, civil.month - 1 - 12, 1, timeZone);
    const previousEntries = await collectModelo349Entries(companyId, { start: previousStart, endExclusive: range.start }, period, timeZone, filedPeriods, { salesOnly: true });
    const byQuarter = new Map<string, number>();
    for (const entry of previousEntries) {
      if (entry.key !== "E" && entry.key !== "S") continue;
      const quarter = periodOf(entry.date, period, timeZone);
      byQuarter.set(quarter, (byQuarter.get(quarter) ?? 0) + entry.baseCents);
    }
    result.monthlyRequired = modelo349RequiresMonthly([deliveriesCents, ...byQuarter.values()]);
  }
  return result;
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
  /**
   * Marcas del 347 que obligan a declarar estas operaciones en un registro separado del mismo
   * tercero (diseño de registro del 347, Orden HAC/1431/2025). Sin marcas no hay campo.
   */
  flags?: ThirdPartyFlags;
  /**
   * Solo con la marca de criterio de caja: importe anual devengado conforme al régimen (lo cobrado
   * o pagado en el año, art. 163 terdecies LIVA). `amount` es el importe según la regla general.
   */
  cashAccrualAmount?: number;
};

export type ThirdPartyFlags = {
  /** Posible arrendamiento de local de negocio (compras con gasto en la cuenta 621 sin retención). */
  lease?: boolean;
  /** Operaciones en régimen especial del criterio de caja (del emisor o del destinatario). */
  cashAccounting?: boolean;
  /** Operaciones con inversión del sujeto pasivo (solo las declara el destinatario). */
  reverseCharge?: boolean;
};

function thirdPartyFlagKey(flags: ThirdPartyFlags | null | undefined) {
  return [flags?.lease ? "lease" : "", flags?.cashAccounting ? "cash" : "", flags?.reverseCharge ? "isp" : ""].filter(Boolean).join("+");
}

/** Clave que identifica a un tercero declarado (la misma que usa la agrupación). */
export function thirdPartyKey(operation: { taxId: string; name: string }) {
  return operation.taxId === "Sin NIF" ? `sin-nif:${operation.name}` : operation.taxId;
}

/**
 * Agrupa por NIF (una persona o entidad es un solo declarado aunque tenga varias fichas) y deja las
 * que superan 3.005,06 € en valor absoluto. Sin NIF no se puede agrupar: cada ficha va por separado.
 * `quarter` (1-4) reparte el importe por trimestres; sin él, todo queda sin repartir (ceros).
 *
 * El umbral se mira sobre el total del tercero. Si parte de sus operaciones lleva alguna marca
 * (`flags`: arrendamiento, criterio de caja, inversión del sujeto pasivo), esa parte sale en una
 * fila aparte, porque el modelo la pide en registro separado. Las operaciones en criterio de caja
 * se declaran en cómputo anual, sin desglose trimestral.
 */
export function groupThirdPartyOperations<T extends "customer" | "supplier">(
  type: T,
  rows: Array<{ taxId: string | null; name: string; amount: string | number; quarter?: number | null; flags?: ThirdPartyFlags | null }>,
): ThirdPartyOperation<T>[] {
  type Record = { flags: ThirdPartyFlags | null; cents: number; quarters: [number, number, number, number] };
  const groups = new Map<string, { taxId: string; name: string; cents: number; records: Map<string, Record> }>();
  for (const row of rows) {
    const taxId = normalizeThirdPartyTaxId(row.taxId);
    const key = taxId || `sin-nif:${row.name}`;
    const group = groups.get(key) ?? { taxId: taxId || "Sin NIF", name: row.name, cents: 0, records: new Map<string, Record>() };
    const flagKey = thirdPartyFlagKey(row.flags);
    const record = group.records.get(flagKey) ?? { flags: flagKey ? { ...row.flags } : null, cents: 0, quarters: [0, 0, 0, 0] };
    const cents = toCents(row.amount);
    group.cents += cents;
    record.cents += cents;
    const quarter = Math.trunc(Number(row.quarter));
    if (quarter >= 1 && quarter <= 4 && !record.flags?.cashAccounting) record.quarters[quarter - 1] += cents;
    group.records.set(flagKey, record);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) => Math.abs(centsToNumber(group.cents)) > THIRD_PARTY_THRESHOLD)
    .flatMap((group) => [...group.records.values()]
      .filter((record) => record.cents !== 0 || group.records.size === 1)
      .map((record) => ({
        type,
        taxId: group.taxId,
        name: group.name,
        amount: centsToNumber(record.cents),
        quarters: record.quarters.map((cents) => centsToNumber(cents)) as [number, number, number, number],
        ...(record.flags ? { flags: record.flags } : {}),
      })))
    .sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount));
}

/**
 * Añade a las filas en criterio de caja el importe anual devengado conforme al régimen. Si un
 * tercero no tiene fila de criterio de caja este año (todo lo cobrado o pagado es de facturas del
 * año anterior) y lo devengado supera 3.005,06 €, se añade una fila con importe anual cero.
 */
export function attachCashAccruals<T extends "customer" | "supplier">(
  type: T,
  operations: ThirdPartyOperation<T>[],
  accrued: Array<{ taxId: string | null; name: string; cents: number }>,
): ThirdPartyOperation<T>[] {
  const byKey = new Map<string, { taxId: string; name: string; cents: number }>();
  for (const row of accrued) {
    const taxId = normalizeThirdPartyTaxId(row.taxId);
    const key = taxId || `sin-nif:${row.name}`;
    const current = byKey.get(key) ?? { taxId: taxId || "Sin NIF", name: row.name, cents: 0 };
    current.cents += row.cents;
    byKey.set(key, current);
  }
  const used = new Set<string>();
  const result = operations.map((operation) => {
    if (!operation.flags?.cashAccounting) return operation;
    // Con varias filas de caja del mismo tercero (p. ej. también arrendamiento) el devengado va en la primera.
    const base = thirdPartyKey(operation);
    if (used.has(base)) return { ...operation, cashAccrualAmount: 0 };
    used.add(base);
    return { ...operation, cashAccrualAmount: centsToNumber(byKey.get(base)?.cents ?? 0) };
  });
  for (const [key, row] of byKey) {
    if (used.has(key) || Math.abs(centsToNumber(row.cents)) <= THIRD_PARTY_THRESHOLD) continue;
    result.push({ type, taxId: row.taxId, name: row.name, amount: 0, quarters: [0, 0, 0, 0], flags: { cashAccounting: true }, cashAccrualAmount: centsToNumber(row.cents) });
  }
  return result;
}

/** Trimestre natural (1-4) de una columna de fecha en la zona horaria fiscal (una de las dos constantes del sistema). */
function quarterOf(column: AnyPgColumn, timeZone: string) {
  const zone = timeZone === FISCAL_TIME_ZONE_CANARY ? FISCAL_TIME_ZONE_CANARY : FISCAL_TIME_ZONE_PENINSULA;
  return sql<number>`extract(quarter from (${column} at time zone ${sql.raw(`'${zone}'`)}))::int`;
}

/** Lo cobrado o pagado en el año de un documento en criterio de caja (céntimos), con el límite del 31-12 del año siguiente. */
function cashAccruedInRange(document: { operationDate: Date; totalAmount: string | number; notBefore?: Date | null }, movements: CashMovement[], range: InstantRange, timeZone: string) {
  const totalCents = toCents(document.totalAmount);
  return resolveCashAccrualEvents({ operationDate: document.operationDate, totalCents, movements, timeZone, notBefore: document.notBefore })
    .filter((event) => inInstantRange(event.date, range))
    .reduce((total, event) => total + Math.round(totalCents * event.to) - Math.round(totalCents * event.from), 0);
}

/**
 * Clientes españoles (> 3.005,06 €/año): sin anuladas, sin facturas con retención (van al 190), sin
 * el cliente genérico del TPV (ventas a consumidores no identificados, que no se declaran) y sin
 * las facturas con tratamiento de exportación a un cliente español (envíos a Canarias, Ceuta o
 * Melilla, art. 33.2.h RGAT). Con la empresa en criterio de caja, sus ventas nacionales llevan la
 * marca y el importe devengado según el régimen.
 */
async function fetchThirdPartyOperations(companyId: string, start: Date, endExclusive: Date, timeZone: string, options: { ownCash?: boolean } = {}) {
  const withholdingLine = sql`exists (select 1 from ${invoiceLine} il where il."invoiceId" = ${invoice.id} and il."retentionRate" > 0)`;
  const withholdingTax = sql`exists (select 1 from ${invoiceLineTax} ilt inner join ${invoiceLine} il2 on il2.id = ilt."invoiceLineId" where il2."invoiceId" = ${invoice.id} and ilt.operation = 'SUBTRACT')`;
  const quarter = quarterOf(invoice.issueDate, timeZone);
  const domestic = sql<boolean>`coalesce(${invoice.vatTreatment}, 'DOMESTIC') = 'DOMESTIC'`;
  const declarable = and(
    or(isNull(partner.countryCode), eq(partner.countryCode, "ES")),
    sql`coalesce(${invoice.vatTreatment}, '') <> 'EXPORT'`,
    sql`not ${withholdingLine}`,
    sql`not ${withholdingTax}`,
    sql`not (${customer.name} = ${GENERIC_POS_CUSTOMER_NAME} and coalesce(${partner.taxId}, '') = '')`,
  );
  const rows = await db
    .select({
      taxId: partner.taxId,
      partnerName: partner.name,
      customerName: customer.name,
      quarter,
      domestic,
      // Los suplidos (pagos por cuenta del cliente, art. 78.Tres.3.º LIVA) suman al total a pagar
      // pero no son operaciones del declarante: no entran en el 347.
      amount: sql<string>`sum(${invoice.totalAmount} - coalesce((select sum(il."lineTotal") from ${invoiceLine} il where il."invoiceId" = ${invoice.id} and il."isDisbursement"), 0))`,
    })
    .from(invoice)
    .innerJoin(customer, eq(customer.id, invoice.customerId))
    .leftJoin(partner, eq(partner.id, customer.partnerId))
    .where(and(issuedInvoiceFiscalFilter(companyId, start, endExclusive, timeZone), declarable))
    .groupBy(partner.taxId, partner.name, customer.name, quarter, domestic);

  const operations = groupThirdPartyOperations("customer", rows.map((row) => ({
    taxId: row.taxId,
    name: row.partnerName ?? row.customerName,
    amount: row.amount,
    quarter: row.quarter,
    flags: options.ownCash && row.domestic ? { cashAccounting: true } : null,
  })));
  if (!options.ownCash) return operations;

  // Importe devengado según el criterio de caja: cobros del año de facturas de este año y del anterior.
  const range = fiscalRangeInstants({ start, endExclusive }, timeZone);
  const civil = fiscalCivilDate(range.start, timeZone);
  const documents = await db
    .select({
      id: invoice.id,
      totalAmount: invoice.totalAmount,
      issueDate: invoice.issueDate,
      operationDate: invoice.operationDate,
      invoiceType: invoice.invoiceType,
      rectifiedInvoiceId: invoice.rectifiedInvoiceId,
      taxId: partner.taxId,
      partnerName: partner.name,
      customerName: customer.name,
    })
    .from(invoice)
    .innerJoin(customer, eq(customer.id, invoice.customerId))
    .leftJoin(partner, eq(partner.id, customer.partnerId))
    .where(and(
      issuedInvoiceBaseFilter(companyId),
      gte(invoice.issueDate, localMidnightInstant(civil.year - 1, 0, 1, timeZone)),
      lt(invoice.issueDate, range.endExclusive),
      domestic,
      declarable,
    ));
  const collections = await fetchInvoiceCollections(companyId, documents.map((document) => document.id));
  const credits = new Map<string, CashMovement[]>();
  for (const document of documents) {
    if (document.invoiceType !== "CREDIT_NOTE" || !document.rectifiedInvoiceId || toCents(document.totalAmount) >= 0) continue;
    credits.set(document.rectifiedInvoiceId, [...(credits.get(document.rectifiedInvoiceId) ?? []), { date: document.issueDate, amount: -toNumber(document.totalAmount) }]);
  }
  return attachCashAccruals("customer", operations, documents.map((document) => ({
    taxId: document.taxId,
    name: document.partnerName ?? document.customerName,
    cents: cashAccruedInRange(
      { operationDate: resolveAccrualDate(document).date, totalAmount: document.totalAmount },
      [...(collections.get(document.id) ?? []), ...(credits.get(document.id) ?? [])],
      range,
      timeZone,
    ),
  })));
}

/**
 * Proveedores españoles (> 3.005,06 €/año): sin anuladas ni facturas con retención, y sin las
 * facturas con tratamiento de importación de un proveedor español (envíos desde Canarias, Ceuta o
 * Melilla, art. 33.2.h RGAT). Marcas: inversión del sujeto pasivo (tratamiento de la factura),
 * criterio de caja (proveedor acogido o empresa en el régimen) y posible arrendamiento de local
 * (alguna línea con gasto en la cuenta 621).
 */
async function fetchSupplierThirdPartyOperations(companyId: string, start: Date, endExclusive: Date, timeZone: string, options: { ownCash?: boolean } = {}) {
  const quarter = quarterOf(supplierInvoice.accountingDate, timeZone);
  const reverseCharge = sql<boolean>`coalesce(${supplierInvoice.vatTreatment}, '') = 'REVERSE_CHARGE'`;
  const domestic = sql<boolean>`coalesce(${supplierInvoice.vatTreatment}, 'DOMESTIC') = 'DOMESTIC'`;
  const lease = sql<boolean>`exists (select 1 from ${supplierInvoiceLine} sil inner join ${accountChart} ac on ac.id = sil."expenseAccountId" where sil."supplierInvoiceId" = ${supplierInvoice.id} and ac.code like '621%')`;
  const declarable = and(
    eq(partner.countryCode, "ES"),
    sql`${supplierInvoice.retentionAmount} = 0`,
    sql`coalesce(${supplierInvoice.vatTreatment}, '') <> 'IMPORT'`,
  );
  const rows = await db
    .select({
      taxId: partner.taxId,
      name: partner.name,
      quarter,
      reverseCharge,
      domestic,
      lease,
      supplierCashAccounting: supplierInvoice.supplierCashAccounting,
      amount: sql<string>`sum(${supplierInvoice.totalAmount})`,
    })
    .from(supplierInvoice)
    .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
    .where(and(supplierInvoiceFiscalFilter(companyId, start, endExclusive, timeZone), declarable))
    .groupBy(partner.taxId, partner.name, quarter, reverseCharge, domestic, lease, supplierInvoice.supplierCashAccounting);

  const operations = groupThirdPartyOperations("supplier", rows.map((row) => {
    const cashAccounting = Boolean(row.domestic) && (Boolean(row.supplierCashAccounting) || Boolean(options.ownCash));
    const flags: ThirdPartyFlags = {
      ...(row.lease ? { lease: true } : {}),
      ...(cashAccounting ? { cashAccounting: true } : {}),
      ...(row.reverseCharge ? { reverseCharge: true } : {}),
    };
    return { taxId: row.taxId, name: row.name, amount: row.amount, quarter: row.quarter, flags: Object.keys(flags).length > 0 ? flags : null };
  }));
  if (!operations.some((operation) => operation.flags?.cashAccounting) && !options.ownCash) return operations;

  // Importe devengado según el criterio de caja: pagos del año de facturas de este año y del anterior.
  const range = fiscalRangeInstants({ start, endExclusive }, timeZone);
  const civil = fiscalCivilDate(range.start, timeZone);
  const documents = await db
    .select({
      id: supplierInvoice.id,
      totalAmount: supplierInvoice.totalAmount,
      issueDate: supplierInvoice.issueDate,
      operationDate: supplierInvoice.operationDate,
      accountingDate: supplierInvoice.accountingDate,
      rectifiedInvoiceId: supplierInvoice.rectifiedInvoiceId,
      taxId: partner.taxId,
      name: partner.name,
    })
    .from(supplierInvoice)
    .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
    .where(and(
      eq(supplierInvoice.companyId, companyId),
      notInArray(supplierInvoice.status, ["VOID", "DRAFT"]),
      gte(supplierInvoice.accountingDate, localMidnightInstant(civil.year - 1, 0, 1, timeZone)),
      lt(supplierInvoice.accountingDate, range.endExclusive),
      domestic,
      declarable,
      options.ownCash ? undefined : eq(supplierInvoice.supplierCashAccounting, true),
    ));
  const payments = await fetchSupplierInvoicePayments(companyId, documents.map((document) => document.id));
  const credits = new Map<string, CashMovement[]>();
  for (const document of documents) {
    if (!document.rectifiedInvoiceId || toCents(document.totalAmount) >= 0) continue;
    credits.set(document.rectifiedInvoiceId, [...(credits.get(document.rectifiedInvoiceId) ?? []), { date: document.accountingDate, amount: -toNumber(document.totalAmount) }]);
  }
  return attachCashAccruals("supplier", operations, documents.map((document) => ({
    taxId: document.taxId,
    name: document.name,
    cents: cashAccruedInRange(
      { operationDate: document.operationDate ?? document.issueDate, totalAmount: document.totalAmount, notBefore: document.accountingDate },
      [...(payments.get(document.id) ?? []), ...(credits.get(document.id) ?? [])],
      range,
      timeZone,
    ),
  })));
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
      action: "En el último periodo del año el programa calcula la prorrata definitiva: confírmala en el 303 del 4T (o mes 12) para regularizar en la casilla 44.",
    });
  }
  if (profile.fiscalRegime === "cash_accounting" && code !== "303" && code !== "390") {
    checks.push({
      code: "cash-accounting",
      status: "ok",
      title: "Criterio de caja",
      detail: "El criterio de caja solo cambia el momento en que se declara el IVA (modelos 303 y 390). Este modelo se calcula por fecha de factura.",
      action: "Sin acción.",
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

function sumBucketMap(map: Map<number, { base: number; tax: number }>) {
  let base = 0;
  let tax = 0;
  for (const bucket of map.values()) {
    base += bucket.base;
    tax += bucket.tax;
  }
  return { base, tax };
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
  const filedPeriods = await loadFiledVatPeriods(companyId, timeZone);

  // CRITERIO DE CAJA (ver `cash-accounting.ts`). Solo cambia el 303 y el 390. `ownCash`: la empresa
  // está en el régimen (devenga al cobro y deduce al pago). Cualquier empresa difiere además al
  // pago las facturas recibidas de proveedores acogidos. Una operación del año N puede devengarse
  // hasta el 31-12 de N+1, así que se cargan las facturas desde el 1 de enero del año anterior.
  const cashMode = code === "303" || code === "390";
  const ownCash = cashMode && profile.fiscalRegime === "cash_accounting";
  const cashSuppliers = cashMode && (ownCash || await hasCashAccountingSupplierInvoices(companyId));
  const cashStart = localMidnightInstant(periodYear - 1, 0, 1, timeZone);
  // El 303 se carga desde el 1 de enero: hace falta el resultado de los periodos anteriores del
  // ejercicio para las cuotas a compensar y, en el último periodo, el volumen de operaciones del año.
  const baseStart = code === "303" ? yearStart : instants.start;
  // Territorio de la empresa: tratamientos de facturas antiguas sin tratamiento guardado y tipo de
  // autorepercusión (7 % IGIC en Canarias).
  const [issuedRaw, supplierRaw, accountingBalances] = await Promise.all([
    fetchIssuedLines(companyId, ownCash ? cashStart : baseStart, instants.endExclusive, { homeCountry: profile.territory, filedPeriods }),
    fetchSupplierLines(companyId, cashSuppliers ? cashStart : baseStart, instants.endExclusive, profile.territory),
    fetchAccountingTaxBalances(companyId, instants.start, instants.endExclusive, timeZone),
  ]);
  const selfAssessmentRate = standardVatRate(profile.territory);

  // Una operación cuyo periodo ya se presentó sin criterio de caja se declaró entera allí: no se
  // vuelve a repartir por cobros (evita declararla dos veces al cambiar de régimen o al marcar tarde
  // una factura). Lo dice la foto de aquel 303.
  const filed303At = (date: Date) => filedPeriods.find((candidate) => candidate.code === "303" && date >= candidate.start && date < candidate.endExclusive);
  const saleInRegime = (line: IssuedFiscalLine) => {
    if (!ownCash || line.treatment !== "DOMESTIC") return false;
    const filed = filed303At(line.accrualDate);
    return !filed || filed.cashOwn === true;
  };
  const purchaseDeferred = (line: SupplierLineInput) => {
    if (!cashSuppliers || line.treatment !== "DOMESTIC" || !(ownCash || line.supplierCashAccounting)) return false;
    const filed = filed303At(line.accountingDate ?? line.issueDate);
    if (!filed) return true;
    return line.supplierCashAccounting ? filed.cashAware === true : filed.cashOwn === true;
  };
  const cashSaleIds = [...new Set(issuedRaw.filter(saleInRegime).map((line) => line.invoiceId))];
  const cashPurchaseIds = [...new Set(supplierRaw.filter(purchaseDeferred).map((line) => line.invoiceId))];
  const salesCash = cashSaleIds.length > 0;
  const purchasesCash = cashPurchaseIds.length > 0;
  const [collections, supplierPayments] = await Promise.all([
    salesCash ? fetchInvoiceCollections(companyId, cashSaleIds) : new Map<string, CashMovement[]>(),
    purchasesCash ? fetchSupplierInvoicePayments(companyId, cashPurchaseIds) : new Map<string, CashMovement[]>(),
  ]);
  // Líneas ya repartidas por tramos de cobro o pago; sin criterio de caja son las mismas que las cargadas.
  const issuedLines: IssuedFiscalLine[] = salesCash ? expandIssuedLinesForCash(issuedRaw, { movements: collections, timeZone, isEligible: saleInRegime }) : issuedRaw;
  const supplierLines: SupplierLineInput[] = purchasesCash ? expandSupplierLinesForCash(supplierRaw, { movements: supplierPayments, timeZone, isEligible: purchaseDeferred }) : supplierRaw;

  const issuedIn = (target: InstantRange) => computeIssuedVat(issuedLines.filter((line) => inInstantRange(line.accrualDate, target)));
  // Los modelos canarios no tienen calculado el apartado de rectificación de deducciones: allí las
  // rectificativas recibidas siguen restando en su concepto.
  const supplierOptions = { separateRectifications: !CANARY_MODEL_CODES.has(code) };
  const supplierIn = (target: InstantRange) => computeSupplierVat(supplierLines.filter((line) => inInstantRange(supplierLinePeriodDate(line), target)), profile.prorrataPct, selfAssessmentRate, supplierOptions);
  const issued = issuedIn(instants);
  const supplier = supplierIn(instants);

  // Devengo: facturas que se declaran en un periodo distinto del de su expedición. El asiento va con
  // la fecha de expedición, así que la conciliación con la 477 y la 473 se hace por expedición.
  // En criterio de caja pasa lo mismo con todas: los asientos siguen la fecha de la factura (el
  // programa no usa cuentas de IVA pendiente de devengo), así que se concilia por la regla general.
  const currentLines = issuedRaw.filter((line) => inInstantRange(line.accrualDate, instants));
  const issuedHereLines = issuedRaw.filter((line) => inInstantRange(line.issueDate, instants));
  const movedIn = currentLines.filter((line) => !inInstantRange(line.issueDate, instants));
  const movedOut = issuedHereLines.filter((line) => !inInstantRange(line.accrualDate, instants));
  const filedFallback = currentLines.filter((line) => line.accrualBasis === "issue-filed-period");
  const issuedByIssueDate = movedIn.length > 0 || movedOut.length > 0 || salesCash ? computeIssuedVat(issuedHereLines) : issued;
  const issuedGeneral = salesCash ? computeIssuedVat(currentLines) : issued;
  const supplierLedger = purchasesCash
    ? computeSupplierVat(supplierRaw.filter((line) => inInstantRange(supplierLinePeriodDate(line), instants)), profile.prorrataPct, selfAssessmentRate)
    : supplier;

  const canary = code === "420"
    ? buildModelo420(issued, supplier)
    : code === "425"
      ? buildModelo425(issued, supplier, profile.fiscalRegime)
      : code === "450"
        ? buildModelo450(await fetchAiemBuckets(companyId, instants.start, instants.endExclusive))
        : null;

  // ÚLTIMO PERIODO Y RESUMEN ANUAL: volumen de operaciones (por la regla general de devengo),
  // prorrata definitiva y regularizaciones (casillas 43 y 44 del 303; 63 y 522 del 390).
  const lastPeriod = code === "303" && isLastVatPeriodOfYear(period);
  const annual = lastPeriod || code === "390";
  const yearRange: InstantRange = { start: yearStart, endExclusive: instants.endExclusive };
  const yearGeneralLines = annual ? issuedRaw.filter((line) => inInstantRange(line.accrualDate, yearRange)) : [];
  const yearIssued = annual ? computeIssuedVat(yearGeneralLines.filter((line) => !saleInRegime(line))) : undefined;
  const cashYearIssued = annual && salesCash ? computeIssuedVat(yearGeneralLines.filter(saleInRegime)) : undefined;
  let prorrata: FiscalProrrataSummary | undefined;
  let adjustments: Modelo303Adjustments | undefined;
  if (annual && yearIssued) {
    const computed = computeFinalProrrata(yearIssued, ...(cashYearIssued ? [cashYearIssued] : []));
    const confirmed = profile.vatProrataFinal?.[String(periodYear)];
    // Solo si la prorrata interviene: confirmada, provisional inferior a 100 o ventas exentas en el año.
    if (confirmed !== undefined || profile.prorrataPct < 100 || (computed.pct !== null && computed.pct < 100)) {
      const targetPct = confirmed ?? computed.pct;
      const yearSupplierLines = supplierLines.filter((line) => inInstantRange(supplierLinePeriodDate(line), yearRange));
      const regularizationCents = targetPct === null ? null : computeProrrataRegularization(yearSupplierLines, profile.prorrataPct, targetPct, selfAssessmentRate);
      const goods = targetPct === null
        ? { goods: [], totalCents: 0 }
        : computeInvestmentGoodsRegularization(await fetchInvestmentGoods(companyId, periodYear, timeZone, profile.territory, selfAssessmentRate), { year: periodYear, finalPct: targetPct, finalByYear: profile.vatProrataFinal });
      // La regularización solo entra en el resultado cuando el usuario ha confirmado el porcentaje.
      if (confirmed !== undefined) adjustments = { prorrataRegularizationCents: regularizationCents ?? 0, investmentRegularizationCents: goods.totalCents };
      prorrata = {
        year: periodYear,
        provisionalPct: profile.prorrataPct,
        computedPct: computed.pct,
        totalOperations: centsToNumber(computed.totalCents),
        deductibleOperations: centsToNumber(computed.deductibleCents),
        exemptOperations: centsToNumber(computed.exemptCents),
        confirmedPct: confirmed ?? null,
        regularizationAmount: confirmed !== undefined ? centsToNumber(regularizationCents ?? 0) : null,
        previewRegularizationAmount: confirmed === undefined && regularizationCents !== null ? centsToNumber(regularizationCents) : null,
        investmentRegularizationAmount: confirmed !== undefined ? centsToNumber(goods.totalCents) : null,
        investmentGoods: goods.goods.map((good) => ({
          number: good.number,
          description: good.description,
          purchaseYear: good.purchaseYear,
          base: centsToNumber(good.baseCents),
          tax: centsToNumber(good.vatCents),
          purchasePct: good.purchasePct,
          purchasePctConfirmed: good.purchasePctConfirmed,
          years: good.years,
          yearNumber: good.yearNumber,
          differencePoints: good.differencePoints,
          regularizationAmount: centsToNumber(good.regularizationCents),
        })),
      };
    }
  }
  const totals = computeModelo303Totals(issued, supplier, adjustments);

  // Casillas informativas del criterio de caja: las operaciones afectadas, por la regla general.
  let cashInfo: Modelo303CashInfo | undefined;
  if (salesCash || purchasesCash) {
    const sales = computeIssuedVat(currentLines.filter(saleInRegime));
    const purchases = computeSupplierVat(supplierRaw.filter((line) => purchaseDeferred(line) && inInstantRange(supplierLinePeriodDate(line), instants)), profile.prorrataPct, selfAssessmentRate);
    const salesVat = sumBucketMap(sales.vat);
    cashInfo = {
      salesBaseCents: salesVat.base + sales.zeroRated.DOMESTIC,
      salesTaxCents: salesVat.tax + sumBucketMap(sales.surcharge).tax,
      purchaseBaseCents: sumBucketMap(purchases.input).base,
      purchaseTaxCents: purchases.totalTaxCents,
    };
  }
  const deadlineInvoices = (lines: Array<{ invoiceId: string; cashReason?: string }>) => new Set(lines.filter((line) => line.cashReason === "deadline").map((line) => line.invoiceId)).size;
  const deadlineSalesInvoices = salesCash ? deadlineInvoices(issuedLines.filter((line) => inInstantRange(line.accrualDate, instants))) : 0;
  const deadlinePurchaseInvoices = purchasesCash ? deadlineInvoices(supplierLines.filter((line) => inInstantRange(supplierLinePeriodDate(line), instants))) : 0;

  // Resultado (casilla 46) de un periodo del ejercicio: el presentado si hay foto; si no, el calculado hoy.
  const periodResultCents = (key: string) => {
    const filed = filedPeriods.find((candidate) => candidate.code === "303" && candidate.period === key);
    if (filed && filed.filedResultCents !== null) return filed.filedResultCents;
    const target = parseSpanishFiscalPeriod(key, "303");
    if (!target) return 0;
    const targetRange = fiscalRangeInstants(target, timeZone);
    return computeModelo303Totals(issuedIn(targetRange), supplierIn(targetRange), isLastVatPeriodOfYear(key) ? adjustments : undefined).resultCents;
  };
  const openingCents = toCents(profile.vatCompensationOpening[String(periodYear)] ?? 0);
  const compensation = code === "303"
    ? computeModelo303Compensation({ openingCents, previousResultsCents: previousPeriodsOfYear(period).map(periodResultCents), resultCents: totals.resultCents })
    : null;
  const modelo303Boxes = buildModelo303Boxes(issued, supplier, {
    periodYear,
    compensation: compensation ?? undefined,
    yearIssued: lastPeriod ? yearIssued : undefined,
    cashYearIssued: lastPeriod ? cashYearIssued : undefined,
    adjustments: lastPeriod ? adjustments : undefined,
    cashInfo: code === "303" ? cashInfo : undefined,
  });
  const annualPeriods = profile.taxPeriodicity === "monthly"
    ? Array.from({ length: 12 }, (_, index) => `${periodYear}-${String(index + 1).padStart(2, "0")}`)
    : [1, 2, 3, 4].map((quarter) => `${periodYear}-Q${quarter}`);
  const finalPct = prorrata ? prorrata.confirmedPct ?? prorrata.computedPct : null;
  const annualSummaryBoxes = code === "390"
    ? buildModelo390Summary(issued, supplier, {
        openingCents,
        periodResults: annualPeriods.map((key) => ({ period: key, resultCents: periodResultCents(key) })),
        adjustments,
        volumeIssued: yearIssued,
        cashYearIssued,
        cashInfo,
        prorrata: prorrata && finalPct !== null ? { totalCents: toCents(prorrata.totalOperations), deductibleCents: toCents(prorrata.deductibleOperations), pct: finalPct } : undefined,
      })
    : undefined;

  const dueDate = getSpanishFiscalDueDate(period, code);
  const directDebitDate = getSpanishFiscalDirectDebitDate(period, code);
  let thirdPartyOperations: ThirdPartyOperation[] | undefined;
  if (code === "347") {
    const [customers, suppliers, cash] = await Promise.all([
      fetchThirdPartyOperations(companyId, instants.start, instants.endExclusive, timeZone, { ownCash: profile.fiscalRegime === "cash_accounting" }),
      fetchSupplierThirdPartyOperations(companyId, instants.start, instants.endExclusive, timeZone, { ownCash: profile.fiscalRegime === "cash_accounting" }),
      fetchCashCollections(companyId, instants),
    ]);
    thirdPartyOperations = [
      // El metálico es del tercero, no de cada registro: va en su fila sin marcas (o en la primera).
      ...customers.map((row, index) => {
        const key = thirdPartyKey(row);
        const cashAmount = cash.get(key);
        const firstOfParty = customers.findIndex((candidate) => thirdPartyKey(candidate) === key && !candidate.flags);
        const target = firstOfParty >= 0 ? firstOfParty : customers.findIndex((candidate) => thirdPartyKey(candidate) === key);
        return cashAmount === undefined || target !== index ? row : { ...row, cashAmount };
      }),
      ...suppliers,
    ].sort((left, right) => right.amount - left.amount);
  }

  const modelo349 = code === "349" ? await fetchModelo349(companyId, instants, period, timeZone, filedPeriods) : undefined;
  const modelo130 = code === "130" ? await fetchModelo130(companyId, instants, periodYear, profile.prorrataPct, timeZone, filedPeriods) : undefined;

  // Las retenciones no dependen del criterio de caja del IVA: se toman por fecha de registro.
  const practicedWithholdings = code === "111" ? supplierLedger.professional : code === "115" ? supplierLedger.rent : mergeBuckets(supplierLedger.professional, supplierLedger.rent);
  const allPracticed = mergeBuckets(supplierLedger.professional, supplierLedger.rent);
  // Modelos de retenciones: casillas, perceptores y cuadre los calcula `@/server/fiscal/withholdings`.
  const withholdingModel = isWithholdingModelCode(code) ? (await loadWithholdingModel(companyId, code, period, timeZone))?.summary : undefined;
  // Retenciones de nóminas y de rendimientos del capital apuntadas en la 4751 (cero si no se usan).
  const payrollLedgerWithholdingCents = await sumPayrollLedgerWithholdings(companyId, instants.start, instants.endExclusive);
  const sum = (map: Map<number, { base: number; tax: number }>) => [...map.values()].reduce((acc, bucket) => ({ base: acc.base + bucket.base, tax: acc.tax + bucket.tax }), { base: 0, tax: 0 });
  const practicedTotals = sum(practicedWithholdings);
  const allPracticedTotals = sum(allPracticed);
  const salesWithholdingTotals = sum(issuedGeneral.withholdings);
  const outputVatTotals = sum(issued.vat);
  const inputTotals = sum(supplier.input);

  // Sin regularizaciones (43 y 44): no tienen asiento automático.
  const ledgerTotals = computeModelo303Totals(issuedByIssueDate, supplierLedger);
  const outputVatReconciliation = reconcile(centsToNumber(ledgerTotals.accruedCents), accountingBalances.outputVat);
  const inputVatReconciliation = reconcile(centsToNumber(ledgerTotals.deductibleCents), accountingBalances.inputVat);
  const withholdingReconciliation = reconcile(centsToNumber(allPracticedTotals.tax + payrollLedgerWithholdingCents), accountingBalances.withholdings);
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
  if (withholdingModel) automationChecks.push(...withholdingModel.checks.filter((check) => check.status !== "ok"));
  const invoiceCount = (lines: IssuedFiscalLine[]) => new Set(lines.map((line) => line.invoiceId)).size;
  const usesAccrual = code === "303" || code === "390" || code === "349" || code === "130" || code === "420" || code === "425";
  if (cashMode && ownCash) {
    automationChecks.push({
      code: "cash-accounting",
      status: "ok",
      title: "Criterio de caja aplicado",
      detail: "El IVA de tus ventas nacionales se declara cuando las cobras (en proporción a lo cobrado) y el de tus compras nacionales cuando las pagas; lo que siga pendiente se declara el 31 de diciembre del año siguiente al de la operación. Entregas intracomunitarias, exportaciones, importaciones e inversión del sujeto pasivo van por la regla general. Se aplica a las operaciones desde el 1 de enero del año anterior, salvo las de periodos ya presentados sin criterio de caja.",
      action: "Registra cada cobro y cada pago con su fecha real. La conciliación con las cuentas 477 y 472 se hace por fecha de factura (el programa no lleva cuentas de IVA pendiente de devengo), así que su importe no coincidirá con las casillas 27 y 45.",
    });
  } else if (cashMode && purchasesCash) {
    automationChecks.push({
      code: "cash-accounting-suppliers",
      status: "ok",
      title: "Facturas de proveedores en criterio de caja",
      detail: "Las facturas recibidas marcadas como «proveedor en criterio de caja» se deducen cuando las pagas (o el 31 de diciembre del año siguiente), no al registrarlas.",
      action: "Registra los pagos con su fecha real. La conciliación con la cuenta 472 se hace por fecha de registro, así que puede no coincidir con la casilla 45.",
    });
  }
  if (deadlineSalesInvoices > 0 || deadlinePurchaseInvoices > 0) {
    automationChecks.push({
      code: "cash-accounting-deadline",
      status: "warning",
      title: "Criterio de caja: límite del 31 de diciembre",
      detail: `${deadlineSalesInvoices} factura(s) emitida(s) sin cobrar del todo y ${deadlinePurchaseInvoices} recibida(s) sin pagar del todo llegan en este periodo al 31 de diciembre del año siguiente al de la operación: su IVA pendiente se declara ahora aunque no se haya cobrado o pagado.`,
      action: "Comprueba que no falte por registrar ningún cobro o pago anterior de esas facturas.",
    });
  }
  if (prorrata) {
    const computedText = prorrata.computedPct === null ? "sin operaciones para calcularla" : `${prorrata.computedPct} % (${prorrata.deductibleOperations.toLocaleString("es-ES", { minimumFractionDigits: 2 })} € con derecho a deducción sobre ${prorrata.totalOperations.toLocaleString("es-ES", { minimumFractionDigits: 2 })} €)`;
    automationChecks.push(prorrata.confirmedPct !== null
      ? {
          code: "prorrata-final",
          status: "ok",
          title: `Prorrata definitiva del ${prorrata.confirmedPct} % confirmada`,
          detail: `Regularización de las deducciones del año: ${(prorrata.regularizationAmount ?? 0).toFixed(2)} € (casilla 44 del 303; 522 del 390). Porcentaje calculado con las operaciones del año: ${computedText}.`,
          action: "La regularización no genera asiento automático: contabilízala a mano (cuentas 634 o 639 contra la 472).",
        }
      : {
          code: "prorrata-final",
          status: "warning",
          title: "Prorrata definitiva sin confirmar",
          detail: `Porcentaje definitivo calculado: ${computedText}; el provisional aplicado es el ${prorrata.provisionalPct} %. Con el calculado, la regularización de la casilla 44 sería de ${(prorrata.previewRegularizationAmount ?? 0).toFixed(2)} €. Mientras no lo confirmes, el resultado no incluye la regularización.`,
          action: "Revisa el porcentaje (no descuenta las ventas de bienes de inversión ni las operaciones inmobiliarias o financieras no habituales, art. 104.Tres LIVA) y confírmalo en el apartado «Prorrata definitiva» de este modelo.",
        });
    const regularized = prorrata.investmentGoods.filter((good) => good.regularizationAmount !== 0);
    if (prorrata.investmentGoods.length > 0) {
      automationChecks.push({
        code: "investment-goods-regularization",
        status: regularized.length > 0 ? "warning" : "ok",
        title: "Bienes de inversión en periodo de regularización",
        detail: `${prorrata.investmentGoods.length} bien(es) de inversión de años anteriores siguen en regularización (5 años; 10 en terrenos y edificaciones): ${prorrata.investmentGoods.slice(0, 6).map((good) => `${good.number} · ${good.description} (${good.purchaseYear})`).join("; ")}. ${regularized.length > 0 ? `En ${regularized.length} la prorrata del año difiere en más de diez puntos de la del año de compra` : "En ninguno la prorrata difiere en más de diez puntos de la del año de compra"}.`,
        action: prorrata.confirmedPct !== null
          ? "El importe va en la casilla 43. Se supone que cada bien entró en funcionamiento el año de la compra y sigue en la empresa: si lo has vendido o empezó a usarse más tarde, corrígelo a mano (arts. 107 a 110 LIVA)."
          : "Confirma la prorrata definitiva del año para que el importe entre en la casilla 43.",
      });
    }
  }
  if (usesAccrual && !salesCash && (movedIn.length > 0 || movedOut.length > 0)) {
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
  const leaseThirdParties = thirdPartyOperations?.filter((operation) => operation.flags?.lease) ?? [];
  if (leaseThirdParties.length > 0) {
    automationChecks.push({
      code: "model-347-lease",
      status: "warning",
      title: "Posibles arrendamientos de local de negocio",
      detail: `${leaseThirdParties.length} proveedor(es) tienen facturas sin retención con gasto en la cuenta 621 (arrendamientos y cánones): ${leaseThirdParties.slice(0, 5).map((operation) => operation.name).join(", ")}. Si es el alquiler de un local de negocio, se declara en registro aparte con la marca «arrendamiento local negocio»; si es otro alquiler (maquinaria, vehículos, licencias), súmalo al resto de compras de ese proveedor.`,
      action: "La referencia catastral y la dirección del local solo las declara el arrendador. Si tú alquilas locales a terceros, el programa no guarda esos datos del inmueble: añádelos a mano al presentar (marca de arrendamiento y hoja de inmuebles).",
    });
  }
  const cashRegimeThirdParties = thirdPartyOperations?.filter((operation) => operation.flags?.cashAccounting) ?? [];
  if (cashRegimeThirdParties.length > 0) {
    automationChecks.push({
      code: "model-347-cash-accounting",
      status: "ok",
      title: "Operaciones en criterio de caja",
      detail: `${cashRegimeThirdParties.length} registro(s) llevan la marca de criterio de caja: se declaran en cómputo anual (sin trimestres) con dos importes, el anual según la regla general de devengo y el devengado según el régimen (lo cobrado o pagado en el año).`,
      action: "Comprueba que los cobros y pagos del año estén registrados con su fecha.",
    });
  }
  if (modelo349?.monthlyRequired) {
    automationChecks.push({
      code: "model-349-monthly",
      status: "warning",
      title: "El 349 te corresponde mensual",
      detail: `Tus entregas de bienes y prestaciones de servicios intracomunitarias superan ${MODELO_349_MONTHLY_THRESHOLD.toLocaleString("es-ES")} € en este trimestre o en alguno de los cuatro anteriores (en este: ${(modelo349.deliveriesAmount ?? 0).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €).`,
      action: "Con ese importe el 349 se presenta cada mes, no por trimestres (art. 81.2 RIVA): crea los modelos mensuales del trimestre.",
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
    cashAccounting: cashMode
      ? {
          ownRegime: ownCash,
          salesBase: centsToNumber(cashInfo?.salesBaseCents ?? 0),
          salesTax: centsToNumber(cashInfo?.salesTaxCents ?? 0),
          purchaseBase: centsToNumber(cashInfo?.purchaseBaseCents ?? 0),
          purchaseTax: centsToNumber(cashInfo?.purchaseTaxCents ?? 0),
          deadlineSalesInvoices,
          deadlinePurchaseInvoices,
        }
      : undefined,
    prorrata,
    amountDue: canary
      ? centsToNumber(canary.resultCents)
      : code === "303" && compensation
        ? centsToNumber(compensation.resultCents)
        : withholdingModel
          ? withholdingModel.resultCents === null ? null : centsToNumber(withholdingModel.resultCents)
        : code === "111" || code === "115"
          ? centsToNumber(practicedTotals.tax)
          : code === "130" && modelo130
            ? centsToNumber(modelo130.resultCents)
            : null,
    modelo349,
    modelo130,
    withholdingModel,
    withholdingBase: centsToNumber(withholdingModel?.baseCents ?? practicedTotals.base),
    withholdingAmount: centsToNumber(withholdingModel?.withheldCents ?? practicedTotals.tax),
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
