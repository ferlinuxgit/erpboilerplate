/**
 * Nóminas y retenciones: fichas de trabajadores, nóminas mensuales con su asiento, pagos de nóminas
 * y seguros sociales, rendimientos del capital pagados e inmuebles alquilados.
 *
 * Los asientos son automáticos con origen propio (`PAYROLL_SOURCE`) y reversibles; respetan los
 * ejercicios cerrados y los periodos fiscales presentados (`assertFiscalPeriodOpen`).
 */
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";

import { bankAccount, capitalIncomePayment, partner, payrollEmployee, payrollPayment, payrollSettings, payrollSlip, rentalProperty } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { createAutomaticEntry, resolveAccounts, resolveBankLedgerAccountId, reverseAutomaticEntries } from "@/server/accounting/auto-post";
import { AccountingRuleError } from "@/server/accounting/errors";
import { centsToAmount, toCents } from "@/server/accounting/money";
import { ensureSubaccount } from "@/server/accounting/subaccounts";
import { recordAudit } from "@/server/audit";
import { assertFiscalPeriodOpen, resolveOpenPostingDate } from "@/server/fiscal/locks";
import {
  PAYROLL_ACCOUNTS,
  PAYROLL_SOURCE,
  SLIP_TYPE_LABELS,
  buildSlipPostingLines,
  parsePayrollImport,
  periodEndDate,
  periodLabel,
  slipCents,
  subkey190For,
  validateSlip,
  type PayrollImportRow,
  type RecipientKind,
  type SlipPostingLine,
  type SlipType,
} from "@/server/payroll/model";
import type { CapitalIncomeInput, PayrollEmployeeInput, PayrollPaymentInput, PayrollSettingsInput, PayrollSlipInput, RentalPropertyInput } from "@/server/payroll/schemas";
import { getPayrollSettings } from "@/server/payroll/withholding-data";

export type Actor = { tenantId: string; companyId: string; actorUserId: string };

const PAYROLL_DOCUMENT_TYPE = "PAYROLL";

/** Fecha civil AAAA-MM-DD como instante (00:00 UTC), igual que el resto de asientos con fecha de día. */
function isoToDate(iso: string) {
  return new Date(`${iso}T00:00:00.000Z`);
}

function notFound(what: string) {
  return new AccountingRuleError(404, "PAYROLL_NOT_FOUND", `${what} no encontrado.`);
}

function clean(value: string | null | undefined) {
  const text = value?.trim();
  return text ? text : null;
}

function cleanTaxId(value: string | null | undefined) {
  const text = value?.replace(/[\s.\-]/g, "").toUpperCase();
  return text ? text : null;
}

// ---------------------------------------------------------------------------------------------
// Trabajadores
// ---------------------------------------------------------------------------------------------

export async function listEmployees(companyId: string) {
  return db.select().from(payrollEmployee).where(eq(payrollEmployee.companyId, companyId)).orderBy(desc(payrollEmployee.isActive), asc(payrollEmployee.name));
}

export async function getEmployee(companyId: string, id: string) {
  const [row] = await db.select().from(payrollEmployee).where(and(eq(payrollEmployee.companyId, companyId), eq(payrollEmployee.id, id))).limit(1);
  return row ?? null;
}

function employeeValues(input: PayrollEmployeeInput) {
  const kind: RecipientKind = input.recipientKind;
  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    throw new AccountingRuleError(422, "PAYROLL_EMPLOYEE_DATES", "La fecha de baja no puede ser anterior a la de alta.");
  }
  return {
    name: input.name.trim(),
    taxId: cleanTaxId(input.taxId),
    socialSecurityNumber: clean(input.socialSecurityNumber),
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    recipientKind: kind,
    subkey190: subkey190For(kind, input.subkey190),
    withholdingRate: String(input.withholdingRate),
    birthYear: input.birthYear ?? null,
    familySituation: input.familySituation ?? null,
    disability: input.disability ?? null,
    contractType: input.contractType ?? null,
    spouseTaxId: cleanTaxId(input.spouseTaxId),
    notes: clean(input.notes),
    isActive: input.isActive ?? true,
  };
}

async function assertEmployeeTaxIdFree(client: DbClient, companyId: string, taxId: string | null, exceptId?: string) {
  if (!taxId) return;
  const rows = await client.select({ id: payrollEmployee.id }).from(payrollEmployee).where(and(eq(payrollEmployee.companyId, companyId), eq(payrollEmployee.taxId, taxId)));
  if (rows.some((row) => row.id !== exceptId)) {
    throw new AccountingRuleError(409, "PAYROLL_EMPLOYEE_DUPLICATE", `Ya hay un trabajador con el NIF ${taxId}.`);
  }
}

export async function createEmployee(actor: Actor, input: PayrollEmployeeInput) {
  const values = employeeValues(input);
  return db.transaction(async (tx) => {
    await assertEmployeeTaxIdFree(tx, actor.companyId, values.taxId);
    const [created] = await tx.insert(payrollEmployee).values({ companyId: actor.companyId, ...values }).returning({ id: payrollEmployee.id });
    await recordAudit({ ...actor, action: "payrollEmployee.create", entityName: "payrollEmployee", entityId: created.id, payload: { name: values.name, recipientKind: values.recipientKind } }, tx);
    return created;
  });
}

