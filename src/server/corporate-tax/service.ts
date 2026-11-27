import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import {
  accountChart,
  bankAccount,
  company,
  companySettings,
  corporateTaxInstallment,
  corporateTaxLoss,
  corporateTaxReturn,
  corporateTaxSettings,
  fiscalYear,
  fixedAsset,
  fixedAssetDepreciation,
  journalEntry,
  journalLine,
  type CorporateTaxReturnInputs,
} from "@/db/schema";
import { getCountryFiscalProfile } from "@/lib/country-packs/profile";
import { db, type DbClient } from "@/lib/db";
import { normalizeTaxpayerType } from "@/lib/fiscal-spain";
import { HttpError } from "@/lib/http";
import { createAutomaticEntry, resolveBankLedgerAccountId, reverseAutomaticEntries } from "@/server/accounting/auto-post";
import { AccountingRuleError } from "@/server/accounting/errors";
import { centsToAmount, toCents } from "@/server/accounting/money";
import { buildOfficialStatements, type OfficialStatements } from "@/server/accounting/official-statements-model";
import { loadStatementAccountRows } from "@/server/accounting/statements";
import type { StatementAccountRow } from "@/server/accounting/statements-model";
import { ensureSubaccount } from "@/server/accounting/subaccounts";
import { recordAudit } from "@/server/audit";
import { depreciationExcessCents } from "@/server/corporate-tax/adjustments-catalog";
import { civilDay, corporateTaxReturnWindow, DEFAULT_REMINDER_SETTINGS, installmentDueDate, periodDays, type CorporateReminderSettings } from "@/server/corporate-tax/deadlines";
import {
  baseMethodMandatory,
  computeBaseInstallment,
  computeQuotaInstallment,
  INSTALLMENT_PERIODS,
  installmentPeriodInfo,
  type BaseInstallmentResult,
  type InstallmentMethod,
  type InstallmentPeriod,
  type QuotaInstallmentResult,
} from "@/server/corporate-tax/installments-model";
import { computeCorporateTax, type CorporateTaxResult, type CorporateTaxWarning, type LossCarryforward } from "@/server/corporate-tax/liquidation";
import {
  buildCorporateTaxEntryLines,
  computeDeferredTax,
  CORPORATE_TAX_ACCOUNTS,
  hasDeferredTax,
  type CorporateTaxEntryLine,
  type DeferredTax,
} from "@/server/corporate-tax/posting-model";
import { CORPORATE_TAX_REGIMES, suggestedRegime, type CorporateTaxRegime } from "@/server/corporate-tax/rates";
import type { CorporateTaxReturnInput, InstallmentInput } from "@/server/corporate-tax/schemas";
import { fiscalYearEndExclusive, assertFiscalYearOpen } from "@/server/fiscal/locks";
import { findTaxCoefficient } from "@/server/fixed-assets/tax-coefficients";

export type Actor = { tenantId: string; companyId: string; actorUserId: string };

/** Origen (`journal_entry.sourceType`) de los asientos del módulo. */
export const CORPORATE_TAX_SOURCE = {
  taxEntry: "corporateTaxReturn",
  installmentPayment: "corporateTaxInstallment",
} as const;

type YearRow = { id: string; code: string; startsAt: Date; endsAt: Date; isClosed: boolean };
type ReturnRow = typeof corporateTaxReturn.$inferSelect;
type InstallmentRow = typeof corporateTaxInstallment.$inferSelect;

const iso = (date: Date) => date.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------------------------
// Disponibilidad: solo sociedades de un país con modelos tributarios españoles
// ---------------------------------------------------------------------------------------------

/** ¿La empresa tributa por el Impuesto sobre Sociedades? (país con modelos de la AEAT y contribuyente «sociedad»). */
export async function isCorporateTaxCompany(companyId: string, countryCode: string | null | undefined, client: DbClient = db) {
  if (!getCountryFiscalProfile(countryCode).features.taxReports) return false;
  const [settings] = await client
    .select({ taxpayerType: companySettings.taxpayerType })
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);
  return normalizeTaxpayerType(settings?.taxpayerType) === "company";
}

export async function assertCorporateTaxCompany(companyId: string, countryCode: string | null | undefined) {
  if (!(await isCorporateTaxCompany(companyId, countryCode))) {
    throw new HttpError(422, "El Impuesto sobre Sociedades solo está disponible para sociedades. Si eres autónomo, tu pago a cuenta es el modelo 130.");
  }
}

// ---------------------------------------------------------------------------------------------
// Datos de apoyo
// ---------------------------------------------------------------------------------------------

export function defaultReturnInputs(regime: CorporateTaxRegime = "general"): CorporateTaxReturnInputs {
  return {
    regime,
    customRatePct: null,
    priorYearRevenueCents: null,
    adjustments: [],
    capitalizationReserveCents: 0,
    lossCompensationCents: null,
    levelingReductionCents: 0,
    levelingAdditionCents: 0,
    credits: [],
    withholdingsOverrideCents: null,
    installmentsOverrideCents: null,
  };
}

function normalizeRegime(value: string | null | undefined): CorporateTaxRegime {
  return (CORPORATE_TAX_REGIMES as readonly string[]).includes(value ?? "") ? (value as CorporateTaxRegime) : "general";
}

async function loadYears(companyId: string, client: DbClient = db): Promise<YearRow[]> {
  return client
    .select({ id: fiscalYear.id, code: fiscalYear.code, startsAt: fiscalYear.startsAt, endsAt: fiscalYear.endsAt, isClosed: fiscalYear.isClosed })
    .from(fiscalYear)
    .where(eq(fiscalYear.companyId, companyId))
    .orderBy(asc(fiscalYear.startsAt));
}

function requireYear(years: YearRow[], fiscalYearId: string) {
  const year = years.find((entry) => entry.id === fiscalYearId);
  if (!year) throw new AccountingRuleError(404, "FISCAL_YEAR_NOT_FOUND", "Ejercicio no encontrado.");
  return year;
}

function yearRange(year: YearRow) {
  return { yearStart: year.startsAt, from: year.startsAt, toExclusive: fiscalYearEndExclusive(year.endsAt) };
}

const lineAmountCents = (statements: OfficialStatements, id: string) => Math.round((statements.incomeStatement.find((line) => line.id === id)?.amount ?? 0) * 100);

/** Saldo deudor (debe − haber) al final del periodo de las cuentas que empiezan por `prefix`. */
function closingBalanceCents(rows: readonly StatementAccountRow[], prefix: string) {
  return rows.filter((row) => row.code.startsWith(prefix)).reduce((sum, row) => sum + row.priorCents + row.debitCents - row.creditCents, 0);
}

/** Movimiento neto (debe − haber) del periodo de las cuentas que empiezan por `prefix`. */
function periodNetCents(rows: readonly StatementAccountRow[], prefix: string) {
  return rows.filter((row) => row.code.startsWith(prefix)).reduce((sum, row) => sum + row.debitCents - row.creditCents, 0);
}

/**
 * Apuntes netos (debe − haber) por cuenta de los asientos del impuesto de una liquidación, con sus
 * anulaciones: lo que hay que descontar del libro para ver los saldos «antes del asiento del impuesto».
 */
async function ownEntryNetByCode(client: DbClient, companyId: string, returnId: string | null) {
  if (!returnId) return new Map<string, number>();
  const rows = await client
    .select({ code: accountChart.code, net: sql<string>`coalesce(sum(${journalLine.debit} - ${journalLine.credit}), 0)` })
    .from(journalLine)
    .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
    .innerJoin(accountChart, eq(accountChart.id, journalLine.accountId))
    .where(and(eq(journalEntry.companyId, companyId), eq(journalEntry.sourceType, CORPORATE_TAX_SOURCE.taxEntry), eq(journalEntry.sourceId, returnId)))
    .groupBy(accountChart.code);
  return new Map(rows.map((row) => [row.code, toCents(row.net)]));
}

