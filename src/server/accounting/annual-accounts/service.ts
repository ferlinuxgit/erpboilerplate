import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { accountChart, annualAccountsNotes, company, corporateTaxReturn, companySettings, fixedAsset, journalEntry, journalLine, supplierInvoice, supplierInvoicePayment, supplierPayment } from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { buildCashFlowStatement } from "@/server/accounting/annual-accounts/cash-flow-model";
import {
  buildEquityChangesStatement,
  buildRecognizedIncomeStatement,
  EQUITY_ACCOUNT_PREFIXES,
  type EquityYearInput,
} from "@/server/accounting/annual-accounts/equity-changes-model";
import {
  debtTable,
  employeesTable,
  financialAssetTables,
  fixedAssetRegisterTable,
  fixedAssetTables,
  grantsTable,
  NOTE_SECTIONS,
  noteText,
  supplierPaymentPeriod,
  supplierPaymentTable,
  taxReconciliationFromLiquidation,
  taxReconciliationTable,
  type CorporateTaxLiquidationSummary,
  type FixedAssetRegisterSummary,
  type NotesContext,
  type NoteTable,
  type SupplierInvoiceForPayment,
} from "@/server/accounting/annual-accounts/notes-model";
import { assessCompanySize, type SizeFigures } from "@/server/accounting/annual-accounts/size-criteria";
import { AccountingRuleError } from "@/server/accounting/errors";
import { accountingRange, companyTimeZoneOf, isLifecycleEntrySql, postedInRangeSql } from "@/server/accounting/fiscal-year-date";
import { listFiscalYears } from "@/server/accounting/fiscal-years";
import { toCents } from "@/server/accounting/money";
import {
  buildOfficialStatements,
  isOfficialStatementModelId,
  officialLineAmount,
  officialStatementModelInfo,
  type OfficialStatementModelId,
} from "@/server/accounting/official-statements-model";
import { loadStatementAccountRows } from "@/server/accounting/statements";
import type { StatementAccountRow } from "@/server/accounting/statements-model";
import { recordAudit } from "@/server/audit";
import { getCorporateTaxYear, isCorporateTaxCompany } from "@/server/corporate-tax/service";

type YearRow = { id: string; code: string; startsAt: Date; endsAt: Date; isClosed: boolean };

const dayAfter = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
const isIncome = (code: string) => code.startsWith("6") || code.startsWith("7");

/** Modelo de cuentas anuales configurado para la empresa (por defecto, el abreviado). */
export async function getAnnualAccountsModel(companyId: string): Promise<OfficialStatementModelId> {
  const [settings] = await db.select({ model: companySettings.annualAccountsModel }).from(companySettings).where(eq(companySettings.companyId, companyId)).limit(1);
  return isOfficialStatementModelId(settings?.model) ? settings.model : "abbreviated";
}

export async function setAnnualAccountsModel(input: { companyId: string; tenantId: string; actorUserId: string; model: OfficialStatementModelId }) {
  await db
    .insert(companySettings)
    .values({ companyId: input.companyId, annualAccountsModel: input.model })
    .onConflictDoUpdate({ target: companySettings.companyId, set: { annualAccountsModel: input.model, updatedAt: new Date() } });
  await recordAudit({ tenantId: input.tenantId, companyId: input.companyId, actorUserId: input.actorUserId, action: "accounting.annualAccounts.model", entityName: "companySettings", entityId: input.companyId, payload: { model: input.model } });
}

/** Movimientos de patrimonio neto del ejercicio, por asiento (sin regularización, cierre ni apertura). */
async function loadEquityEntries(companyId: string, year: YearRow, timeZone: string): Promise<EquityYearInput["entries"]> {
  const range = accountingRange({ from: year.startsAt, toExclusive: dayAfter(year.endsAt) }, timeZone);
  const rows = await db
    .select({ entryId: journalEntry.id, code: accountChart.code, debit: journalLine.debit, credit: journalLine.credit })
    .from(journalLine)
    .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
    .innerJoin(accountChart, eq(accountChart.id, journalLine.accountId))
    .where(and(
      eq(journalEntry.companyId, companyId),
      sql`not ${isLifecycleEntrySql()}`,
      postedInRangeSql(range),
      or(...EQUITY_ACCOUNT_PREFIXES.map((prefix) => sql`${accountChart.code} like ${`${prefix}%`}`)),
    ));
  const entries = new Map<string, EquityYearInput["entries"][number]>();
  for (const row of rows) {
    const entry = entries.get(row.entryId) ?? { entryId: row.entryId, lines: [] };
    entry.lines.push({ code: row.code, debitCents: toCents(row.debit), creditCents: toCents(row.credit) });
    entries.set(row.entryId, entry);
  }
  return [...entries.values()];
}