export async function updateEmployee(actor: Actor, id: string, input: PayrollEmployeeInput) {
  const values = employeeValues(input);
  return db.transaction(async (tx) => {
    await assertEmployeeTaxIdFree(tx, actor.companyId, values.taxId, id);
    const [updated] = await tx
      .update(payrollEmployee)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(payrollEmployee.companyId, actor.companyId), eq(payrollEmployee.id, id)))
      .returning({ id: payrollEmployee.id });
    if (!updated) throw notFound("Trabajador");
    await recordAudit({ ...actor, action: "payrollEmployee.update", entityName: "payrollEmployee", entityId: id, payload: { name: values.name, recipientKind: values.recipientKind } }, tx);
    return updated;
  });
}

export async function deleteEmployee(actor: Actor, id: string) {
  return db.transaction(async (tx) => {
    const [slip] = await tx.select({ id: payrollSlip.id }).from(payrollSlip).where(and(eq(payrollSlip.companyId, actor.companyId), eq(payrollSlip.employeeId, id))).limit(1);
    if (slip) {
      throw new AccountingRuleError(409, "PAYROLL_EMPLOYEE_IN_USE", "Este trabajador tiene nóminas: no se puede eliminar. Indica su fecha de baja o márcalo como inactivo.");
    }
    const [deleted] = await tx.delete(payrollEmployee).where(and(eq(payrollEmployee.companyId, actor.companyId), eq(payrollEmployee.id, id))).returning({ id: payrollEmployee.id, name: payrollEmployee.name });
    if (!deleted) throw notFound("Trabajador");
    await recordAudit({ ...actor, action: "payrollEmployee.delete", entityName: "payrollEmployee", entityId: id, payload: { name: deleted.name } }, tx);
    return { id };
  });
}

// ---------------------------------------------------------------------------------------------
// Nóminas
// ---------------------------------------------------------------------------------------------

const slipColumns = {
  id: payrollSlip.id,
  employeeId: payrollSlip.employeeId,
  employeeName: payrollEmployee.name,
  employeeTaxId: payrollEmployee.taxId,
  recipientKind: payrollEmployee.recipientKind,
  period: payrollSlip.period,
  concept: payrollSlip.concept,
  accrualDate: payrollSlip.accrualDate,
  grossAmount: payrollSlip.grossAmount,
  inKindAmount: payrollSlip.inKindAmount,
  inKindWithholdingAmount: payrollSlip.inKindWithholdingAmount,
  withholdingAmount: payrollSlip.withholdingAmount,
  employeeSocialSecurity: payrollSlip.employeeSocialSecurity,
  employerSocialSecurity: payrollSlip.employerSocialSecurity,
  advancesAmount: payrollSlip.advancesAmount,
  netAmount: payrollSlip.netAmount,
  slipType: payrollSlip.slipType,
  severanceAmount: payrollSlip.severanceAmount,
  severanceExemptAmount: payrollSlip.severanceExemptAmount,
  otherDeductions: payrollSlip.otherDeductions,
  inKindPosting: payrollSlip.inKindPosting,
  status: payrollSlip.status,
  journalEntryId: payrollSlip.journalEntryId,
  paymentDate: payrollSlip.paymentDate,
  paymentId: payrollSlip.paymentId,
  notes: payrollSlip.notes,
};

export type PayrollSlipRow = Awaited<ReturnType<typeof listSlips>>[number];

/** Nóminas de un mes (AAAA-MM) o de un año (AAAA). */
export async function listSlips(companyId: string, filter: { period?: string; year?: number } = {}) {
  const conditions = [eq(payrollSlip.companyId, companyId)];
  if (filter.period) conditions.push(eq(payrollSlip.period, filter.period));
  if (filter.year) conditions.push(gte(payrollSlip.period, `${filter.year}-01`), lt(payrollSlip.period, `${filter.year + 1}-01`));
  return db
    .select(slipColumns)
    .from(payrollSlip)
    .innerJoin(payrollEmployee, eq(payrollEmployee.id, payrollSlip.employeeId))
    .where(and(...conditions))
    .orderBy(desc(payrollSlip.period), asc(payrollEmployee.name), asc(payrollSlip.concept));
}

export async function getSlip(companyId: string, id: string) {
  const [row] = await db
    .select(slipColumns)
    .from(payrollSlip)
    .innerJoin(payrollEmployee, eq(payrollEmployee.id, payrollSlip.employeeId))
    .where(and(eq(payrollSlip.companyId, companyId), eq(payrollSlip.id, id)))
    .limit(1);
  return row ?? null;
}

/** Meses con nóminas, del más reciente al más antiguo, con sus totales. */
export async function listPayrollPeriods(companyId: string) {
  const rows = await db
    .select({
      period: payrollSlip.period,
      slips: sql<number>`count(*)::int`,
      drafts: sql<number>`count(*) filter (where ${payrollSlip.status} = 'draft')::int`,
      gross: sql<string>`coalesce(sum(${payrollSlip.grossAmount}), 0)`,
      net: sql<string>`coalesce(sum(${payrollSlip.netAmount}), 0)`,
    })
    .from(payrollSlip)
    .where(eq(payrollSlip.companyId, companyId))
    .groupBy(payrollSlip.period)
    .orderBy(desc(payrollSlip.period));
  return rows.map((row) => ({ period: row.period, label: periodLabel(row.period), slips: row.slips, drafts: row.drafts, grossCents: toCents(row.gross), netCents: toCents(row.net) }));
}