function sumByPrefix(byCode: ReadonlyMap<string, number>, prefix: string) {
  let total = 0;
  for (const [code, cents] of byCode) if (code.startsWith(prefix)) total += cents;
  return total;
}

// ---------------------------------------------------------------------------------------------
// Bases imponibles negativas
// ---------------------------------------------------------------------------------------------

export type LossRegisterRow = {
  originYear: number;
  /** manual: anotada a mano (anterior al programa). return: nace de una liquidación presentada aquí. */
  source: "manual" | "return";
  manualId: string | null;
  originalCents: number;
  /** Compensado en liquidaciones presentadas de ejercicios anteriores al consultado. */
  appliedCents: number;
  pendingCents: number;
  notes: string | null;
};

type FiledSnapshot = Partial<Pick<CorporateTaxResult, "generatedLossCents" | "grossQuotaCents" | "creditsAppliedCents" | "withholdingsCents">> & {
  losses?: { applied?: Array<{ originYear: number; amountCents: number }> };
};

/**
 * Registro de bases negativas disponibles para el ejercicio que empieza en `before`: las anotadas a
 * mano más las que nacen de liquidaciones presentadas de ejercicios anteriores, menos lo ya
 * compensado en esas liquidaciones. Las liquidaciones sin presentar no cuentan (art. 26.1: «que
 * hayan sido objeto de liquidación o autoliquidación») y se devuelven en `unfiledYears`.
 */
async function loadLossRegister(client: DbClient, companyId: string, years: YearRow[], before: Date | null) {
  const [manual, returns] = await Promise.all([
    client.select().from(corporateTaxLoss).where(eq(corporateTaxLoss.companyId, companyId)).orderBy(asc(corporateTaxLoss.originYear)),
    client.select().from(corporateTaxReturn).where(eq(corporateTaxReturn.companyId, companyId)),
  ]);
  const yearById = new Map(years.map((year) => [year.id, year]));
  const earlier = returns
    .map((row) => ({ row, year: yearById.get(row.fiscalYearId) }))
    .filter((entry): entry is { row: ReturnRow; year: YearRow } => Boolean(entry.year) && (before === null || entry.year!.endsAt < before));

  const register = new Map<number, LossRegisterRow>();
  for (const loss of manual) {
    const cents = toCents(loss.amount);
    register.set(loss.originYear, { originYear: loss.originYear, source: "manual", manualId: loss.id, originalCents: cents, appliedCents: 0, pendingCents: cents, notes: loss.notes });
  }
  const unfiledYears: string[] = [];
  const ignoredManualYears: number[] = [];
  for (const { row, year } of earlier) {
    if (row.status !== "filed") {
      unfiledYears.push(year.code);
      continue;
    }
    const snapshot = (row.filedSnapshot ?? {}) as FiledSnapshot;
    const generated = Math.max(Math.round(Number(snapshot.generatedLossCents ?? 0)), 0);
    if (generated > 0) {
      const originYear = year.startsAt.getUTCFullYear();
      const existing = register.get(originYear);
      if (existing?.source === "manual") ignoredManualYears.push(originYear);
      register.set(originYear, { originYear, source: "return", manualId: existing?.manualId ?? null, originalCents: generated, appliedCents: 0, pendingCents: generated, notes: `Liquidación presentada de ${year.code}` });
    }
  }
  for (const { row } of earlier) {
    if (row.status !== "filed") continue;
    const snapshot = (row.filedSnapshot ?? {}) as FiledSnapshot;
    for (const applied of snapshot.losses?.applied ?? []) {
      const entry = register.get(applied.originYear);
      if (!entry) continue;
      entry.appliedCents += applied.amountCents;
      entry.pendingCents = Math.max(entry.originalCents - entry.appliedCents, 0);
    }
  }
  return { rows: [...register.values()].sort((a, b) => a.originYear - b.originYear), unfiledYears, ignoredManualYears };
}

export async function listLossRegister(companyId: string) {
  return loadLossRegister(db, companyId, await loadYears(companyId), null);
}

export async function saveManualLoss(actor: Actor, input: { originYear: number; amountCents: number; notes?: string | null }) {
  const [row] = await db
    .insert(corporateTaxLoss)
    .values({ companyId: actor.companyId, originYear: input.originYear, amount: centsToAmount(input.amountCents), notes: input.notes?.trim() || null })
    .onConflictDoUpdate({
      target: [corporateTaxLoss.companyId, corporateTaxLoss.originYear],
      set: { amount: centsToAmount(input.amountCents), notes: input.notes?.trim() || null },
    })
    .returning();
  await recordAudit({ ...actor, action: "corporateTax.loss.save", entityName: "corporateTaxLoss", entityId: row.id, payload: { originYear: input.originYear, amountCents: input.amountCents } });
  return row;
}

export async function deleteManualLoss(actor: Actor, id: string) {
  const [row] = await db.delete(corporateTaxLoss).where(and(eq(corporateTaxLoss.companyId, actor.companyId), eq(corporateTaxLoss.id, id))).returning();
  if (!row) throw new HttpError(404, "Base negativa no encontrada.");
  await recordAudit({ ...actor, action: "corporateTax.loss.delete", entityName: "corporateTaxLoss", entityId: id, payload: { originYear: row.originYear } });
  return { id };
}

// ---------------------------------------------------------------------------------------------
// Liquidación del ejercicio
// ---------------------------------------------------------------------------------------------

export type AdjustmentSuggestion = { kind: string; concept: string; amountCents: number; detail: string };

export type ReconciliationRow = { label: string; ledgerCents: number; liquidationCents: number; differenceCents: number; help: string };

export type EntryPreviewLine = CorporateTaxEntryLine & { accountCode: string };

export type CorporateTaxView = {
  year: { id: string; code: string; start: string; end: string; isClosed: boolean; startYear: number; periodDays: number };
  returnId: string | null;
  inputs: CorporateTaxReturnInputs;
  status: "draft" | "filed";
  filedAt: string | null;
  filingReceiptNumber: string | null;
  facts: {
    accountingResultBeforeTaxCents: number;
    /** Gasto por impuesto contabilizado (6300, 6301, 633 y 638), con el asiento del programa incluido. */
    taxExpensePostedCents: number;
    revenueCents: number;
    /** Cifra de negocios del ejercicio anterior según el libro; null si ese ejercicio no está en el programa. */
    ledgerPriorYearRevenueCents: number | null;
    priorYearRevenueCents: number | null;
    /** Saldo de la 473 al cierre, sin el asiento del impuesto. */
    account473Cents: number;
    installmentsPaidCents: number;
    ledgerWithholdingsCents: number;
  };
  suggestedRegime: CorporateTaxRegime;
  losses: LossRegisterRow[];
  result: CorporateTaxResult;
  deferred: DeferredTax;
  entry: {
    lines: EntryPreviewLine[];
    posted: { journalEntryId: string; postedAt: string | null } | null;
    /** El asiento contabilizado coincide con el cálculo actual. */
    upToDate: boolean;
    /** Hay gasto por impuesto en el libro que no viene del asiento del programa. */
    manualTaxExpenseCents: number;
  };
  reconciliation: ReconciliationRow[];
  suggestions: AdjustmentSuggestion[];
  window: { from: string; to: string };
  warnings: CorporateTaxWarning[];
};

function postedSnapshotOf(view: Pick<CorporateTaxView, "result" | "deferred">) {
  return {
    netQuotaCents: view.result.netQuotaCents,
    withholdingsCents: view.result.withholdingsCents,
    installmentsCents: view.result.installmentsCents,
    deferredAssetCents: view.deferred.assetChangeCents,
    deferredLiabilityCents: view.deferred.liabilityChangeCents,
  };
}