function equityInput(year: YearRow, rows: StatementAccountRow[], entries: EquityYearInput["entries"]): EquityYearInput {
  let pendingPriorResultCents = 0;
  let yearResultCents = 0;
  const opening: EquityYearInput["opening"] = [];
  for (const row of rows) {
    if (isIncome(row.code)) {
      pendingPriorResultCents += -row.priorCents;
      yearResultCents += -row.yearToDateCents;
    } else if (row.priorCents !== 0) {
      opening.push({ code: row.code, cents: -row.priorCents });
    }
  }
  return { label: year.code, opening, pendingPriorResultCents, yearResultCents, entries };
}

async function loadFixedAssetSummary(companyId: string, year: YearRow): Promise<FixedAssetRegisterSummary> {
  const from = year.startsAt.toISOString().slice(0, 10);
  const to = year.endsAt.toISOString().slice(0, 10);
  const rows = await db
    .select({ acquisitionDate: fixedAsset.acquisitionDate, disposalDate: fixedAsset.disposalDate, cost: fixedAsset.acquisitionCost })
    .from(fixedAsset)
    .where(eq(fixedAsset.companyId, companyId));
  const summary: FixedAssetRegisterSummary = { additions: { count: 0, cost: 0 }, disposals: { count: 0, cost: 0 }, inUse: { count: 0, cost: 0 } };
  let additions = 0;
  let disposals = 0;
  let inUse = 0;
  for (const row of rows) {
    if (row.acquisitionDate > to) continue;
    const cost = toCents(row.cost);
    if (row.acquisitionDate >= from) {
      summary.additions.count += 1;
      additions += cost;
    }
    if (row.disposalDate && row.disposalDate <= to) {
      if (row.disposalDate >= from) {
        summary.disposals.count += 1;
        disposals += cost;
      }
    } else {
      summary.inUse.count += 1;
      inUse += cost;
    }
  }
  summary.additions.cost = additions / 100;
  summary.disposals.cost = disposals / 100;
  summary.inUse.cost = inUse / 100;
  return summary;
}

/** Facturas recibidas (no anuladas, sin abonos) anteriores al fin del rango, con sus pagos aplicados. */
async function loadSupplierInvoicesForPayment(companyId: string, toExclusive: Date): Promise<SupplierInvoiceForPayment[]> {
  const rows = await db
    .select({ id: supplierInvoice.id, issueDate: supplierInvoice.issueDate, total: supplierInvoice.totalAmount, paidAt: supplierPayment.postedAt, applied: supplierInvoicePayment.amountApplied })
    .from(supplierInvoice)
    .leftJoin(supplierInvoicePayment, eq(supplierInvoicePayment.supplierInvoiceId, supplierInvoice.id))
    .leftJoin(supplierPayment, eq(supplierPayment.id, supplierInvoicePayment.supplierPaymentId))
    .where(and(
      eq(supplierInvoice.companyId, companyId),
      isNull(supplierInvoice.voidedAt),
      eq(supplierInvoice.documentKind, "INVOICE"),
      sql`${supplierInvoice.status} <> 'DRAFT'`,
      lt(supplierInvoice.issueDate, toExclusive),
    ));
  const invoices = new Map<string, SupplierInvoiceForPayment>();
  for (const row of rows) {
    const invoice = invoices.get(row.id) ?? { date: row.issueDate, totalCents: toCents(row.total), payments: [] };
    if (row.paidAt && row.applied) invoice.payments.push({ date: row.paidAt, cents: toCents(row.applied) });
    invoices.set(row.id, invoice);
  }
  return [...invoices.values()];
}

/**
 * Liquidación del Impuesto sobre Sociedades guardada para el ejercicio (si la sociedad la ha hecho en
 * Fiscalidad), resumida para la nota de situación fiscal. null si no hay o no se puede calcular: la
 * memoria vuelve entonces a los importes indicados a mano.
 */