function slipValues(input: PayrollSlipInput) {
  const amounts = {
    grossAmount: input.grossAmount,
    inKindAmount: input.inKindAmount ?? 0,
    inKindWithholdingAmount: input.inKindWithholdingAmount ?? 0,
    withholdingAmount: input.withholdingAmount ?? 0,
    employeeSocialSecurity: input.employeeSocialSecurity ?? 0,
    employerSocialSecurity: input.employerSocialSecurity ?? 0,
    advancesAmount: input.advancesAmount ?? 0,
    netAmount: input.netAmount,
    severanceAmount: input.severanceAmount ?? 0,
    severanceExemptAmount: input.severanceExemptAmount ?? 0,
    otherDeductions: (input.otherDeductions ?? []).map((item) => ({ kind: item.kind, concept: item.concept, amountCents: toCents(item.amount), accountCode: item.accountCode })),
    inKindPosting: input.inKindPosting ?? null,
  };
  const cents = slipCents(amounts);
  const validation = validateSlip(cents);
  if (!validation.ok) throw new AccountingRuleError(422, validation.code, validation.message);
  const accrualDate = input.accrualDate ?? periodEndDate(input.period);
  if (accrualDate.slice(0, 7) !== input.period) {
    throw new AccountingRuleError(422, "PAYROLL_DATE_PERIOD", "La fecha de la nómina tiene que ser del mismo mes que la nómina.");
  }
  const slipType: SlipType = input.slipType ?? "monthly";
  return {
    employeeId: input.employeeId,
    period: input.period,
    concept: input.concept?.trim() || SLIP_TYPE_LABELS[slipType],
    slipType,
    severanceAmount: centsToAmount(cents.severanceCents),
    severanceExemptAmount: centsToAmount(cents.severanceExemptCents),
    otherDeductions: cents.otherDeductions,
    inKindPosting: cents.inKindPosting,
    accrualDate,
    grossAmount: centsToAmount(cents.grossCents),
    inKindAmount: centsToAmount(cents.inKindCents),
    inKindWithholdingAmount: centsToAmount(cents.inKindWithholdingCents),
    withholdingAmount: centsToAmount(cents.withholdingCents),
    employeeSocialSecurity: centsToAmount(cents.employeeSocialSecurityCents),
    employerSocialSecurity: centsToAmount(cents.employerSocialSecurityCents),
    advancesAmount: centsToAmount(cents.advancesCents),
    netAmount: centsToAmount(cents.netCents),
    notes: clean(input.notes),
  };
}

async function assertSlipUnique(client: DbClient, companyId: string, values: { employeeId: string; period: string; concept: string }, exceptId?: string) {
  const rows = await client
    .select({ id: payrollSlip.id })
    .from(payrollSlip)
    .where(and(eq(payrollSlip.companyId, companyId), eq(payrollSlip.employeeId, values.employeeId), eq(payrollSlip.period, values.period), eq(payrollSlip.concept, values.concept)));
  if (rows.some((row) => row.id !== exceptId)) {
    throw new AccountingRuleError(409, "PAYROLL_SLIP_DUPLICATE", `Este trabajador ya tiene «${values.concept}» en ${periodLabel(values.period)}. Para una paga extra, cambia el concepto.`);
  }
}

async function insertSlip(tx: DbClient, actor: Actor, input: PayrollSlipInput) {
  const values = slipValues(input);
  const [employee] = await tx.select({ id: payrollEmployee.id }).from(payrollEmployee).where(and(eq(payrollEmployee.companyId, actor.companyId), eq(payrollEmployee.id, values.employeeId))).limit(1);
  if (!employee) throw notFound("Trabajador");
  await assertSlipUnique(tx, actor.companyId, values);
  const [created] = await tx.insert(payrollSlip).values({ companyId: actor.companyId, ...values }).returning({ id: payrollSlip.id });
  await recordAudit({ ...actor, action: "payrollSlip.create", entityName: "payrollSlip", entityId: created.id, payload: { period: values.period, employeeId: values.employeeId, grossAmount: values.grossAmount, netAmount: values.netAmount } }, tx);
  if (input.post) await postSlipInTransaction(tx, actor, created.id);
  return created;
}

export async function createSlip(actor: Actor, input: PayrollSlipInput) {
  return db.transaction((tx) => insertSlip(tx, actor, input));
}

/** Modifica una nómina en borrador. Una nómina contabilizada hay que descontabilizarla antes. */
export async function updateSlip(actor: Actor, id: string, input: PayrollSlipInput) {
  const values = slipValues(input);
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ id: payrollSlip.id, status: payrollSlip.status }).from(payrollSlip).where(and(eq(payrollSlip.companyId, actor.companyId), eq(payrollSlip.id, id))).limit(1).for("update");
    if (!current) throw notFound("Nómina");
    if (current.status !== "draft") {
      throw new AccountingRuleError(409, "PAYROLL_SLIP_POSTED", "Esta nómina ya está contabilizada. Anula su asiento («Descontabilizar») para poder cambiarla.");
    }
    const [employee] = await tx.select({ id: payrollEmployee.id }).from(payrollEmployee).where(and(eq(payrollEmployee.companyId, actor.companyId), eq(payrollEmployee.id, values.employeeId))).limit(1);
    if (!employee) throw notFound("Trabajador");
    await assertSlipUnique(tx, actor.companyId, values, id);
    await tx.update(payrollSlip).set({ ...values, updatedAt: new Date() }).where(eq(payrollSlip.id, id));
    await recordAudit({ ...actor, action: "payrollSlip.update", entityName: "payrollSlip", entityId: id, payload: { period: values.period, grossAmount: values.grossAmount, netAmount: values.netAmount } }, tx);
    if (input.post) await postSlipInTransaction(tx, actor, id);
    return { id };
  });
}