function sameSnapshot(a: Record<string, number> | null | undefined, b: Record<string, number>) {
  return Boolean(a) && Object.keys(b).every((key) => Number(a?.[key] ?? 0) === b[key]);
}

async function depreciationSuggestions(client: DbClient, companyId: string, year: YearRow): Promise<AdjustmentSuggestion[]> {
  const start = iso(year.startsAt);
  const end = iso(year.endsAt);
  const assets = await client
    .select()
    .from(fixedAsset)
    .where(and(eq(fixedAsset.companyId, companyId), eq(fixedAsset.isDepreciable, true), isNotNull(fixedAsset.taxCoefficientKey)));
  if (assets.length === 0) return [];
  const postings = await client
    .select({ assetId: fixedAssetDepreciation.assetId, amount: sql<string>`coalesce(sum(${fixedAssetDepreciation.amount}), 0)` })
    .from(fixedAssetDepreciation)
    .where(and(
      eq(fixedAssetDepreciation.companyId, companyId),
      inArray(fixedAssetDepreciation.assetId, assets.map((asset) => asset.id)),
      sql`${fixedAssetDepreciation.periodEnd} >= ${start}`,
      sql`${fixedAssetDepreciation.periodEnd} <= ${end}`,
    ))
    .groupBy(fixedAssetDepreciation.assetId);
  const postedByAsset = new Map(postings.map((row) => [row.assetId, toCents(row.amount)]));
  const dayNumber = (value: string) => Date.parse(`${value}T00:00:00.000Z`) / 86_400_000;
  const daysInYear = dayNumber(end) - dayNumber(start) + 1;
  const suggestions: AdjustmentSuggestion[] = [];
  for (const asset of assets) {
    const coefficient = findTaxCoefficient(asset.taxCoefficientKey);
    const posted = postedByAsset.get(asset.id) ?? 0;
    if (!coefficient || posted <= 0) continue;
    const from = Math.max(dayNumber(asset.depreciationStartDate ?? asset.inServiceDate), dayNumber(start));
    const to = Math.min(asset.disposalDate ? dayNumber(asset.disposalDate) : Infinity, dayNumber(end));
    const excess = depreciationExcessCents({
      yearDepreciationCents: posted,
      depreciableCents: toCents(asset.acquisitionCost) - toCents(asset.residualValue),
      maxPct: coefficient.maxPct,
      daysInUse: Math.max(to - from + 1, 0),
      daysInYear,
    });
    if (excess > 0) {
      suggestions.push({
        kind: "depreciation-excess",
        concept: `Exceso de amortización de ${asset.code} · ${asset.description}`.slice(0, 160),
        amountCents: excess,
        detail: `Amortización contabilizada en el ejercicio por encima del coeficiente máximo del ${coefficient.maxPct} % de «${coefficient.label}».`,
      });
    }
  }
  return suggestions;
}