async function loadCorporateTaxLiquidation(companyId: string, countryCode: string | null, fiscalYearId: string): Promise<CorporateTaxLiquidationSummary | null> {
  const [stored] = await db
    .select({ id: corporateTaxReturn.id })
    .from(corporateTaxReturn)
    .where(and(eq(corporateTaxReturn.companyId, companyId), eq(corporateTaxReturn.fiscalYearId, fiscalYearId)))
    .limit(1);
  if (!stored || !(await isCorporateTaxCompany(companyId, countryCode))) return null;
  try {
    const view = await getCorporateTaxYear(companyId, fiscalYearId);
    const { result } = view;
    return {
      status: view.status,
      accountingResultBeforeTaxCents: result.accountingResultBeforeTaxCents,
      adjustments: view.inputs.adjustments,
      capitalizationReserveCents: result.capitalizationReserve.appliedCents,
      lossCompensationCents: result.losses.appliedCents,
      taxableBaseCents: result.taxableBaseCents,
      levelingReductionCents: result.leveling.reductionAppliedCents,
      levelingAdditionCents: result.leveling.additionCents,
      grossQuotaCents: result.grossQuotaCents,
      creditsCents: result.creditsAppliedCents,
      netQuotaCents: result.netQuotaCents,
      withholdingsAndInstallmentsCents: result.withholdingsCents + result.installmentsCents,
      differentialCents: result.differentialCents,
    };
  } catch (error) {
    logger.error({ companyId, fiscalYearId, error: error instanceof Error ? error.message : String(error) }, "accounting.annual_accounts.corporate_tax_failed");
    return null;
  }
}

type SavedNotes = { sections: Record<string, string>; averageEmployees: number | null; taxData: Record<string, string> };

async function loadSavedNotes(companyId: string, fiscalYearId: string): Promise<SavedNotes> {
  const [row] = await db
    .select({ sections: annualAccountsNotes.sections, averageEmployees: annualAccountsNotes.averageEmployees, taxData: annualAccountsNotes.taxData })
    .from(annualAccountsNotes)
    .where(and(eq(annualAccountsNotes.companyId, companyId), eq(annualAccountsNotes.fiscalYearId, fiscalYearId)))
    .limit(1);
  return {
    sections: row?.sections ?? {},
    averageEmployees: row?.averageEmployees === null || row?.averageEmployees === undefined ? null : Number(row.averageEmployees),
    taxData: row?.taxData ?? {},
  };
}

const optionalNumber = (value: string | undefined) => (value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));

export type AnnualAccountsNote = { id: string; title: string; guidance: string; extraLegalBasis?: string; text: string; isDefaultText: boolean; tables: NoteTable[] };

export type AnnualAccounts = Awaited<ReturnType<typeof loadAnnualAccounts>>;

/**
 * Cuentas anuales completas de un ejercicio: balance y cuenta de pérdidas y ganancias en el modelo
 * de la empresa (o el pedido), estado de cambios en el patrimonio neto, estado de ingresos y gastos
 * reconocidos (no existe en el modelo de PYMES), memoria y ayuda sobre el modelo que corresponde.
 */