export async function deleteSlip(actor: Actor, id: string) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ id: payrollSlip.id, status: payrollSlip.status, period: payrollSlip.period }).from(payrollSlip).where(and(eq(payrollSlip.companyId, actor.companyId), eq(payrollSlip.id, id))).limit(1).for("update");
    if (!current) throw notFound("Nómina");
    if (current.status !== "draft") {
      throw new AccountingRuleError(409, "PAYROLL_SLIP_POSTED", "No se puede eliminar una nómina contabilizada. Anula antes su asiento («Descontabilizar»).");
    }
    await tx.delete(payrollSlip).where(eq(payrollSlip.id, id));
    await recordAudit({ ...actor, action: "payrollSlip.delete", entityName: "payrollSlip", entityId: id, payload: { period: current.period } }, tx);
    return { id };
  });
}

async function payrollAccountIds(tx: DbClient, companyId: string) {
  const ids = {
    wages: (await ensureSubaccount(companyId, PAYROLL_ACCOUNTS.wages, tx)).id,
    employerSocialSecurity: (await ensureSubaccount(companyId, PAYROLL_ACCOUNTS.employerSocialSecurity, tx)).id,
    withholding: (await ensureSubaccount(companyId, PAYROLL_ACCOUNTS.withholding, tx)).id,
    socialSecurity: (await ensureSubaccount(companyId, PAYROLL_ACCOUNTS.socialSecurity, tx)).id,
    payable: (await ensureSubaccount(companyId, PAYROLL_ACCOUNTS.payable, tx)).id,
    advances: (await ensureSubaccount(companyId, PAYROLL_ACCOUNTS.advances, tx)).id,
    severance: (await ensureSubaccount(companyId, PAYROLL_ACCOUNTS.severance, tx)).id,
  };
  return ids;
}

/** Subcuenta de cada línea del asiento: las fijas del módulo o la que eligió el usuario. */
async function slipLineAccountId(tx: DbClient, companyId: string, accounts: Awaited<ReturnType<typeof payrollAccountIds>>, line: SlipPostingLine) {
  if ("accountCode" in line) return (await ensureSubaccount(companyId, line.accountCode, tx)).id;
  return accounts[line.role];
}

async function postSlipInTransaction(tx: DbClient, actor: Actor, id: string) {
  const [slip] = await tx.select().from(payrollSlip).where(and(eq(payrollSlip.companyId, actor.companyId), eq(payrollSlip.id, id))).limit(1).for("update");
  if (!slip) throw notFound("Nómina");
  if (slip.status !== "draft") throw new AccountingRuleError(409, "PAYROLL_SLIP_POSTED", "Esta nómina ya está contabilizada.");
  const [employee] = await tx.select({ name: payrollEmployee.name }).from(payrollEmployee).where(eq(payrollEmployee.id, slip.employeeId)).limit(1);
  const cents = slipCents(slip);
  const validation = validateSlip(cents);
  if (!validation.ok) throw new AccountingRuleError(422, validation.code, validation.message);

  const postedAt = isoToDate(slip.accrualDate);
  await assertFiscalPeriodOpen(actor.companyId, postedAt, tx);
  const accounts = await payrollAccountIds(tx, actor.companyId);
  const reference = `${slip.concept} ${periodLabel(slip.period)} · ${employee?.name ?? ""}`.trim().slice(0, 200);
  const meta = { concept: reference, documentType: PAYROLL_DOCUMENT_TYPE, documentNumber: slip.period, documentId: slip.id };
  const lines = [];
  for (const line of buildSlipPostingLines(cents)) {
    lines.push({
      accountId: await slipLineAccountId(tx, actor.companyId, accounts, line),
      debit: centsToAmount(line.debitCents),
      credit: centsToAmount(line.creditCents),
      ...meta,
      ...("concept" in line ? { concept: `${reference} · ${line.concept}`.slice(0, 200) } : {}),
    });
  }
  const entry = await createAutomaticEntry({
    ...actor,
    dbClient: tx,
    postedAt,
    reference,
    lines,
    action: "payrollSlip.post",
    entityName: PAYROLL_SOURCE.slip,
    entityId: slip.id,
    sourceType: PAYROLL_SOURCE.slip,
    sourceId: slip.id,
  });
  await tx.update(payrollSlip).set({ status: "posted", journalEntryId: entry.id, updatedAt: new Date() }).where(eq(payrollSlip.id, slip.id));
  return entry;
}

/** Contabiliza una nómina: 640 (641 la indemnización) y 642 al debe; 4751, 476, 460, otras deducciones y 465 al haber, con fecha de devengo. */
export async function postSlip(actor: Actor, id: string) {
  return db.transaction((tx) => postSlipInTransaction(tx, actor, id));
}

/** Contabiliza todas las nóminas en borrador de un mes (un asiento por nómina). */
export async function postPeriod(actor: Actor, period: string) {
  return db.transaction(async (tx) => {
    const drafts = await tx
      .select({ id: payrollSlip.id })
      .from(payrollSlip)
      .where(and(eq(payrollSlip.companyId, actor.companyId), eq(payrollSlip.period, period), eq(payrollSlip.status, "draft")))
      .orderBy(asc(payrollSlip.createdAt));
    for (const draft of drafts) await postSlipInTransaction(tx, actor, draft.id);
    return { period, posted: drafts.length };
  });
}

/**
 * Anula el asiento de una nómina con un contraasiento (en su fecha si el periodo sigue abierto; si
 * no, con fecha de hoy) y la deja en borrador. Si ya está pagada, hay que anular antes el pago.
 */