/** Liquidación completa del ejercicio con los datos guardados (o los indicados en `inputsOverride`, sin guardar). */
export async function getCorporateTaxYear(
  companyId: string,
  fiscalYearId: string,
  options: { inputsOverride?: CorporateTaxReturnInputs; client?: DbClient } = {},
): Promise<CorporateTaxView> {
  const client = options.client ?? db;
  const years = await loadYears(companyId, client);
  const year = requireYear(years, fiscalYearId);
  const previousYear = [...years].reverse().find((entry) => entry.endsAt < year.startsAt) ?? null;

  const [storedRows, rows, previousRows, installments, lossRegister, suggestionsFromAssets] = await Promise.all([
    client.select().from(corporateTaxReturn).where(and(eq(corporateTaxReturn.companyId, companyId), eq(corporateTaxReturn.fiscalYearId, fiscalYearId))).limit(1),
    loadStatementAccountRows(companyId, yearRange(year)),
    previousYear ? loadStatementAccountRows(companyId, yearRange(previousYear)) : Promise.resolve(null),
    client.select().from(corporateTaxInstallment).where(and(eq(corporateTaxInstallment.companyId, companyId), eq(corporateTaxInstallment.fiscalYearId, fiscalYearId))),
    loadLossRegister(client, companyId, years, year.startsAt),
    depreciationSuggestions(client, companyId, year),
  ]);
  const stored = storedRows[0] ?? null;
  const ownNet = await ownEntryNetByCode(client, companyId, stored?.id ?? null);

  const statements = buildOfficialStatements(rows);
  const accountingResultBeforeTaxCents = lineAmountCents(statements, "PG.C");
  const taxExpensePostedCents = -lineAmountCents(statements, "PG.17");
  const revenueCents = lineAmountCents(statements, "PG.1");
  const ledgerPriorYearRevenueCents = previousRows ? lineAmountCents(buildOfficialStatements(previousRows), "PG.1") : null;

  const suggested = suggestedRegime(stored?.inputs.priorYearRevenueCents ?? ledgerPriorYearRevenueCents);
  const inputs: CorporateTaxReturnInputs = options.inputsOverride ?? (stored ? { ...defaultReturnInputs(), ...stored.inputs } : defaultReturnInputs(suggested));
  const priorYearRevenueCents = inputs.priorYearRevenueCents ?? ledgerPriorYearRevenueCents;
  const regime = normalizeRegime(inputs.regime);

  const account473Cents = closingBalanceCents(rows, "473") - sumByPrefix(ownNet, "473");
  const installmentsPaidCents = installments.filter((row) => row.journalEntryId).reduce((sum, row) => sum + toCents(row.paidAmount), 0);
  const ledgerWithholdingsCents = account473Cents - installmentsPaidCents;

  const warnings: CorporateTaxWarning[] = [];
  if (inputs.withholdingsOverrideCents === null && ledgerWithholdingsCents < 0) {
    warnings.push({ code: "withholdings-negative", message: "El saldo de la cuenta 473 es menor que los pagos fraccionados registrados. Revisa la cuenta 473 o indica las retenciones a mano." });
  }
  const startYear = year.startsAt.getUTCFullYear();
  const days = periodDays(year.startsAt, year.endsAt);
  const result = computeCorporateTax({
    accountingResultBeforeTaxCents,
    adjustments: inputs.adjustments,
    capitalizationReserveCents: inputs.capitalizationReserveCents,
    losses: lossRegister.rows.map((row): LossCarryforward => ({ originYear: row.originYear, pendingCents: row.pendingCents })),
    lossCompensationCents: inputs.lossCompensationCents,
    levelingReductionCents: inputs.levelingReductionCents,
    levelingAdditionCents: inputs.levelingAdditionCents,
    regime,
    customRatePct: inputs.customRatePct,
    startYear,
    periodDays: days,
    credits: inputs.credits,
    withholdingsCents: inputs.withholdingsOverrideCents ?? Math.max(ledgerWithholdingsCents, 0),
    installmentsCents: inputs.installmentsOverrideCents ?? installmentsPaidCents,
  });
  warnings.push(...result.warnings);

  if (lossRegister.unfiledYears.length > 0) {
    warnings.push({ code: "prior-returns-unfiled", message: `La liquidación de ${lossRegister.unfiledYears.join(", ")} no está marcada como presentada: sus bases negativas y lo que compensó no se tienen en cuenta aquí.` });
  }
  if (lossRegister.ignoredManualYears.length > 0) {
    warnings.push({ code: "loss-duplicated", message: `Hay una base negativa anotada a mano de ${lossRegister.ignoredManualYears.join(", ")} y otra de la liquidación presentada de ese ejercicio: se usa la de la liquidación.` });
  }
  if (regime !== suggested && regime !== "newCompany" && regime !== "custom" && priorYearRevenueCents !== null) {
    warnings.push({ code: "regime-mismatch", message: "El tipo elegido no coincide con el que corresponde a la cifra de negocios del ejercicio anterior. Compruébalo: la sociedad puede ser patrimonial o formar parte de un grupo, y entonces no aplican los tipos reducidos." });
  }
  if ((priorYearRevenueCents ?? 0) >= 20_000_000_00) {
    warnings.push({ code: "large-company", message: "Con una cifra de negocios de 20 millones o más hay límites y una tributación mínima que este asistente no calcula (disposición adicional 15.ª y art. 30 bis de la Ley 27/2014)." });
  }
  if (days < 365) {
    warnings.push({ code: "short-period", message: `El ejercicio dura ${days} días: el tramo de 50.000 € de la escala y el mínimo de 1 millón de bases negativas se han prorrateado. La cifra de negocios del ejercicio anterior debe elevarse al año.` });
  }

  const deferred = computeDeferredTax(inputs.adjustments, result.marginalRatePct);
  const entryLines = buildCorporateTaxEntryLines({
    netQuotaCents: result.netQuotaCents,
    withholdingsCents: result.withholdingsCents,
    installmentsCents: result.installmentsCents,
    deferred: hasDeferredTax(deferred) ? deferred : null,
    yearCode: year.code,
  });
  const ownTaxExpenseCents = sumByPrefix(ownNet, "630");
  const manualTaxExpenseCents = taxExpensePostedCents - ownTaxExpenseCents;
  if (manualTaxExpenseCents !== 0) {
    warnings.push({ code: "manual-tax-expense", message: "Hay gasto por impuesto sobre beneficios contabilizado a mano (cuentas 630, 633 o 638). Si contabilizas también el asiento del programa, el impuesto quedará duplicado." });
  }
  const paidOnAccount = result.withholdingsCents + result.installmentsCents;
  if (paidOnAccount > Math.max(account473Cents, 0)) {
    warnings.push({ code: "account-473-short", message: "Las retenciones y pagos fraccionados de la liquidación superan el saldo de la cuenta 473: al contabilizar el impuesto, la 473 quedará con saldo acreedor. Registra antes los pagos fraccionados o las retenciones que falten." });
  }

  const posted = stored?.journalEntryId ? { journalEntryId: stored.journalEntryId, postedAt: stored.postedAt?.toISOString() ?? null } : null;
  const view = { result, deferred };
  const fines = periodNetCents(rows, "678");
  const suggestions: AdjustmentSuggestion[] = [
    ...(fines > 0 ? [{ kind: "fines", concept: "Multas y sanciones (cuenta 678)", amountCents: fines, detail: "Saldo de la cuenta 678 «Gastos excepcionales». Incluye solo la parte que sean multas, sanciones o recargos: el resto de gastos excepcionales sí es deducible." }] : []),
    ...suggestionsFromAssets,
  ];

  const window = corporateTaxReturnWindow(year.endsAt);
  return {
    year: { id: year.id, code: year.code, start: iso(year.startsAt), end: iso(year.endsAt), isClosed: year.isClosed, startYear, periodDays: days },
    returnId: stored?.id ?? null,
    inputs: { ...inputs, regime },
    status: stored?.status === "filed" ? "filed" : "draft",
    filedAt: stored?.filedAt?.toISOString() ?? null,
    filingReceiptNumber: stored?.filingReceiptNumber ?? null,
    facts: { accountingResultBeforeTaxCents, taxExpensePostedCents, revenueCents, ledgerPriorYearRevenueCents, priorYearRevenueCents, account473Cents, installmentsPaidCents, ledgerWithholdingsCents },
    suggestedRegime: suggested,
    losses: lossRegister.rows,
    result,
    deferred,
    entry: {
      lines: entryLines.map((line) => ({ ...line, accountCode: CORPORATE_TAX_ACCOUNTS[line.role] })),
      posted,
      upToDate: Boolean(posted) && sameSnapshot(stored?.postedSnapshot, postedSnapshotOf(view)),
      manualTaxExpenseCents,
    },
    reconciliation: [
      {
        label: "Resultado contable antes de impuestos",
        ledgerCents: accountingResultBeforeTaxCents,
        liquidationCents: result.accountingResultBeforeTaxCents,
        differenceCents: 0,
        help: "Resultado antes de impuestos de la cuenta de pérdidas y ganancias (epígrafe C del modelo abreviado).",
      },
      {
        label: "Retenciones y pagos a cuenta (cuenta 473)",
        ledgerCents: account473Cents,
        liquidationCents: paidOnAccount,
        differenceCents: account473Cents - paidOnAccount,
        help: "Saldo de la 473 al cierre, antes del asiento del impuesto, frente a las retenciones y pagos fraccionados de la liquidación.",
      },
      {
        label: "Gasto por impuesto sobre beneficios (cuentas 630)",
        ledgerCents: taxExpensePostedCents,
        liquidationCents: result.netQuotaCents + deferred.expenseCents,
        differenceCents: taxExpensePostedCents - result.netQuotaCents - deferred.expenseCents,
        help: "Lo contabilizado como gasto por impuesto frente a la cuota líquida (más el impuesto diferido) calculada. Coincide cuando el asiento del impuesto está al día.",
      },
    ],
    suggestions: suggestions.filter((suggestion) => !inputs.adjustments.some((item) => item.kind === suggestion.kind && item.concept === suggestion.concept)),
    window: { from: iso(window.from), to: iso(window.to) },
    warnings,
  };
}

function toStoredInputs(input: CorporateTaxReturnInput): CorporateTaxReturnInputs {
  return {
    regime: input.regime,
    customRatePct: input.regime === "custom" ? input.customRatePct ?? null : null,
    priorYearRevenueCents: input.priorYearRevenueCents ?? null,
    adjustments: input.adjustments.filter((item) => item.amountCents > 0).map((item) => ({ ...item, concept: item.concept.trim() })),
    capitalizationReserveCents: input.capitalizationReserveCents,
    lossCompensationCents: input.lossCompensationCents ?? null,
    levelingReductionCents: input.levelingReductionCents,
    levelingAdditionCents: input.levelingAdditionCents,
    credits: input.credits.filter((item) => item.amountCents > 0).map((item) => ({ ...item, concept: item.concept.trim() })),
    withholdingsOverrideCents: input.withholdingsOverrideCents ?? null,
    installmentsOverrideCents: input.installmentsOverrideCents ?? null,
  };
}

/** Calcula con los datos del formulario sin guardar nada (vista previa mientras se edita). */
export async function previewCorporateTaxYear(companyId: string, fiscalYearId: string, input: CorporateTaxReturnInput) {
  return getCorporateTaxYear(companyId, fiscalYearId, { inputsOverride: toStoredInputs(input) });
}

async function lockReturn(tx: DbClient, companyId: string, fiscalYearId: string) {
  const [row] = await tx
    .select()
    .from(corporateTaxReturn)
    .where(and(eq(corporateTaxReturn.companyId, companyId), eq(corporateTaxReturn.fiscalYearId, fiscalYearId)))
    .limit(1)
    .for("update");
  return row ?? null;
}

function assertDraft(row: ReturnRow | null) {
  if (row?.status === "filed") {
    throw new HttpError(409, "Esta liquidación está marcada como presentada. Reábrela para cambiarla (si ya la presentaste, lo correcto es una declaración complementaria o una rectificación).");
  }
}

