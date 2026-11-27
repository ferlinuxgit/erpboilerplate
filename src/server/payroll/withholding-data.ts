/**
 * Datos de los modelos de retenciones (111, 115, 123, 190, 180 y 193): carga las nóminas, las
 * facturas recibidas con retención y los rendimientos del capital pagados, los fecha con el
 * criterio de la empresa y delega el cálculo en `@/server/fiscal/withholdings` (puro).
 *
 * Este módulo no importa `@/server/fiscal/spain` (que sí importa este) para no crear un ciclo.
 */
import { and, eq, gte, inArray, isNotNull, lt, ne, or, sql } from "drizzle-orm";

import {
  accountChart,
  capitalIncomePayment,
  companySettings,
  fiscalReport,
  journalEntry,
  journalLine,
  partner,
  payrollEmployee,
  payrollSettings,
  payrollSlip,
  rentalProperty,
  supplierInvoice,
  supplierInvoiceLine,
  supplierInvoicePayment,
  supplierPayment,
} from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import {
  FISCAL_TIME_ZONE_PENINSULA,
  fiscalCivilDate,
  fiscalRangeInstants,
  parseSpanishFiscalPeriod,
  type SpanishFiscalModelCode,
} from "@/lib/fiscal-spain";
import { toCents } from "@/server/accounting/money";
import { readFiledSnapshot } from "@/server/fiscal/snapshot";
import {
  ANNUAL_SUMMARY_OF,
  allocateWithholding,
  allocationChecks,
  computeModelo111,
  computeModelo115,
  computeModelo123,
  computeModelo180,
  computeModelo190,
  computeModelo193,
  itemsInRange,
  normalizeRecipientTaxId,
  professionalSubkey,
  type Modelo111Result,
  type Modelo115Result,
  type Modelo123Result,
  type Modelo180Result,
  type Modelo190PersonalData,
  type Modelo190Result,
  type Modelo193Result,
  type PeriodicFiling,
  type RentalPropertyData,
  type WithholdingBox,
  type WithholdingCheck,
  type WithholdingItem,
  type WithholdingModelCode,
} from "@/server/fiscal/withholdings";
import { PAYROLL_SOURCE_TYPES, key190For, subkey190For, type RecipientKind } from "@/server/payroll/model";

export type InvoiceWithholdingBasis = "registration" | "payment";
export type PayrollWithholdingBasis = "accrual" | "payment";

export type PayrollSettingsValues = {
  invoiceWithholdingBasis: InvoiceWithholdingBasis;
  payrollWithholdingBasis: PayrollWithholdingBasis;
  /** Modelos activados a mano para el calendario (190, 180, 123, 193). */
  enabledModels: string[];
};

export const DEFAULT_PAYROLL_SETTINGS: PayrollSettingsValues = { invoiceWithholdingBasis: "registration", payrollWithholdingBasis: "accrual", enabledModels: [] };

/** Ajustes de nóminas y retenciones; sin fila, los valores por defecto (comportamiento histórico). */
export async function getPayrollSettings(companyId: string, client: DbClient = db): Promise<PayrollSettingsValues> {
  const [row] = await client.select().from(payrollSettings).where(eq(payrollSettings.companyId, companyId)).limit(1);
  if (!row) return DEFAULT_PAYROLL_SETTINGS;
  return {
    invoiceWithholdingBasis: row.invoiceWithholdingBasis === "payment" ? "payment" : "registration",
    payrollWithholdingBasis: row.payrollWithholdingBasis === "payment" ? "payment" : "accrual",
    enabledModels: Array.isArray(row.enabledModels) ? row.enabledModels.filter((code) => typeof code === "string") : [],
  };
}

/** Resumen de un modelo de retenciones que viaja en `SpanishFiscalSummary.withholdingModel`. */
export type WithholdingModelSummary = {
  code: WithholdingModelCode;
  period: string;
  /** Casillas de la autoliquidación (111, 115 y 123); vacío en los resúmenes anuales. */
  boxes: WithholdingBox[];
  baseCents: number;
  withheldCents: number;
  /** Resultado a ingresar; null en los resúmenes anuales (informativos). */
  resultCents: number | null;
  invoiceBasis: InvoiceWithholdingBasis;
  payrollBasis: PayrollWithholdingBasis;
  modelo111?: Modelo111Result;
  modelo115?: Modelo115Result;
  modelo123?: Modelo123Result;
  modelo190?: Modelo190Result;
  modelo180?: Modelo180Result;
  modelo193?: Modelo193Result;
  checks: WithholdingCheck[];
};