export async function unpostSlip(actor: Actor, id: string, today: string) {
  return db.transaction(async (tx) => {
    const [slip] = await tx.select().from(payrollSlip).where(and(eq(payrollSlip.companyId, actor.companyId), eq(payrollSlip.id, id))).limit(1).for("update");
    if (!slip) throw notFound("Nómina");
    if (slip.status !== "posted") throw new AccountingRuleError(409, "PAYROLL_SLIP_DRAFT", "Esta nómina no está contabilizada.");
    if (slip.paymentId || slip.paymentDate) {
      throw new AccountingRuleError(409, "PAYROLL_SLIP_PAID", "Esta nómina figura como pagada. Anula antes el pago de las nóminas de ese mes.");
    }
    const postedAt = await resolveOpenPostingDate(actor.companyId, isoToDate(slip.accrualDate), isoToDate(today), tx);
    const reason = `Anulación de ${slip.concept.toLowerCase()} ${periodLabel(slip.period)}`.slice(0, 200);
    await reverseAutomaticEntries({ ...actor, dbClient: tx, postedAt, reference: reason, reason, sourceType: PAYROLL_SOURCE.slip, sourceId: slip.id });
    await tx.update(payrollSlip).set({ status: "draft", journalEntryId: null, updatedAt: new Date() }).where(eq(payrollSlip.id, slip.id));
    await recordAudit({ ...actor, action: "payrollSlip.unpost", entityName: "payrollSlip", entityId: id, payload: { period: slip.period, reversedAt: postedAt.toISOString().slice(0, 10) } }, tx);
    return { id };
  });
}

export type PayrollImportResult = { rows: PayrollImportRow[]; valid: number; invalid: number; created: number };

/**
 * Importa las nóminas de un mes pegadas desde una hoja de cálculo. Con `commit: false` solo
 * comprueba. Al guardar es todo o nada: si alguna fila tiene errores no se crea ninguna.
 */
export async function importSlips(actor: Actor, input: { period: string; text: string; commit?: boolean; post?: boolean }): Promise<PayrollImportResult> {
  const employees = await db.select({ id: payrollEmployee.id, name: payrollEmployee.name, taxId: payrollEmployee.taxId }).from(payrollEmployee).where(eq(payrollEmployee.companyId, actor.companyId));
  const rows = parsePayrollImport(input.text, employees);
  const invalid = rows.filter((row) => row.error !== null).length;
  const result = { rows, valid: rows.length - invalid, invalid, created: 0 };
  if (!input.commit) return result;
  if (rows.length === 0) throw new AccountingRuleError(422, "PAYROLL_IMPORT_EMPTY", "No hay ninguna fila que importar.");
  if (invalid > 0) throw new AccountingRuleError(422, "PAYROLL_IMPORT_INVALID", `${invalid} fila(s) tienen errores: corrígelas antes de importar.`);
  await db.transaction(async (tx) => {
    for (const row of rows) {
      await insertSlip(tx, actor, { employeeId: row.employeeId ?? "", period: input.period, ...row.amounts, post: input.post });
    }
  });
  return { ...result, created: rows.length };
}

// ---------------------------------------------------------------------------------------------
// Pagos de nóminas y de seguros sociales
// ---------------------------------------------------------------------------------------------

export type PayrollPeriodSummary = {
  period: string;
  label: string;
  slips: number;
  drafts: number;
  grossCents: number;
  inKindCents: number;
  withholdingCents: number;
  employeeSocialSecurityCents: number;
  employerSocialSecurityCents: number;
  advancesCents: number;
  netCents: number;
  /** Líquido de nóminas contabilizadas aún sin pagar. */
  pendingSalariesCents: number;
  /** Seguros sociales de nóminas contabilizadas menos lo ya pagado. */
  pendingSocialSecurityCents: number;
  payments: Array<{ id: string; kind: "salaries" | "socialSecurity"; paymentDate: string; amountCents: number; bankName: string | null; hasEntry: boolean }>;
};

export async function getPeriodSummary(companyId: string, period: string, client: DbClient = db): Promise<PayrollPeriodSummary> {
  const [slips, payments] = await Promise.all([
    client.select().from(payrollSlip).where(and(eq(payrollSlip.companyId, companyId), eq(payrollSlip.period, period))),
    client
      .select({ id: payrollPayment.id, kind: payrollPayment.kind, paymentDate: payrollPayment.paymentDate, amount: payrollPayment.amount, bankName: bankAccount.bankName, journalEntryId: payrollPayment.journalEntryId })
      .from(payrollPayment)
      .leftJoin(bankAccount, eq(bankAccount.id, payrollPayment.bankAccountId))
      .where(and(eq(payrollPayment.companyId, companyId), eq(payrollPayment.period, period)))
      .orderBy(asc(payrollPayment.paymentDate)),
  ]);
  const sum = (pick: (slip: (typeof slips)[number]) => string) => slips.reduce((total, slip) => total + toCents(pick(slip)), 0);
  const posted = slips.filter((slip) => slip.status === "posted");
  const postedSocialSecurity = posted.reduce((total, slip) => total + toCents(slip.employeeSocialSecurity) + toCents(slip.employerSocialSecurity), 0);
  const paidSocialSecurity = payments.filter((payment) => payment.kind === "socialSecurity").reduce((total, payment) => total + toCents(payment.amount), 0);
  return {
    period,
    label: periodLabel(period),
    slips: slips.length,
    drafts: slips.length - posted.length,
    grossCents: sum((slip) => slip.grossAmount),
    inKindCents: sum((slip) => slip.inKindAmount),
    withholdingCents: sum((slip) => slip.withholdingAmount) + sum((slip) => slip.inKindWithholdingAmount),
    employeeSocialSecurityCents: sum((slip) => slip.employeeSocialSecurity),
    employerSocialSecurityCents: sum((slip) => slip.employerSocialSecurity),
    advancesCents: sum((slip) => slip.advancesAmount),
    netCents: sum((slip) => slip.netAmount),
    pendingSalariesCents: posted.filter((slip) => !slip.paymentId && !slip.paymentDate).reduce((total, slip) => total + toCents(slip.netAmount), 0),
    pendingSocialSecurityCents: Math.max(postedSocialSecurity - paidSocialSecurity, 0),
    payments: payments.map((payment) => ({
      id: payment.id,
      kind: payment.kind === "socialSecurity" ? "socialSecurity" : "salaries",
      paymentDate: payment.paymentDate,
      amountCents: toCents(payment.amount),
      bankName: payment.bankName,
      hasEntry: payment.journalEntryId !== null,
    })),
  };
}