export async function saveCorporateTaxReturn(actor: Actor, fiscalYearId: string, input: CorporateTaxReturnInput) {
  const inputs = toStoredInputs(input);
  await db.transaction(async (tx) => {
    requireYear(await loadYears(actor.companyId, tx), fiscalYearId);
    const existing = await lockReturn(tx, actor.companyId, fiscalYearId);
    assertDraft(existing);
    const [row] = existing
      ? await tx.update(corporateTaxReturn).set({ inputs, updatedAt: new Date() }).where(eq(corporateTaxReturn.id, existing.id)).returning({ id: corporateTaxReturn.id })
      : await tx.insert(corporateTaxReturn).values({ companyId: actor.companyId, fiscalYearId, inputs }).returning({ id: corporateTaxReturn.id });
    await recordAudit({ ...actor, action: "corporateTax.return.save", entityName: "corporateTaxReturn", entityId: row.id, payload: { fiscalYearId } }, tx);
  });
  return getCorporateTaxYear(actor.companyId, fiscalYearId);
}

async function reverseTaxEntry(tx: DbClient, actor: Actor, row: ReturnRow, year: YearRow, reason: string) {
  if (!row.journalEntryId) return 0;
  return reverseAutomaticEntries({
    ...actor,
    dbClient: tx,
    postedAt: civilDay(year.endsAt),
    reference: reason,
    reason,
    sourceType: CORPORATE_TAX_SOURCE.taxEntry,
    sourceId: row.id,
  });
}

/**
 * Contabiliza el impuesto con fecha del último día del ejercicio (antes de la regularización y del
 * cierre). Si ya había asiento, lo anula con un contraasiento y genera el nuevo: se puede repetir
 * tantas veces como cambie la liquidación mientras el ejercicio esté abierto.
 */
export async function postCorporateTaxEntry(actor: Actor, fiscalYearId: string) {
  await db.transaction(async (tx) => {
    const year = requireYear(await loadYears(actor.companyId, tx), fiscalYearId);
    const postedAt = civilDay(year.endsAt);
    await assertFiscalYearOpen(actor.companyId, postedAt, tx);
    let row = await lockReturn(tx, actor.companyId, fiscalYearId);
    // El cálculo se hace antes de tocar el libro: los saldos se leen sin el asiento del impuesto
    // anterior (se descuenta), así que no cambia al anularlo.
    const view = await getCorporateTaxYear(actor.companyId, fiscalYearId, { client: tx });
    if (view.entry.lines.length === 0 && !row?.journalEntryId) {
      throw new HttpError(422, "No hay nada que contabilizar: la cuota es cero y no hay retenciones ni pagos a cuenta que regularizar.");
    }
    if (!row) {
      const [created] = await tx.insert(corporateTaxReturn).values({ companyId: actor.companyId, fiscalYearId, inputs: view.inputs }).returning();
      row = created;
    }
    await reverseTaxEntry(tx, actor, row, year, `Anulación del asiento del Impuesto sobre Sociedades ${year.code} (recálculo)`);
    await tx.update(corporateTaxReturn).set({ journalEntryId: null, postedAt: null, postedSnapshot: null }).where(eq(corporateTaxReturn.id, row.id));
    if (view.entry.lines.length === 0) return;
    const accountIds = new Map<string, string>();
    for (const line of view.entry.lines) {
      if (!accountIds.has(line.accountCode)) accountIds.set(line.accountCode, (await ensureSubaccount(actor.companyId, line.accountCode, tx)).id);
    }
    const entry = await createAutomaticEntry({
      ...actor,
      dbClient: tx,
      postedAt,
      reference: `Impuesto sobre Sociedades ${year.code}`,
      lines: view.entry.lines.map((line) => ({
        accountId: accountIds.get(line.accountCode)!,
        debit: centsToAmount(line.debitCents),
        credit: centsToAmount(line.creditCents),
        concept: line.concept,
      })),
      action: "corporateTax.return.post",
      entityName: CORPORATE_TAX_SOURCE.taxEntry,
      entityId: row.id,
      sourceType: CORPORATE_TAX_SOURCE.taxEntry,
      sourceId: row.id,
    });
    await tx
      .update(corporateTaxReturn)
      .set({ journalEntryId: entry.id, postedAt: new Date(), postedSnapshot: postedSnapshotOf(view), updatedAt: new Date() })
      .where(eq(corporateTaxReturn.id, row.id));
  });
  return getCorporateTaxYear(actor.companyId, fiscalYearId);
}

/** Anula el asiento del impuesto con un contraasiento. */
export async function unpostCorporateTaxEntry(actor: Actor, fiscalYearId: string) {
  await db.transaction(async (tx) => {
    const year = requireYear(await loadYears(actor.companyId, tx), fiscalYearId);
    const row = await lockReturn(tx, actor.companyId, fiscalYearId);
    if (!row?.journalEntryId) throw new HttpError(409, "El impuesto de este ejercicio no está contabilizado.");
    await assertFiscalYearOpen(actor.companyId, civilDay(year.endsAt), tx);
    await reverseTaxEntry(tx, actor, row, year, `Anulación del asiento del Impuesto sobre Sociedades ${year.code}`);
    await tx.update(corporateTaxReturn).set({ journalEntryId: null, postedAt: null, postedSnapshot: null, updatedAt: new Date() }).where(eq(corporateTaxReturn.id, row.id));
  });
  return getCorporateTaxYear(actor.companyId, fiscalYearId);
}

/** Marca la liquidación como presentada y guarda la foto del cálculo (de ella salen las bases negativas de años siguientes). */
export async function markCorporateTaxReturnFiled(actor: Actor, fiscalYearId: string, input: { receiptNumber?: string | null }) {
  await db.transaction(async (tx) => {
    requireYear(await loadYears(actor.companyId, tx), fiscalYearId);
    const view = await getCorporateTaxYear(actor.companyId, fiscalYearId, { client: tx });
    const existing = await lockReturn(tx, actor.companyId, fiscalYearId);
    const values = {
      status: "filed",
      filedAt: new Date(),
      filingReceiptNumber: input.receiptNumber?.trim() || null,
      filedSnapshot: view.result as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    };
    const [row] = existing
      ? await tx.update(corporateTaxReturn).set(values).where(eq(corporateTaxReturn.id, existing.id)).returning({ id: corporateTaxReturn.id })
      : await tx.insert(corporateTaxReturn).values({ companyId: actor.companyId, fiscalYearId, inputs: view.inputs, ...values }).returning({ id: corporateTaxReturn.id });
    await recordAudit({ ...actor, action: "corporateTax.return.file", entityName: "corporateTaxReturn", entityId: row.id, payload: { fiscalYearId, differentialCents: view.result.differentialCents } }, tx);
  });
  return getCorporateTaxYear(actor.companyId, fiscalYearId);
}

export async function reopenCorporateTaxReturn(actor: Actor, fiscalYearId: string) {
  const [row] = await db
    .update(corporateTaxReturn)
    .set({ status: "draft", filedAt: null, filingReceiptNumber: null, filedSnapshot: null, updatedAt: new Date() })
    .where(and(eq(corporateTaxReturn.companyId, actor.companyId), eq(corporateTaxReturn.fiscalYearId, fiscalYearId)))
    .returning({ id: corporateTaxReturn.id });
  if (!row) throw new HttpError(404, "No hay liquidación guardada de este ejercicio.");
  await recordAudit({ ...actor, action: "corporateTax.return.reopen", entityName: "corporateTaxReturn", entityId: row.id, payload: { fiscalYearId } });
  return getCorporateTaxYear(actor.companyId, fiscalYearId);
}

// ---------------------------------------------------------------------------------------------
// Estados oficiales para el resumen que se traslada a Sociedades WEB
// ---------------------------------------------------------------------------------------------