export async function loadAnnualAccounts(companyId: string, fiscalYearId: string, options: { model?: OfficialStatementModelId } = {}) {
  const [companyRow] = await db
    .select({ name: company.name, legalName: company.legalName, vatNumber: company.vatNumber, fiscalAddress: company.fiscalAddress, postalCode: company.postalCode, city: company.city, province: company.province, countryCode: company.countryCode })
    .from(company)
    .where(eq(company.id, companyId))
    .limit(1);
  const years = await listFiscalYears(companyId);
  const year = years.find((candidate) => candidate.id === fiscalYearId);
  if (!companyRow || !year) throw new AccountingRuleError(404, "FISCAL_YEAR_NOT_FOUND", "Ejercicio no encontrado.");
  const previousYear = [...years].reverse().find((candidate) => candidate.startsAt < year.startsAt) ?? null;
  const timeZone = companyTimeZoneOf(companyRow);
  const model = options.model ?? (await getAnnualAccountsModel(companyId));
  const configuredModel = options.model ? await getAnnualAccountsModel(companyId) : model;

  const fullYear = (candidate: YearRow) => ({ yearStart: candidate.startsAt, from: candidate.startsAt, toExclusive: dayAfter(candidate.endsAt) });
  const [rows, previousRows, entries, previousEntries, saved, previousSaved, assetSummary, supplierInvoices, corporateTax] = await Promise.all([
    loadStatementAccountRows(companyId, fullYear(year), timeZone),
    previousYear ? loadStatementAccountRows(companyId, fullYear(previousYear), timeZone) : Promise.resolve(null),
    loadEquityEntries(companyId, year, timeZone),
    previousYear ? loadEquityEntries(companyId, previousYear, timeZone) : Promise.resolve(null),
    loadSavedNotes(companyId, year.id),
    previousYear ? loadSavedNotes(companyId, previousYear.id) : Promise.resolve(null),
    loadFixedAssetSummary(companyId, year),
    loadSupplierInvoicesForPayment(companyId, dayAfter(year.endsAt)),
    loadCorporateTaxLiquidation(companyId, companyRow.countryCode, year.id),
  ]);

  const statements = buildOfficialStatements(rows, previousRows, model);
  const equityChanges = buildEquityChangesStatement(
    equityInput(year, rows, entries),
    previousYear && previousRows && previousEntries ? equityInput(previousYear, previousRows, previousEntries) : null,
    model,
  );
  const yearResultCents = (source: StatementAccountRow[]) => source.reduce((sum, row) => (isIncome(row.code) ? sum - row.yearToDateCents : sum), 0);
  const recognizedIncome = model === "pymes"
    ? null
    : buildRecognizedIncomeStatement(
      { yearResultCents: yearResultCents(rows), accounts: rows },
      previousRows ? { yearResultCents: yearResultCents(previousRows), accounts: previousRows } : null,
    );

  // Estado de flujos de efectivo: obligatorio con el modelo normal (art. 257.3 LSC); con los demás
  // se calcula igual y se ofrece como informe voluntario.
  const cashFlow = buildCashFlowStatement(rows, previousRows);

  // Límites de tamaño: siempre con las magnitudes del modelo abreviado (activo total y cifra de negocios).
  const abbreviated = model === "abbreviated" ? statements : buildOfficialStatements(rows, previousRows, "abbreviated");
  const figures = (pick: "amount" | "previous", employees: number | null): SizeFigures => {
    const value = (lines: typeof abbreviated.assets, id: string) => (pick === "amount" ? officialLineAmount(lines, id) : lines.find((line) => line.id === id)?.previous ?? 0);
    return { assets: value(abbreviated.assets, "TOTAL_ACTIVO"), turnover: value(abbreviated.incomeStatement, "PG.1"), employees };
  };
  const size = {
    current: figures("amount", saved.averageEmployees),
    previous: previousYear && previousRows ? figures("previous", previousSaved?.averageEmployees ?? null) : null,
  };
  const assessment = assessCompanySize(size.current, size.previous);

  // Memoria.
  const modelInfo = officialStatementModelInfo(model);
  const address = [companyRow.fiscalAddress, [companyRow.postalCode, companyRow.city].filter(Boolean).join(" "), companyRow.province].filter(Boolean).join(", ") || null;
  const notesContext: NotesContext = {
    companyName: companyRow.legalName || companyRow.name,
    taxId: companyRow.vatNumber,
    address,
    yearLabel: year.code,
    modelName: modelInfo.name,
    planName: model === "pymes" ? "Plan General de Contabilidad de Pequeñas y Medianas Empresas (Real Decreto 1515/2007)" : "Plan General de Contabilidad (Real Decreto 1514/2007)",
    resultAmount: statements.totals.result,
  };
  const incomeTaxExpense = rows.reduce((sum, row) => (["630", "633", "638"].some((prefix) => row.code.startsWith(prefix)) ? sum + row.yearToDateCents : sum), 0) / 100;
  const paymentPeriod = supplierPaymentPeriod(supplierInvoices, { from: year.startsAt, toExclusive: dayAfter(year.endsAt) });
  const previousPaymentPeriod = previousYear ? supplierPaymentPeriod(supplierInvoices, { from: previousYear.startsAt, toExclusive: dayAfter(previousYear.endsAt) }) : null;
  const labels = { current: year.code, previous: previousYear?.code };
  const equityClosing = equityChanges.rows.find((row) => row.id === "current.closing");
  const equityOpening = equityChanges.rows.find((row) => row.id === "current.opening");
  const fundsTable: NoteTable = {
    title: "Fondos propios y resto del patrimonio neto",
    columns: ["Saldo inicial", "Saldo final"],
    rows: [
      ...equityChanges.columns.map((column) => ({ label: column.label, values: [equityOpening?.values[column.id] ?? 0, equityClosing?.values[column.id] ?? 0] })),
      { label: "Total patrimonio neto", values: [equityOpening?.total ?? 0, equityClosing?.total ?? 0], strong: true },
    ],
  };
  const tablesBySection: Record<string, NoteTable[]> = {
    "4": [...fixedAssetTables(rows), fixedAssetRegisterTable(assetSummary)],
    "5": financialAssetTables(rows),
    "6": [debtTable(rows)],
    "7": [fundsTable],
    "8": [corporateTax
      ? taxReconciliationFromLiquidation({ result: statements.totals.result, incomeTaxExpense, liquidation: corporateTax })
      : taxReconciliationTable({
        result: statements.totals.result,
        incomeTaxExpense,
        permanentDifferences: optionalNumber(saved.taxData.permanentDifferences),
        temporaryDifferences: optionalNumber(saved.taxData.temporaryDifferences),
        lossCarryforward: optionalNumber(saved.taxData.lossCarryforward),
      })],
    "10": [employeesTable(saved.averageEmployees, previousSaved?.averageEmployees ?? null, labels), grantsTable(rows)],
    pmp: [supplierPaymentTable(paymentPeriod, previousPaymentPeriod, labels)],
  };
  const notes: AnnualAccountsNote[] = NOTE_SECTIONS.map((section) => ({
    ...section,
    text: noteText(section.id, saved.sections, notesContext),
    isDefaultText: !(saved.sections[section.id] ?? "").trim(),
    tables: tablesBySection[section.id] ?? [],
  }));

  return {
    company: { name: notesContext.companyName, taxId: companyRow.vatNumber, address },
    year: { id: year.id, code: year.code, startsAt: year.startsAt, endsAt: year.endsAt, isClosed: year.isClosed },
    previousYear: previousYear ? { id: previousYear.id, code: previousYear.code } : null,
    model,
    configuredModel,
    modelInfo,
    statements,
    equityChanges,
    recognizedIncome,
    cashFlow,
    cashFlowRequired: model === "normal",
    size: { ...size, assessment },
    notes,
    notesData: { averageEmployees: saved.averageEmployees, taxData: saved.taxData, taxFromLiquidation: corporateTax !== null },
  };
}