async function bankLedgerAccountId(tx: DbClient, companyId: string, bankAccountId: string | null | undefined) {
  if (bankAccountId) {
    const [bank] = await tx.select({ id: bankAccount.id }).from(bankAccount).where(and(eq(bankAccount.companyId, companyId), eq(bankAccount.id, bankAccountId))).limit(1);
    if (!bank) throw new AccountingRuleError(404, "BANK_ACCOUNT_NOT_FOUND", "Cuenta bancaria no encontrada.");
    const linked = await resolveBankLedgerAccountId(tx, companyId, { bankAccountId });
    if (linked) return linked;
  }
  return (await resolveAccounts(companyId, ["bank"], tx)).ids.bank;
}

/**
 * Paga las nóminas de un mes (465 a banco: todo el líquido pendiente) o sus seguros sociales (476
 * a banco). Con `postEntry: false` solo anota la fecha de pago, para quien contabiliza el cargo
 * desde el movimiento bancario (asignándolo a la 465 o a la 476) y no quiere el asiento duplicado.
 */
export async function createPayrollPayment(actor: Actor, input: PayrollPaymentInput) {
  return db.transaction(async (tx) => {
    const slips = await tx
      .select()
      .from(payrollSlip)
      .where(and(eq(payrollSlip.companyId, actor.companyId), eq(payrollSlip.period, input.period), eq(payrollSlip.status, "posted")))
      .for("update");
    if (slips.length === 0) throw new AccountingRuleError(409, "PAYROLL_NOTHING_POSTED", "No hay nóminas contabilizadas en ese mes. Contabilízalas antes de registrar el pago.");
    if (input.paymentDate < `${input.period}-01`) {
      throw new AccountingRuleError(422, "PAYROLL_PAYMENT_DATE", "La fecha de pago no puede ser anterior al mes de la nómina.");
    }
    const summary = await getPeriodSummary(actor.companyId, input.period, tx);
    const unpaid = slips.filter((slip) => !slip.paymentId && !slip.paymentDate);
    const amountCents = input.kind === "salaries" ? summary.pendingSalariesCents : toCents(input.amount ?? summary.pendingSocialSecurityCents / 100);
    if (input.kind === "salaries" && unpaid.length === 0) throw new AccountingRuleError(409, "PAYROLL_ALREADY_PAID", "Las nóminas de ese mes ya figuran como pagadas.");
    if (amountCents <= 0) {
      throw new AccountingRuleError(409, "PAYROLL_NOTHING_TO_PAY", input.kind === "salaries" ? "No queda líquido pendiente de pago en ese mes." : "No quedan seguros sociales pendientes de pago en ese mes: indica el importe si quieres registrar otro pago.");
    }

    const postEntry = input.postEntry ?? true;
    const paymentId = crypto.randomUUID();
    const postedAt = isoToDate(input.paymentDate);
    let journalEntryId: string | null = null;
    if (postEntry) {
      await assertFiscalPeriodOpen(actor.companyId, postedAt, tx);
      const accounts = await payrollAccountIds(tx, actor.companyId);
      const bankId = await bankLedgerAccountId(tx, actor.companyId, input.bankAccountId);
      const reference = `${input.kind === "salaries" ? "Pago de nóminas" : "Pago de seguros sociales"} ${periodLabel(input.period)}`;
      const meta = { concept: reference, documentType: PAYROLL_DOCUMENT_TYPE, documentNumber: input.period, documentId: paymentId };
      const amount = centsToAmount(amountCents);
      const entry = await createAutomaticEntry({
        ...actor,
        dbClient: tx,
        postedAt,
        reference,
        lines: [
          { accountId: input.kind === "salaries" ? accounts.payable : accounts.socialSecurity, debit: amount, credit: 0, ...meta },
          { accountId: bankId, debit: 0, credit: amount, ...meta },
        ],
        action: "payrollPayment.post",
        entityName: PAYROLL_SOURCE.payment,
        entityId: paymentId,
        sourceType: PAYROLL_SOURCE.payment,
        sourceId: paymentId,
      });
      journalEntryId = entry.id;
    }
    await tx.insert(payrollPayment).values({
      id: paymentId,
      companyId: actor.companyId,
      kind: input.kind,
      period: input.period,
      paymentDate: input.paymentDate,
      amount: centsToAmount(amountCents),
      bankAccountId: input.bankAccountId ?? null,
      journalEntryId,
    });
    if (input.kind === "salaries") {
      await tx.update(payrollSlip).set({ paymentDate: input.paymentDate, paymentId, updatedAt: new Date() }).where(inArray(payrollSlip.id, unpaid.map((slip) => slip.id)));
    }
    await recordAudit({ ...actor, action: "payrollPayment.create", entityName: "payrollPayment", entityId: paymentId, payload: { kind: input.kind, period: input.period, paymentDate: input.paymentDate, amount: centsToAmount(amountCents), postEntry } }, tx);
    return { id: paymentId, amountCents, journalEntryId };
  });
}