export async function getCorporateTaxStatements(companyId: string, fiscalYearId: string) {
  const years = await loadYears(companyId);
  const year = requireYear(years, fiscalYearId);
  const previousYear = [...years].reverse().find((entry) => entry.endsAt < year.startsAt) ?? null;
  const [rows, previousRows] = await Promise.all([
    loadStatementAccountRows(companyId, yearRange(year)),
    previousYear ? loadStatementAccountRows(companyId, yearRange(previousYear)) : Promise.resolve(null),
  ]);
  return { statements: buildOfficialStatements(rows, previousRows), previousYearCode: previousYear?.code ?? null };
}

// ---------------------------------------------------------------------------------------------
// Pagos fraccionados (modelo 202)
// ---------------------------------------------------------------------------------------------

export type InstallmentInputs = {
  increasesCents: number;
  decreasesCents: number;
  bonusesCents: number;
  /** null = movimiento de la 473 en el periodo, sin los pagos fraccionados. */
  withholdingsCents: number | null;
  /** null = el máximo de bases negativas. */
  lossCompensationCents: number | null;
  /** Base de la modalidad del art. 40.2 indicada a mano; null = la de la liquidación del ejercicio de referencia. */
  quotaBaseCents: number | null;
};

const DEFAULT_INSTALLMENT_INPUTS: InstallmentInputs = { increasesCents: 0, decreasesCents: 0, bonusesCents: 0, withholdingsCents: null, lossCompensationCents: null, quotaBaseCents: null };

export type InstallmentView = {
  period: InstallmentPeriod;
  label: string;
  /** Periodo en el formato de los modelos (2026-1P). */
  periodCode: string;
  dueDate: string;
  /** Meses del ejercicio que cubre la modalidad del art. 40.3 y su último día. */
  monthsCovered: number;
  coveredUntil: string;
  saved: boolean;
  method: InstallmentMethod;
  inputs: InstallmentInputs;
  /** Ejercicio de referencia de la modalidad del art. 40.2 y de dónde sale su base. */
  quotaReference: { yearCode: string | null; source: "filed" | "live" | "manual" | "none"; baseCents: number };
  facts: { accountingResultBeforeTaxCents: number; ledgerWithholdingsCents: number; previousInstallmentsCents: number };
  quota: QuotaInstallmentResult;
  base: BaseInstallmentResult;
  amountCents: number;
  status: "draft" | "filed";
  filingReceiptNumber: string | null;
  payment: { date: string; amountCents: number; journalEntryId: string } | null;
};

export type InstallmentsView = {
  year: CorporateTaxView["year"];
  regime: CorporateTaxRegime;
  revenueCents: number | null;
  baseMethodMandatory: boolean;
  periods: InstallmentView[];
  bankAccounts: Array<{ id: string; label: string }>;
  warnings: CorporateTaxWarning[];
};

/** Año natural del mes de ingreso que cae dentro del ejercicio (para ejercicios partidos puede ser el de inicio o el de cierre). */
function dueYearFor(year: YearRow, dueMonth: number) {
  const startYear = year.startsAt.getUTCFullYear();
  for (const candidate of [startYear, startYear + 1]) {
    const first = new Date(Date.UTC(candidate, dueMonth - 1, 1));
    if (first >= year.startsAt && first <= year.endsAt) return candidate;
  }
  return startYear;
}

function installmentAmountForPrevious(row: InstallmentRow) {
  if (row.journalEntryId) return toCents(row.paidAmount);
  return row.status === "filed" ? toCents(row.amount) : 0;
}

export async function getInstallments(companyId: string, fiscalYearId: string, options: { client?: DbClient; override?: { period: InstallmentPeriod; method: InstallmentMethod; inputs: InstallmentInputs } } = {}): Promise<InstallmentsView> {
  const client = options.client ?? db;
  const years = await loadYears(companyId, client);
  const year = requireYear(years, fiscalYearId);
  const previousYear = [...years].reverse().find((entry) => entry.endsAt < year.startsAt) ?? null;
  const [stored, returnRows, lossRegister, previousRows, banks] = await Promise.all([
    client.select().from(corporateTaxInstallment).where(and(eq(corporateTaxInstallment.companyId, companyId), eq(corporateTaxInstallment.fiscalYearId, fiscalYearId))),
    client.select().from(corporateTaxReturn).where(eq(corporateTaxReturn.companyId, companyId)),
    loadLossRegister(client, companyId, years, year.startsAt),
    previousYear ? loadStatementAccountRows(companyId, yearRange(previousYear)) : Promise.resolve(null),
    client.select({ id: bankAccount.id, bankName: bankAccount.bankName, iban: bankAccount.iban }).from(bankAccount).where(and(eq(bankAccount.companyId, companyId), eq(bankAccount.isActive, true))),
  ]);
  const ownReturn = returnRows.find((row) => row.fiscalYearId === fiscalYearId) ?? null;
  const ledgerRevenue = previousRows ? lineAmountCents(buildOfficialStatements(previousRows), "PG.1") : null;
  const revenueCents = ownReturn?.inputs.priorYearRevenueCents ?? ledgerRevenue;
  const regime = ownReturn ? normalizeRegime(ownReturn.inputs.regime) : suggestedRegime(revenueCents);
  const mandatory = baseMethodMandatory(revenueCents);
  const startYear = year.startsAt.getUTCFullYear();
  const losses = lossRegister.rows.map((row): LossCarryforward => ({ originYear: row.originYear, pendingCents: row.pendingCents }));
  const warnings: CorporateTaxWarning[] = [];
  if (regime === "micro") {
    warnings.push({ code: "micro-installment", message: "Con la escala de microempresas, el porcentaje del art. 40.3 se aplica aquí a cada tramo de la base (5/7 de cada tipo). Contrasta el resultado con el que calcule el formulario de la AEAT." });
  }
  if (!ownReturn) {
    warnings.push({ code: "regime-default", message: "El tipo de gravamen se toma de la liquidación del ejercicio. Todavía no la has guardado: se usa el que corresponde a la cifra de negocios del ejercicio anterior." });
  }

  const liveQuotaBase = new Map<string, number>();
  const periods: InstallmentView[] = [];
  let lastMethod: InstallmentMethod = mandatory ? "base" : "quota";
  for (const info of INSTALLMENT_PERIODS) {
    const row = stored.find((entry) => entry.period === info.period) ?? null;
    const override = options.override?.period === info.period ? options.override : null;
    const inputs: InstallmentInputs = override?.inputs ?? { ...DEFAULT_INSTALLMENT_INPUTS, ...((row?.inputs ?? {}) as Partial<InstallmentInputs>) };
    const method: InstallmentMethod = mandatory ? "base" : override?.method ?? (row ? (row.method === "base" ? "base" : "quota") : lastMethod);
    lastMethod = method;
    const dueYear = dueYearFor(year, info.dueMonth);
    const firstDay = new Date(Date.UTC(dueYear, info.dueMonth - 1, 1));

    // Art. 40.2: último ejercicio cuyo plazo de declaración estaba vencido el día 1 del mes de ingreso.
    const referenceYear = [...years].reverse().find((entry) => corporateTaxReturnWindow(entry.endsAt).to < firstDay) ?? null;
    const referenceReturn = referenceYear ? returnRows.find((entry) => entry.fiscalYearId === referenceYear.id) ?? null : null;
    let quotaReference: InstallmentView["quotaReference"] = { yearCode: referenceYear?.code ?? null, source: "none", baseCents: 0 };
    if (inputs.quotaBaseCents !== null) {
      quotaReference = { yearCode: referenceYear?.code ?? null, source: "manual", baseCents: Math.max(inputs.quotaBaseCents, 0) };
    } else if (referenceYear && referenceReturn?.status === "filed") {
      const snapshot = (referenceReturn.filedSnapshot ?? {}) as FiledSnapshot;
      quotaReference = { yearCode: referenceYear.code, source: "filed", baseCents: computeQuotaInstallment({ grossQuotaCents: Number(snapshot.grossQuotaCents ?? 0), creditsCents: Number(snapshot.creditsAppliedCents ?? 0), withholdingsCents: Number(snapshot.withholdingsCents ?? 0) }).baseCents };
    } else if (referenceYear) {
      let baseCents = liveQuotaBase.get(referenceYear.id);
      if (baseCents === undefined) {
        const reference = (await getCorporateTaxYear(companyId, referenceYear.id, { client })).result;
        baseCents = computeQuotaInstallment({ grossQuotaCents: reference.grossQuotaCents, creditsCents: reference.creditsAppliedCents, withholdingsCents: reference.withholdingsCents }).baseCents;
        liveQuotaBase.set(referenceYear.id, baseCents);
      }
      quotaReference = { yearCode: referenceYear.code, source: "live", baseCents };
    }
    const quota = computeQuotaInstallment({ grossQuotaCents: quotaReference.baseCents, creditsCents: 0, withholdingsCents: 0 });

    // Art. 40.3: resultado del ejercicio hasta el día anterior al mes de ingreso.
    const partialRows = await loadStatementAccountRows(companyId, { yearStart: year.startsAt, from: year.startsAt, toExclusive: firstDay });
    const accountingResultBeforeTaxCents = lineAmountCents(buildOfficialStatements(partialRows), "PG.C");
    const earlier = stored.filter((entry) => installmentPeriodInfo(entry.period as InstallmentPeriod).dueMonth < info.dueMonth);
    const previousInstallmentsCents = earlier.reduce((sum, entry) => sum + installmentAmountForPrevious(entry), 0);
    const earlierPostedCents = earlier.filter((entry) => entry.journalEntryId && entry.paidAt && entry.paidAt < iso(firstDay)).reduce((sum, entry) => sum + toCents(entry.paidAmount), 0);
    const ledgerWithholdingsCents = Math.max(periodNetCents(partialRows, "473") - earlierPostedCents, 0);
    const base = computeBaseInstallment({
      accountingResultBeforeTaxCents,
      increasesCents: inputs.increasesCents,
      decreasesCents: inputs.decreasesCents,
      losses,
      lossCompensationCents: inputs.lossCompensationCents,
      regime,
      customRatePct: ownReturn?.inputs.customRatePct ?? null,
      startYear,
      revenueCents,
      bonusesCents: inputs.bonusesCents,
      withholdingsCents: inputs.withholdingsCents ?? ledgerWithholdingsCents,
      previousInstallmentsCents,
    });

    periods.push({
      period: info.period,
      label: info.label,
      periodCode: `${dueYear}-${info.period}`,
      dueDate: iso(installmentDueDate(dueYear, info.dueMonth)),
      monthsCovered: info.monthsCovered,
      coveredUntil: iso(new Date(firstDay.getTime() - 86_400_000)),
      saved: Boolean(row),
      method,
      inputs,
      quotaReference,
      facts: { accountingResultBeforeTaxCents, ledgerWithholdingsCents, previousInstallmentsCents },
      quota,
      base,
      amountCents: method === "base" ? base.amountCents : quota.amountCents,
      status: row?.status === "filed" ? "filed" : "draft",
      filingReceiptNumber: row?.filingReceiptNumber ?? null,
      payment: row?.journalEntryId && row.paidAt ? { date: row.paidAt, amountCents: toCents(row.paidAmount), journalEntryId: row.journalEntryId } : null,
    });
  }

  return {
    year: { id: year.id, code: year.code, start: iso(year.startsAt), end: iso(year.endsAt), isClosed: year.isClosed, startYear, periodDays: periodDays(year.startsAt, year.endsAt) },
    regime,
    revenueCents,
    baseMethodMandatory: mandatory,
    periods,
    bankAccounts: banks.map((bank) => ({ id: bank.id, label: bank.iban ? `${bank.bankName} · ${bank.iban.slice(-4)}` : bank.bankName })),
    warnings,
  };
}