export type SaveNotesInput = {
  companyId: string;
  tenantId: string;
  actorUserId: string;
  fiscalYearId: string;
  sections?: Record<string, string>;
  averageEmployees?: number | null;
  taxData?: Record<string, string>;
};

const SECTION_IDS = new Set(NOTE_SECTIONS.map((section) => section.id));
const TAX_KEYS = ["permanentDifferences", "temporaryDifferences", "lossCarryforward"];

/** Guarda los textos y datos de la memoria de un ejercicio (solo los apartados conocidos). */
export async function saveAnnualAccountsNotes(input: SaveNotesInput) {
  const years = await listFiscalYears(input.companyId);
  if (!years.some((year) => year.id === input.fiscalYearId)) throw new AccountingRuleError(404, "FISCAL_YEAR_NOT_FOUND", "Ejercicio no encontrado.");
  const current = await loadSavedNotes(input.companyId, input.fiscalYearId);
  const sections = { ...current.sections };
  for (const [id, text] of Object.entries(input.sections ?? {})) {
    if (!SECTION_IDS.has(id)) continue;
    if (text.trim() === "") delete sections[id];
    else sections[id] = text;
  }
  const taxData = { ...current.taxData };
  for (const key of TAX_KEYS) {
    const value = input.taxData?.[key];
    if (value === undefined) continue;
    if (value.trim() === "") delete taxData[key];
    else taxData[key] = value.trim();
  }
  const averageEmployees = input.averageEmployees === undefined ? current.averageEmployees : input.averageEmployees;
  const values = { sections, taxData, averageEmployees: averageEmployees === null ? null : String(averageEmployees), updatedByUserId: input.actorUserId, updatedAt: new Date() };
  await db
    .insert(annualAccountsNotes)
    .values({ companyId: input.companyId, fiscalYearId: input.fiscalYearId, ...values })
    .onConflictDoUpdate({ target: [annualAccountsNotes.companyId, annualAccountsNotes.fiscalYearId], set: values });
  await recordAudit({ tenantId: input.tenantId, companyId: input.companyId, actorUserId: input.actorUserId, action: "accounting.annualAccounts.notes", entityName: "fiscalYear", entityId: input.fiscalYearId, payload: { sections: Object.keys(input.sections ?? {}), averageEmployees } });
}