const isoOf = (date: Date) => date.toISOString().slice(0, 10);

/** Fecha civil AAAA-MM-DD de un instante en la zona horaria fiscal de la empresa. */
function civilIso(instant: Date, timeZone: string) {
  const { year, month, day } = fiscalCivilDate(instant, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

type FiledPeriod = { code: string; period: string; start: string; endExclusive: string; resultCents: number | null };

/** Autoliquidaciones de retenciones ya presentadas (con su rango de fechas civiles y su resultado). */
async function loadFiledWithholdingPeriods(companyId: string): Promise<FiledPeriod[]> {
  const rows = await db
    .select({ code: fiscalReport.code, period: fiscalReport.period, snapshot: fiscalReport.filedSnapshot })
    .from(fiscalReport)
    .where(and(eq(fiscalReport.companyId, companyId), eq(fiscalReport.status, "FILED"), inArray(fiscalReport.code, ["111", "115", "123"])));
  return rows.flatMap((row) => {
    const range = parseSpanishFiscalPeriod(row.period, row.code as SpanishFiscalModelCode);
    if (!range) return [];
    const amountDue = readFiledSnapshot(row.snapshot)?.amountDue;
    return [{
      code: row.code,
      period: row.period,
      start: isoOf(range.start),
      endExclusive: isoOf(range.endExclusive),
      resultCents: amountDue === null || amountDue === undefined ? null : toCents(amountDue),
    }];
  });
}

function filedPeriodFinder(filed: FiledPeriod[], code: string) {
  const own = filed.filter((period) => period.code === code);
  return (date: string) => own.find((period) => date >= period.start && date < period.endExclusive)?.period ?? null;
}

type LoadOptions = {
  /** Año natural cuyas partidas se cargan. */
  year: number;
  timeZone: string;
  settings: PayrollSettingsValues;
  filed: FiledPeriod[];
};

/** Facturas recibidas con retención → partidas del 111 (profesionales) y del 115 (arrendamientos, cuenta 621). */
async function loadSupplierInvoiceItems(companyId: string, options: LoadOptions): Promise<WithholdingItem[]> {
  const { year, timeZone, settings } = options;
  const byPayment = settings.invoiceWithholdingBasis === "payment";
  const yearRange = fiscalRangeInstants({ start: new Date(Date.UTC(year, 0, 1)), endExclusive: new Date(Date.UTC(year + 1, 0, 1)) }, timeZone);
  // Por pago: una factura registrada en ejercicios anteriores puede pagarse este año.
  const registeredFrom = byPayment ? fiscalRangeInstants({ start: new Date(Date.UTC(year - 2, 0, 1)), endExclusive: yearRange.endExclusive }, timeZone).start : yearRange.start;
  const rows = await db
    .select({
      invoiceId: supplierInvoice.id,
      number: supplierInvoice.number,
      supplierNumber: supplierInvoice.supplierDocumentNumber,
      status: supplierInvoice.status,
      accountingDate: supplierInvoice.accountingDate,
      voidedAt: supplierInvoice.voidedAt,
      totalAmount: supplierInvoice.totalAmount,
      subtotal: supplierInvoiceLine.subtotalAmount,
      retentionAmount: supplierInvoiceLine.retentionAmount,
      retentionRate: supplierInvoiceLine.retentionRate,
      expenseAccountCode: accountChart.code,
      partnerName: partner.name,
      partnerTaxId: partner.taxId,
    })
    .from(supplierInvoiceLine)
    .innerJoin(supplierInvoice, eq(supplierInvoiceLine.supplierInvoiceId, supplierInvoice.id))
    .leftJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
    .leftJoin(accountChart, eq(accountChart.id, supplierInvoiceLine.expenseAccountId))
    .where(and(
      eq(supplierInvoice.companyId, companyId),
      ne(supplierInvoice.status, "DRAFT"),
      ne(supplierInvoiceLine.retentionAmount, "0"),
      // Igual que el 303: una anulada sigue en su periodo si tiene fecha de anulación (y resta en ella).
      or(ne(supplierInvoice.status, "VOID"), isNotNull(supplierInvoice.voidedAt)),
      or(
        and(gte(supplierInvoice.accountingDate, registeredFrom), lt(supplierInvoice.accountingDate, yearRange.endExclusive)),
        and(gte(supplierInvoice.voidedAt, yearRange.start), lt(supplierInvoice.voidedAt, yearRange.endExclusive)),
      ),
    ));
  if (rows.length === 0) return [];

  const invoiceIds = [...new Set(rows.map((row) => row.invoiceId))];
  const payments = byPayment
    ? await db
        .select({ invoiceId: supplierInvoicePayment.supplierInvoiceId, amount: supplierInvoicePayment.amountApplied, postedAt: supplierPayment.postedAt })
        .from(supplierInvoicePayment)
        .innerJoin(supplierPayment, eq(supplierPayment.id, supplierInvoicePayment.supplierPaymentId))
        .where(and(eq(supplierInvoicePayment.companyId, companyId), inArray(supplierInvoicePayment.supplierInvoiceId, invoiceIds)))
    : [];
  const paymentsByInvoice = new Map<string, Array<{ date: string; cents: number }>>();
  for (const payment of payments) {
    const list = paymentsByInvoice.get(payment.invoiceId) ?? [];
    list.push({ date: civilIso(payment.postedAt, timeZone), cents: toCents(payment.amount) });
    paymentsByInvoice.set(payment.invoiceId, list);
  }

  // Una partida por factura, modelo y tipo de retención.
  type Group = { row: (typeof rows)[number]; model: "111" | "115"; rate: number; baseCents: number; withheldCents: number };
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const model = (row.expenseAccountCode ?? "").startsWith("621") ? "115" as const : "111" as const;
    const baseCents = toCents(row.subtotal);
    const withheldCents = toCents(row.retentionAmount);
    const rate = Math.round(Number(row.retentionRate ?? 0) * 100) / 100 || (baseCents !== 0 ? Math.round((withheldCents / baseCents) * 10_000) / 100 : 0);
    const key = `${row.invoiceId}|${model}|${rate}`;
    const group = groups.get(key) ?? { row, model, rate, baseCents: 0, withheldCents: 0 };
    group.baseCents += baseCents;
    group.withheldCents += withheldCents;
    groups.set(key, group);
  }

  const items: WithholdingItem[] = [];
  for (const group of groups.values()) {
    const { row, model, rate } = group;
    const label = row.supplierNumber ? `${row.number} (${row.supplierNumber})` : row.number;
    const common = {
      source: "supplierInvoice" as const,
      sourceId: row.invoiceId,
      model,
      recipientTaxId: row.partnerTaxId,
      recipientName: row.partnerName ?? "Proveedor sin nombre",
      block: model === "111" ? "economic" as const : undefined,
      inKind: false,
      rate,
      key190: model === "111" ? "G" : undefined,
      subkey190: model === "111" ? professionalSubkey(rate) : undefined,
    };
    const registrationDate = civilIso(row.accountingDate, timeZone);
    const voided = row.status === "VOID";
    const portions = allocateWithholding({
      fallbackDate: registrationDate,
      fallbackKind: "registration",
      // Una factura anulada no se paga: se queda en su fecha de registro y resta en la de anulación.
      basis: byPayment && !voided ? "payment" : "fallback",
      payments: paymentsByInvoice.get(row.invoiceId) ?? [],
      payableCents: toCents(row.totalAmount),
      baseCents: group.baseCents,
      withheldCents: group.withheldCents,
      filedPeriodOf: filedPeriodFinder(options.filed, model),
    });
    for (const portion of portions) items.push({ ...common, documentLabel: label, ...portion });
    if (voided && row.voidedAt) {
      items.push({ ...common, documentLabel: `${label} (anulación)`, date: civilIso(row.voidedAt, timeZone), allocation: "registration", baseCents: -group.baseCents, withheldCents: -group.withheldCents });
    }
  }
  return items;
}

/** Nóminas contabilizadas → partidas del apartado «rendimientos del trabajo» del 111 (claves A y E del 190). */
async function loadPayrollItems(companyId: string, options: LoadOptions): Promise<WithholdingItem[]> {
  const { year, settings } = options;
  const byPayment = settings.payrollWithholdingBasis === "payment";
  const rows = await db
    .select({
      id: payrollSlip.id,
      period: payrollSlip.period,
      concept: payrollSlip.concept,
      accrualDate: payrollSlip.accrualDate,
      paymentDate: payrollSlip.paymentDate,
      grossAmount: payrollSlip.grossAmount,
      inKindAmount: payrollSlip.inKindAmount,
      inKindWithholdingAmount: payrollSlip.inKindWithholdingAmount,
      withholdingAmount: payrollSlip.withholdingAmount,
      netAmount: payrollSlip.netAmount,
      employeeName: payrollEmployee.name,
      employeeTaxId: payrollEmployee.taxId,
      recipientKind: payrollEmployee.recipientKind,
      subkey190: payrollEmployee.subkey190,
      withholdingRate: payrollEmployee.withholdingRate,
    })
    .from(payrollSlip)
    .innerJoin(payrollEmployee, eq(payrollEmployee.id, payrollSlip.employeeId))
    .where(and(
      eq(payrollSlip.companyId, companyId),
      eq(payrollSlip.status, "posted"),
      // Por pago: la nómina de diciembre puede pagarse en enero del año siguiente.
      gte(payrollSlip.accrualDate, `${byPayment ? year - 1 : year}-01-01`),
      lt(payrollSlip.accrualDate, `${year + 1}-01-01`),
    ));

  const items: WithholdingItem[] = [];
  for (const row of rows) {
    const kind: RecipientKind = row.recipientKind === "director" ? "director" : "employee";
    const netCents = toCents(row.netAmount);
    const payments = row.paymentDate ? [{ date: row.paymentDate, cents: netCents }] : [];
    const common = {
      source: "payroll" as const,
      sourceId: row.id,
      documentLabel: `${row.concept} ${row.period} · ${row.employeeName}`,
      model: "111" as const,
      recipientTaxId: row.employeeTaxId,
      recipientName: row.employeeName,
      block: "work" as const,
      key190: key190For(kind),
      subkey190: subkey190For(kind, row.subkey190),
    };
    const parts = [
      { inKind: false, baseCents: toCents(row.grossAmount), withheldCents: toCents(row.withholdingAmount) },
      { inKind: true, baseCents: toCents(row.inKindAmount), withheldCents: toCents(row.inKindWithholdingAmount) },
    ];
    for (const part of parts) {
      if (part.baseCents === 0 && part.withheldCents === 0) continue;
      const portions = allocateWithholding({
        fallbackDate: row.accrualDate,
        fallbackKind: "accrual",
        basis: byPayment ? "payment" : "fallback",
        payments,
        payableCents: netCents,
        baseCents: part.baseCents,
        withheldCents: part.withheldCents,
        filedPeriodOf: filedPeriodFinder(options.filed, "111"),
      });
      const rate = part.baseCents !== 0 ? Math.round((part.withheldCents / part.baseCents) * 10_000) / 100 : null;
      for (const portion of portions) items.push({ ...common, inKind: part.inKind, rate, ...portion });
    }
  }
  return items;
}

/** Dividendos e intereses pagados → partidas del 123 (y del 193). */
async function loadCapitalIncomeItems(companyId: string, options: LoadOptions): Promise<WithholdingItem[]> {
  const rows = await db
    .select()
    .from(capitalIncomePayment)
    .where(and(
      eq(capitalIncomePayment.companyId, companyId),
      gte(capitalIncomePayment.paymentDate, `${options.year}-01-01`),
      lt(capitalIncomePayment.paymentDate, `${options.year + 1}-01-01`),
    ));
  return rows.map((row) => ({
    source: "capitalIncome" as const,
    sourceId: row.id,
    documentLabel: `${row.kind === "dividend" ? "Dividendo" : "Intereses"} · ${row.recipientName}`,
    model: "123" as const,
    date: row.paymentDate,
    allocation: "payment" as const,
    recipientTaxId: row.recipientTaxId,
    recipientName: row.recipientName,
    inKind: false,
    baseCents: toCents(row.grossAmount),
    withheldCents: toCents(row.withholdingAmount),
    rate: Number(row.withholdingRate),
    capitalKind: row.kind === "dividend" ? "dividend" as const : "interest" as const,
  }));
}

/** Todas las partidas con retención imputadas al año natural indicado. */
export async function loadWithholdingItems(companyId: string, options: LoadOptions): Promise<WithholdingItem[]> {
  const [invoices, payroll, capital] = await Promise.all([
    loadSupplierInvoiceItems(companyId, options),
    loadPayrollItems(companyId, options),
    loadCapitalIncomeItems(companyId, options),
  ]);
  return itemsInRange([...invoices, ...payroll, ...capital], `${options.year}-01-01`, `${options.year + 1}-01-01`);
}

function periodicResult(code: "111" | "115" | "123", items: WithholdingItem[]) {
  if (code === "111") return computeModelo111(items).resultCents;
  if (code === "115") return computeModelo115(items).resultCents;
  return computeModelo123(items).resultCents;
}

/**
 * Resultados de las autoliquidaciones del año para cuadrar el resumen anual: el importe presentado
 * si el modelo está presentado y guarda su foto; si no, el calculado hoy. Los periodos son meses o
 * trimestres según la periodicidad de la empresa.
 */
function periodicFilings(code: "111" | "115" | "123", year: number, monthly: boolean, items: WithholdingItem[], filed: FiledPeriod[]): PeriodicFiling[] {
  const periods = monthly
    ? Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`)
    : [1, 2, 3, 4].map((quarter) => `${year}-Q${quarter}`);
  return periods.flatMap((period) => {
    const range = parseSpanishFiscalPeriod(period, code);
    if (!range) return [];
    const presented = filed.find((candidate) => candidate.code === code && candidate.period === period);
    if (presented && presented.resultCents !== null) return [{ period, resultCents: presented.resultCents, filed: true }];
    return [{ period, resultCents: periodicResult(code, itemsInRange(items, isoOf(range.start), isoOf(range.endExclusive))), filed: Boolean(presented) }];
  });
}

async function loadPersonalData(companyId: string): Promise<Map<string, Modelo190PersonalData>> {
  const rows = await db
    .select({
      taxId: payrollEmployee.taxId,
      birthYear: payrollEmployee.birthYear,
      familySituation: payrollEmployee.familySituation,
      disability: payrollEmployee.disability,
      contractType: payrollEmployee.contractType,
      spouseTaxId: payrollEmployee.spouseTaxId,
    })
    .from(payrollEmployee)
    .where(eq(payrollEmployee.companyId, companyId));
  return new Map(rows.filter((row) => row.taxId).map((row) => [normalizeRecipientTaxId(row.taxId), {
    birthYear: row.birthYear,
    familySituation: row.familySituation,
    disability: row.disability,
    contractType: row.contractType,
    spouseTaxId: row.spouseTaxId,
  }]));
}

async function loadRentalProperties(companyId: string): Promise<Map<string, RentalPropertyData[]>> {
  const rows = await db
    .select({
      taxId: partner.taxId,
      name: partner.name,
      situation: rentalProperty.situation,
      cadastralReference: rentalProperty.cadastralReference,
      address: rentalProperty.address,
      postalCode: rentalProperty.postalCode,
      city: rentalProperty.city,
      province: rentalProperty.province,
    })
    .from(rentalProperty)
    .innerJoin(partner, eq(partner.id, rentalProperty.supplierPartnerId))
    .where(eq(rentalProperty.companyId, companyId))
    .orderBy(rentalProperty.createdAt);
  const map = new Map<string, RentalPropertyData[]>();
  for (const row of rows) {
    const key = normalizeRecipientTaxId(row.taxId) || `sin-nif:${row.name.trim().toLowerCase()}`;
    const list = map.get(key) ?? [];
    list.push({ situation: row.situation, cadastralReference: row.cadastralReference, address: row.address, postalCode: row.postalCode, city: row.city, province: row.province });
    map.set(key, list);
  }
  return map;
}

async function draftSlipCheck(companyId: string, start: string, endExclusive: string): Promise<WithholdingCheck[]> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(payrollSlip)
    .where(and(eq(payrollSlip.companyId, companyId), eq(payrollSlip.status, "draft"), gte(payrollSlip.accrualDate, start), lt(payrollSlip.accrualDate, endExclusive)));
  if (!row || row.count === 0) return [];
  return [{
    code: "payroll-draft-slips",
    status: "warning",
    title: "Nóminas sin contabilizar",
    detail: `${row.count} nómina(s) del periodo están en borrador y no entran en el modelo.`,
    action: "Contabilízalas en Nóminas y retenciones › Nóminas, o elimínalas si no proceden.",
  }];
}

export type WithholdingModelData = {
  summary: WithholdingModelSummary;
  /** Partidas del periodo (detalle por documento). */
  items: WithholdingItem[];
};

/**
 * Calcula un modelo de retenciones para un periodo ("2026-Q1", "2026-04" o "2026" en los anuales).
 * Devuelve null si el periodo no es válido para el modelo.
 */
export async function loadWithholdingModel(
  companyId: string,
  code: WithholdingModelCode,
  period: string,
  timeZone: string = FISCAL_TIME_ZONE_PENINSULA,
): Promise<WithholdingModelData | null> {
  const range = parseSpanishFiscalPeriod(period, code);
  if (!range) return null;
  const year = range.start.getUTCFullYear();
  const start = isoOf(range.start);
  const endExclusive = isoOf(range.endExclusive);
  const [settings, filed, company] = await Promise.all([
    getPayrollSettings(companyId),
    loadFiledWithholdingPeriods(companyId),
    db.select({ taxPeriodicity: companySettings.taxPeriodicity }).from(companySettings).where(eq(companySettings.companyId, companyId)).limit(1),
  ]);
  const yearItems = await loadWithholdingItems(companyId, { year, timeZone, settings, filed });
  const base = { code, period, invoiceBasis: settings.invoiceWithholdingBasis, payrollBasis: settings.payrollWithholdingBasis };
  const monthly = company[0]?.taxPeriodicity === "monthly";

  if (code === "111" || code === "115" || code === "123") {
    const items = itemsInRange(yearItems, start, endExclusive).filter((item) => item.model === code);
    const checks = allocationChecks(items, settings.invoiceWithholdingBasis);
    if (code === "111") {
      checks.push(...(await draftSlipCheck(companyId, start, endExclusive)));
      const modelo111 = computeModelo111(items);
      const baseCents = modelo111.blocks.reduce((total, block) => total + block.cash.baseCents + block.inKind.baseCents, 0);
      return { items, summary: { ...base, boxes: modelo111.boxes, baseCents, withheldCents: modelo111.totalCents, resultCents: modelo111.resultCents, modelo111, checks } };
    }
    if (code === "115") {
      const modelo115 = computeModelo115(items);
      return { items, summary: { ...base, boxes: modelo115.boxes, baseCents: modelo115.baseCents, withheldCents: modelo115.withheldCents, resultCents: modelo115.resultCents, modelo115, checks } };
    }
    const modelo123 = computeModelo123(items);
    return { items, summary: { ...base, boxes: modelo123.boxes, baseCents: modelo123.dividends.baseCents + modelo123.other.baseCents, withheldCents: modelo123.withheldCents, resultCents: modelo123.resultCents, modelo123, checks } };
  }

  const periodic = ANNUAL_SUMMARY_OF[code];
  const items = yearItems.filter((item) => item.model === periodic);
  const periods = periodicFilings(periodic, year, monthly, yearItems, filed);
  if (code === "190") {
    const modelo190 = computeModelo190(items, { periods, personalData: await loadPersonalData(companyId) });
    const checks = [...modelo190.checks, ...(await draftSlipCheck(companyId, start, endExclusive))];
    return { items, summary: { ...base, boxes: [], baseCents: modelo190.totalIncomeCents, withheldCents: modelo190.totalWithheldCents, resultCents: null, modelo190, checks } };
  }
  if (code === "180") {
    const modelo180 = computeModelo180(items, { periods, properties: await loadRentalProperties(companyId) });
    return { items, summary: { ...base, boxes: [], baseCents: modelo180.totalBaseCents, withheldCents: modelo180.totalWithheldCents, resultCents: null, modelo180, checks: modelo180.checks } };
  }
  const modelo193 = computeModelo193(items, { periods });
  return { items, summary: { ...base, boxes: [], baseCents: modelo193.totalBaseCents, withheldCents: modelo193.totalWithheldCents, resultCents: null, modelo193, checks: modelo193.checks } };
}

/**
 * Retenciones apuntadas en la 4751 por los asientos de este módulo (nóminas y rendimientos del
 * capital) entre dos instantes, con sus contraasientos. Sirve para conciliar la 4751: las facturas
 * recibidas las suma aparte el cálculo fiscal. Importe en céntimos (haber − debe).
 */
export async function sumPayrollLedgerWithholdings(companyId: string, start: Date, endExclusive: Date): Promise<number> {
  const [row] = await db
    .select({
      debit: sql<string>`coalesce(sum(${journalLine.debit}), '0')`,
      credit: sql<string>`coalesce(sum(${journalLine.credit}), '0')`,
    })
    .from(journalLine)
    .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
    .innerJoin(accountChart, eq(accountChart.id, journalLine.accountId))
    .where(and(
      eq(journalEntry.companyId, companyId),
      gte(journalEntry.postedAt, start),
      lt(journalEntry.postedAt, endExclusive),
      inArray(journalEntry.sourceType, [...PAYROLL_SOURCE_TYPES]),
      sql`${accountChart.code} like '4751%'`,
    ));
  return toCents(row?.credit) - toCents(row?.debit);
}

export type WithholdingActivity = {
  /** Hay nóminas contabilizadas con devengo en el rango. */
  payroll: boolean;
  /** Hay rendimientos del capital pagados en el rango. */
  capitalIncome: boolean;
  /** Hay facturas de profesionales con retención registradas en el rango. */
  professional: boolean;
  /** Hay facturas de alquiler (cuenta 621) con retención registradas en el rango. */
  rent: boolean;
  enabledModels: string[];
};

/** ¿Hay nóminas o rendimientos del capital entre dos fechas civiles? (para el calendario y las obligaciones). */
export async function getWithholdingActivity(companyId: string, start: string, endExclusive: string): Promise<WithholdingActivity> {
  const [settings, slips, capital, invoices] = await Promise.all([
    getPayrollSettings(companyId),
    db.select({ id: payrollSlip.id }).from(payrollSlip)
      .where(and(eq(payrollSlip.companyId, companyId), eq(payrollSlip.status, "posted"), gte(payrollSlip.accrualDate, start), lt(payrollSlip.accrualDate, endExclusive)))
      .limit(1),
    db.select({ id: capitalIncomePayment.id }).from(capitalIncomePayment)
      .where(and(eq(capitalIncomePayment.companyId, companyId), gte(capitalIncomePayment.paymentDate, start), lt(capitalIncomePayment.paymentDate, endExclusive)))
      .limit(1),
    db
      .select({
        rent: sql<number>`count(*) filter (where ${accountChart.code} like '621%')::int`,
        professional: sql<number>`count(*) filter (where ${accountChart.code} is null or ${accountChart.code} not like '621%')::int`,
      })
      .from(supplierInvoiceLine)
      .innerJoin(supplierInvoice, eq(supplierInvoice.id, supplierInvoiceLine.supplierInvoiceId))
      .leftJoin(accountChart, eq(accountChart.id, supplierInvoiceLine.expenseAccountId))
      .where(and(
        eq(supplierInvoice.companyId, companyId),
        sql`${supplierInvoice.status} not in ('VOID', 'DRAFT')`,
        ne(supplierInvoiceLine.retentionAmount, "0"),
        gte(supplierInvoice.accountingDate, new Date(`${start}T00:00:00.000Z`)),
        lt(supplierInvoice.accountingDate, new Date(`${endExclusive}T00:00:00.000Z`)),
      )),
  ]);
  return {
    payroll: slips.length > 0,
    capitalIncome: capital.length > 0,
    professional: (invoices[0]?.professional ?? 0) > 0,
    rent: (invoices[0]?.rent ?? 0) > 0,
    enabledModels: settings.enabledModels,
  };
}