function toInstallmentInputs(input: InstallmentInput): InstallmentInputs {
  return {
    increasesCents: input.increasesCents,
    decreasesCents: input.decreasesCents,
    bonusesCents: input.bonusesCents,
    withholdingsCents: input.withholdingsCents ?? null,
    lossCompensationCents: input.lossCompensationCents ?? null,
    quotaBaseCents: input.quotaBaseCents ?? null,
  };
}

export async function previewInstallment(companyId: string, fiscalYearId: string, period: InstallmentPeriod, input: InstallmentInput) {
  return getInstallments(companyId, fiscalYearId, { override: { period, method: input.method, inputs: toInstallmentInputs(input) } });
}

async function lockInstallment(tx: DbClient, companyId: string, fiscalYearId: string, period: InstallmentPeriod) {
  const [row] = await tx
    .select()
    .from(corporateTaxInstallment)
    .where(and(eq(corporateTaxInstallment.companyId, companyId), eq(corporateTaxInstallment.fiscalYearId, fiscalYearId), eq(corporateTaxInstallment.period, period)))
    .limit(1)
    .for("update");
  return row ?? null;
}

/** Guarda el cálculo del periodo (y, si se indica, lo marca como presentado o lo reabre). */
export async function saveInstallment(actor: Actor, fiscalYearId: string, period: InstallmentPeriod, input: InstallmentInput) {
  await db.transaction(async (tx) => {
    const existing = await lockInstallment(tx, actor.companyId, fiscalYearId, period);
    if (existing?.status === "filed" && input.filed !== false) {
      throw new HttpError(409, "Este pago fraccionado está marcado como presentado. Reábrelo para cambiarlo.");
    }
    const inputs = toInstallmentInputs(input);
    const view = await getInstallments(actor.companyId, fiscalYearId, { client: tx, override: { period, method: input.method, inputs } });
    const computed = view.periods.find((entry) => entry.period === period)!;
    const filed = input.filed === true;
    const values = {
      method: computed.method,
      inputs,
      amount: centsToAmount(computed.amountCents),
      snapshot: (computed.method === "base" ? computed.base : computed.quota) as unknown as Record<string, unknown>,
      status: filed ? "filed" : "draft",
      filedAt: filed ? new Date() : null,
      filingReceiptNumber: filed ? input.receiptNumber?.trim() || null : null,
      updatedAt: new Date(),
    };
    const [row] = existing
      ? await tx.update(corporateTaxInstallment).set(values).where(eq(corporateTaxInstallment.id, existing.id)).returning({ id: corporateTaxInstallment.id })
      : await tx.insert(corporateTaxInstallment).values({ companyId: actor.companyId, fiscalYearId, period, ...values }).returning({ id: corporateTaxInstallment.id });
    await recordAudit({ ...actor, action: filed ? "corporateTax.installment.file" : "corporateTax.installment.save", entityName: "corporateTaxInstallment", entityId: row.id, payload: { fiscalYearId, period, amountCents: computed.amountCents } }, tx);
  });
  return getInstallments(actor.companyId, fiscalYearId);
}