/** Anula un pago: contraasiento (si tenía asiento) y las nóminas vuelven a quedar pendientes de pago. */
export async function deletePayrollPayment(actor: Actor, id: string, today: string) {
  return db.transaction(async (tx) => {
    const [payment] = await tx.select().from(payrollPayment).where(and(eq(payrollPayment.companyId, actor.companyId), eq(payrollPayment.id, id))).limit(1).for("update");
    if (!payment) throw notFound("Pago");
    if (payment.journalEntryId) {
      const postedAt = await resolveOpenPostingDate(actor.companyId, isoToDate(payment.paymentDate), isoToDate(today), tx);
      const reason = `Anulación del pago de ${payment.kind === "salaries" ? "nóminas" : "seguros sociales"} ${periodLabel(payment.period)}`;
      await reverseAutomaticEntries({ ...actor, dbClient: tx, postedAt, reference: reason, reason, sourceType: PAYROLL_SOURCE.payment, sourceId: payment.id });
    }
    await tx.update(payrollSlip).set({ paymentDate: null, paymentId: null, updatedAt: new Date() }).where(and(eq(payrollSlip.companyId, actor.companyId), eq(payrollSlip.paymentId, payment.id)));
    await tx.delete(payrollPayment).where(eq(payrollPayment.id, payment.id));
    await recordAudit({ ...actor, action: "payrollPayment.delete", entityName: "payrollPayment", entityId: id, payload: { kind: payment.kind, period: payment.period, amount: payment.amount } }, tx);
    return { id };
  });
}

// ---------------------------------------------------------------------------------------------
// Rendimientos del capital pagados (dividendos e intereses): modelos 123 y 193
// ---------------------------------------------------------------------------------------------

export async function listCapitalIncome(companyId: string, year?: number) {
  const conditions = [eq(capitalIncomePayment.companyId, companyId)];
  if (year) conditions.push(gte(capitalIncomePayment.paymentDate, `${year}-01-01`), lt(capitalIncomePayment.paymentDate, `${year + 1}-01-01`));
  return db.select().from(capitalIncomePayment).where(and(...conditions)).orderBy(desc(capitalIncomePayment.paymentDate), asc(capitalIncomePayment.recipientName));
}

/**
 * Registra un dividendo o un interés pagado y lo contabiliza:
 *   (526) Dividendo activo a pagar   |  (662) Intereses de deudas ...... íntegro   al debe
 *        (4751) HP acreedora por retenciones ........................... retención al haber
 *        (572)  Bancos ................................................. líquido   al haber
 * El reparto del dividendo (129 o reservas a 526) lo contabiliza el usuario al aprobarlo.
 */
export async function createCapitalIncome(actor: Actor, input: CapitalIncomeInput) {
  const grossCents = toCents(input.grossAmount);
  const withheldCents = toCents(input.withholdingAmount);
  if (withheldCents > grossCents) throw new AccountingRuleError(422, "CAPITAL_INCOME_WITHHOLDING", "La retención no puede superar el importe íntegro.");
  return db.transaction(async (tx) => {
    const id = crypto.randomUUID();
    const postedAt = isoToDate(input.paymentDate);
    await assertFiscalPeriodOpen(actor.companyId, postedAt, tx);
    const expenseId = (await ensureSubaccount(actor.companyId, input.kind === "dividend" ? PAYROLL_ACCOUNTS.dividendPayable : PAYROLL_ACCOUNTS.interestExpense, tx)).id;
    const withholdingId = (await ensureSubaccount(actor.companyId, PAYROLL_ACCOUNTS.withholding, tx)).id;
    const bankId = await bankLedgerAccountId(tx, actor.companyId, input.bankAccountId);
    const name = input.recipientName.trim();
    const reference = `${input.kind === "dividend" ? "Pago de dividendo" : "Pago de intereses"} · ${name}`.slice(0, 200);
    const meta = { concept: reference, documentType: "CAPITAL_INCOME", documentNumber: input.paymentDate, documentId: id };
    const entry = await createAutomaticEntry({
      ...actor,
      dbClient: tx,
      postedAt,
      reference,
      lines: [
        { accountId: expenseId, debit: centsToAmount(grossCents), credit: 0, ...meta },
        { accountId: withholdingId, debit: 0, credit: centsToAmount(withheldCents), ...meta },
        { accountId: bankId, debit: 0, credit: centsToAmount(grossCents - withheldCents), ...meta },
      ],
      action: "capitalIncomePayment.post",
      entityName: PAYROLL_SOURCE.capitalIncome,
      entityId: id,
      sourceType: PAYROLL_SOURCE.capitalIncome,
      sourceId: id,
    });
    await tx.insert(capitalIncomePayment).values({
      id,
      companyId: actor.companyId,
      recipientName: name,
      recipientTaxId: cleanTaxId(input.recipientTaxId),
      kind: input.kind,
      paymentDate: input.paymentDate,
      grossAmount: centsToAmount(grossCents),
      withholdingRate: String(input.withholdingRate),
      withholdingAmount: centsToAmount(withheldCents),
      bankAccountId: input.bankAccountId ?? null,
      journalEntryId: entry.id,
      notes: clean(input.notes),
    });
    return { id, journalEntryId: entry.id };
  });
}