/** Asiento del pago del modelo 202: (473) HP, retenciones y pagos a cuenta, a la cuenta del banco. */
export async function payInstallment(actor: Actor, fiscalYearId: string, period: InstallmentPeriod, input: { date: string; bankAccountId?: string | null; amountCents?: number | null }) {
  await db.transaction(async (tx) => {
    const row = await lockInstallment(tx, actor.companyId, fiscalYearId, period);
    if (!row) throw new HttpError(409, "Guarda primero el cálculo de este pago fraccionado.");
    if (row.journalEntryId) throw new HttpError(409, "El pago de este periodo ya está contabilizado. Anúlalo antes de registrarlo de nuevo.");
    const amountCents = input.amountCents ?? toCents(row.amount);
    if (amountCents <= 0) throw new HttpError(422, "No hay importe que pagar en este periodo.");
    const postedAt = new Date(`${input.date}T00:00:00.000Z`);
    await assertFiscalYearOpen(actor.companyId, postedAt, tx);
    if (input.bankAccountId) {
      const [bank] = await tx.select({ id: bankAccount.id }).from(bankAccount).where(and(eq(bankAccount.companyId, actor.companyId), eq(bankAccount.id, input.bankAccountId))).limit(1);
      if (!bank) throw new HttpError(422, "La cuenta bancaria indicada no existe.");
    }
    const bankLedgerId = (input.bankAccountId ? await resolveBankLedgerAccountId(tx, actor.companyId, { bankAccountId: input.bankAccountId }) : null)
      ?? (await ensureSubaccount(actor.companyId, "572", tx)).id;
    const withholdingsId = (await ensureSubaccount(actor.companyId, CORPORATE_TAX_ACCOUNTS.withholdings, tx)).id;
    const info = installmentPeriodInfo(period);
    const [year] = await tx.select({ code: fiscalYear.code }).from(fiscalYear).where(eq(fiscalYear.id, fiscalYearId)).limit(1);
    const reference = `Pago fraccionado del Impuesto sobre Sociedades · modelo 202 ${info.period} ${year?.code ?? ""}`.trim();
    const amount = centsToAmount(amountCents);
    const entry = await createAutomaticEntry({
      ...actor,
      dbClient: tx,
      postedAt,
      reference,
      lines: [
        { accountId: withholdingsId, debit: amount, credit: 0, concept: reference },
        { accountId: bankLedgerId, debit: 0, credit: amount, concept: reference },
      ],
      action: "corporateTax.installment.pay",
      entityName: CORPORATE_TAX_SOURCE.installmentPayment,
      entityId: row.id,
      sourceType: CORPORATE_TAX_SOURCE.installmentPayment,
      sourceId: row.id,
    });
    await tx.update(corporateTaxInstallment).set({ paidAt: input.date, paidAmount: amount, journalEntryId: entry.id, updatedAt: new Date() }).where(eq(corporateTaxInstallment.id, row.id));
  });
  return getInstallments(actor.companyId, fiscalYearId);
}

export async function undoInstallmentPayment(actor: Actor, fiscalYearId: string, period: InstallmentPeriod) {
  await db.transaction(async (tx) => {
    const row = await lockInstallment(tx, actor.companyId, fiscalYearId, period);
    if (!row?.journalEntryId || !row.paidAt) throw new HttpError(409, "El pago de este periodo no está contabilizado.");
    const postedAt = new Date(`${row.paidAt}T00:00:00.000Z`);
    await assertFiscalYearOpen(actor.companyId, postedAt, tx);
    const reason = `Anulación del pago fraccionado del modelo 202 ${row.period}`;
    await reverseAutomaticEntries({ ...actor, dbClient: tx, postedAt, reference: reason, reason, sourceType: CORPORATE_TAX_SOURCE.installmentPayment, sourceId: row.id });
    await tx.update(corporateTaxInstallment).set({ paidAt: null, paidAmount: null, journalEntryId: null, updatedAt: new Date() }).where(eq(corporateTaxInstallment.id, row.id));
  });
  return getInstallments(actor.companyId, fiscalYearId);
}

// ---------------------------------------------------------------------------------------------
// Recordatorios, calendario y cierre
// ---------------------------------------------------------------------------------------------

export async function getReminderSettings(companyId: string, client: DbClient = db): Promise<CorporateReminderSettings> {
  const [row] = await client.select().from(corporateTaxSettings).where(eq(corporateTaxSettings.companyId, companyId)).limit(1);
  if (!row) return DEFAULT_REMINDER_SETTINGS;
  return { relatedParties: row.remindRelatedParties, books: row.remindBooks, annualAccounts: row.remindAnnualAccounts };
}

export async function saveReminderSettings(actor: Actor, settings: CorporateReminderSettings) {
  const values = { remindRelatedParties: settings.relatedParties, remindBooks: settings.books, remindAnnualAccounts: settings.annualAccounts, updatedAt: new Date() };
  await db.insert(corporateTaxSettings).values({ companyId: actor.companyId, ...values }).onConflictDoUpdate({ target: corporateTaxSettings.companyId, set: values });
  await recordAudit({ ...actor, action: "corporateTax.settings.update", entityName: "corporateTaxSettings", entityId: actor.companyId, payload: settings });
  return settings;
}

/** Lo que necesitan el calendario fiscal y «qué tengo que presentar» (ver `buildFiscalCalendar`). */
export type CorporateTaxCalendarData = {
  fiscalYears: Array<{ id: string; code: string; startsAt: string; endsAt: string }>;
  returns: Array<{ fiscalYearId: string; status: "draft" | "filed"; differentialCents: number | null }>;
  installments: Array<{ fiscalYearId: string; period: InstallmentPeriod; status: "draft" | "filed"; amountCents: number }>;
  reminders: CorporateReminderSettings;
};

/** null si la empresa no es una sociedad sujeta al impuesto (autónomos, otros países). */
export async function getCorporateTaxCalendarData(companyId: string, countryCode: string | null | undefined): Promise<CorporateTaxCalendarData | null> {
  if (!(await isCorporateTaxCompany(companyId, countryCode))) return null;
  const [years, returns, installments, reminders] = await Promise.all([
    loadYears(companyId),
    db.select({ fiscalYearId: corporateTaxReturn.fiscalYearId, status: corporateTaxReturn.status, filedSnapshot: corporateTaxReturn.filedSnapshot }).from(corporateTaxReturn).where(eq(corporateTaxReturn.companyId, companyId)),
    db.select({ fiscalYearId: corporateTaxInstallment.fiscalYearId, period: corporateTaxInstallment.period, status: corporateTaxInstallment.status, amount: corporateTaxInstallment.amount }).from(corporateTaxInstallment).where(eq(corporateTaxInstallment.companyId, companyId)),
    getReminderSettings(companyId),
  ]);
  return {
    fiscalYears: years.map((year) => ({ id: year.id, code: year.code, startsAt: iso(year.startsAt), endsAt: iso(year.endsAt) })),
    returns: returns.map((row) => ({
      fiscalYearId: row.fiscalYearId,
      status: row.status === "filed" ? "filed" : "draft",
      differentialCents: row.status === "filed" ? Number((row.filedSnapshot as { differentialCents?: number } | null)?.differentialCents ?? 0) : null,
    })),
    installments: installments.map((row) => ({ fiscalYearId: row.fiscalYearId, period: row.period as InstallmentPeriod, status: row.status === "filed" ? "filed" : "draft", amountCents: toCents(row.amount) })),
    reminders,
  };
}

/** Datos del punto «Impuesto sobre Sociedades contabilizado» del cierre; null si la empresa no es una sociedad. */
export async function getCorporateTaxCloseFacts(companyId: string, fiscalYearId: string) {
  const [row] = await db.select({ countryCode: company.countryCode }).from(company).where(eq(company.id, companyId)).limit(1);
  if (!(await isCorporateTaxCompany(companyId, row?.countryCode))) return null;
  const view = await getCorporateTaxYear(companyId, fiscalYearId);
  return {
    posted: Boolean(view.entry.posted),
    upToDate: view.entry.upToDate,
    /** Importe del asiento que saldría hoy (0 = no hay nada que contabilizar). */
    entryCents: view.entry.lines.reduce((sum, line) => sum + line.debitCents, 0),
    netQuotaCents: view.result.netQuotaCents,
    manualTaxExpenseCents: view.entry.manualTaxExpenseCents,
  };
}