/** Elimina un rendimiento pagado y anula su asiento. No se permite si su periodo ya está presentado. */
export async function deleteCapitalIncome(actor: Actor, id: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(capitalIncomePayment).where(and(eq(capitalIncomePayment.companyId, actor.companyId), eq(capitalIncomePayment.id, id))).limit(1).for("update");
    if (!row) throw notFound("Rendimiento");
    const postedAt = isoToDate(row.paymentDate);
    await assertFiscalPeriodOpen(actor.companyId, postedAt, tx);
    const reason = `Anulación del pago de ${row.kind === "dividend" ? "dividendo" : "intereses"} · ${row.recipientName}`.slice(0, 200);
    await reverseAutomaticEntries({ ...actor, dbClient: tx, postedAt, reference: reason, reason, sourceType: PAYROLL_SOURCE.capitalIncome, sourceId: row.id });
    await tx.delete(capitalIncomePayment).where(eq(capitalIncomePayment.id, row.id));
    await recordAudit({ ...actor, action: "capitalIncomePayment.delete", entityName: "capitalIncomePayment", entityId: id, payload: { kind: row.kind, recipientName: row.recipientName, grossAmount: row.grossAmount } }, tx);
    return { id };
  });
}

// ---------------------------------------------------------------------------------------------
// Inmuebles alquilados (modelo 180)
// ---------------------------------------------------------------------------------------------

export async function listRentalProperties(companyId: string) {
  return db
    .select({
      id: rentalProperty.id,
      supplierPartnerId: rentalProperty.supplierPartnerId,
      supplierName: partner.name,
      supplierTaxId: partner.taxId,
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
    .orderBy(asc(partner.name), asc(rentalProperty.createdAt));
}

/** Proveedores entre los que elegir al arrendador. */
export async function listLandlordOptions(companyId: string) {
  return db
    .select({ id: partner.id, name: partner.name, taxId: partner.taxId })
    .from(partner)
    .where(and(eq(partner.companyId, companyId), inArray(partner.type, ["SUPPLIER", "BOTH"]), eq(partner.isActive, true)))
    .orderBy(asc(partner.name));
}

function rentalValues(input: RentalPropertyInput) {
  return {
    supplierPartnerId: input.supplierPartnerId,
    situation: input.situation,
    cadastralReference: input.situation === "4" ? null : clean(input.cadastralReference)?.toUpperCase() ?? null,
    address: clean(input.address),
    postalCode: clean(input.postalCode),
    city: clean(input.city),
    province: clean(input.province),
  };
}

async function assertSupplier(client: DbClient, companyId: string, partnerId: string) {
  const [row] = await client.select({ id: partner.id }).from(partner).where(and(eq(partner.companyId, companyId), eq(partner.id, partnerId))).limit(1);
  if (!row) throw notFound("Proveedor");
}

export async function createRentalProperty(actor: Actor, input: RentalPropertyInput) {
  const values = rentalValues(input);
  return db.transaction(async (tx) => {
    await assertSupplier(tx, actor.companyId, values.supplierPartnerId);
    const [created] = await tx.insert(rentalProperty).values({ companyId: actor.companyId, ...values }).returning({ id: rentalProperty.id });
    await recordAudit({ ...actor, action: "rentalProperty.create", entityName: "rentalProperty", entityId: created.id, payload: values }, tx);
    return created;
  });
}

export async function updateRentalProperty(actor: Actor, id: string, input: RentalPropertyInput) {
  const values = rentalValues(input);
  return db.transaction(async (tx) => {
    await assertSupplier(tx, actor.companyId, values.supplierPartnerId);
    const [updated] = await tx.update(rentalProperty).set({ ...values, updatedAt: new Date() }).where(and(eq(rentalProperty.companyId, actor.companyId), eq(rentalProperty.id, id))).returning({ id: rentalProperty.id });
    if (!updated) throw notFound("Inmueble");
    await recordAudit({ ...actor, action: "rentalProperty.update", entityName: "rentalProperty", entityId: id, payload: values }, tx);
    return updated;
  });
}

export async function deleteRentalProperty(actor: Actor, id: string) {
  return db.transaction(async (tx) => {
    const [deleted] = await tx.delete(rentalProperty).where(and(eq(rentalProperty.companyId, actor.companyId), eq(rentalProperty.id, id))).returning({ id: rentalProperty.id });
    if (!deleted) throw notFound("Inmueble");
    await recordAudit({ ...actor, action: "rentalProperty.delete", entityName: "rentalProperty", entityId: id }, tx);
    return { id };
  });
}

// ---------------------------------------------------------------------------------------------
// Ajustes y datos de apoyo
// ---------------------------------------------------------------------------------------------

export async function savePayrollSettings(actor: Actor, input: PayrollSettingsInput) {
  const values = { invoiceWithholdingBasis: input.invoiceWithholdingBasis, payrollWithholdingBasis: input.payrollWithholdingBasis, enabledModels: [...new Set(input.enabledModels)] as string[] };
  await db.transaction(async (tx) => {
    await tx
      .insert(payrollSettings)
      .values({ companyId: actor.companyId, ...values })
      .onConflictDoUpdate({ target: payrollSettings.companyId, set: { ...values, updatedAt: new Date() } });
    await recordAudit({ ...actor, action: "payrollSettings.update", entityName: "payrollSettings", entityId: actor.companyId, payload: values }, tx);
  });
  return getPayrollSettings(actor.companyId);
}

/** Cuentas bancarias activas para elegir de dónde sale un pago. */
export async function listPayrollBankOptions(companyId: string) {
  return db
    .select({ id: bankAccount.id, bankName: bankAccount.bankName, iban: bankAccount.iban })
    .from(bankAccount)
    .where(and(eq(bankAccount.companyId, companyId), eq(bankAccount.isActive, true), isNull(bankAccount.archivedAt)))
    .orderBy(asc(bankAccount.bankName));
}
