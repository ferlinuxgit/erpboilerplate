import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { accountChart, company, fiscalYear, journalEntry, journalLine, partner } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { recordAudit } from "@/server/audit";
import { accountingRange, loadCompanyTimeZone, postedBeforeSql, postedBetweenSql, resolveAccountingDay } from "@/server/accounting/fiscal-year-date";
import { requireLegalizedBooksConfirmation } from "@/server/accounting/books/legalization";
import { AccountingRuleError } from "@/server/accounting/errors";
import { toCents } from "@/server/accounting/money";
import { ensureJournal } from "@/server/accounting/journals";
import { validateJournalLines, type JournalLineInput } from "@/server/accounting/journal-validation";
import { reserveJournalEntryNumber } from "@/server/accounting/numbers";
import { reversalConcept } from "@/server/accounting/posting-context";
import { changeSubaccountLength, createManualAccount, loadChartContext, toPostableAccountId, type ManualAccountInput } from "@/server/accounting/subaccounts";
import { isCanonicalSubaccountCode, natureForAccountType } from "@/server/accounting/subaccounts-model";
import { assertFiscalPeriodOpen } from "@/server/fiscal/locks";

type AccountType = ManualAccountInput["type"];

export async function getTrialBalance(companyId: string) {
  return db
    .select({
      debit: sql<string>`coalesce(sum(${journalLine.debit}), '0')`,
      credit: sql<string>`coalesce(sum(${journalLine.credit}), '0')`,
      entries: sql<number>`count(distinct ${journalEntry.id})`,
    })
    .from(company)
    .leftJoin(journalEntry, eq(journalEntry.companyId, company.id))
    .leftJoin(journalLine, eq(journalLine.journalEntryId, journalEntry.id))
    .where(eq(company.id, companyId));
}

type AccountTotals = { debitCents: number; creditCents: number; entries: number };

/**
 * Sumas de las cuentas de grupo (función pura): cada cuenta suma sus propios apuntes y los de todas
 * las cuentas cuyo código empieza por el suyo (4 → 43 → 430 → 4300 → 43000001).
 */
export function aggregateAccountTotals<T extends { code: string; debitCents: number; creditCents: number; entries: number }>(rows: T[]) {
  const byPrefix = new Map<string, AccountTotals>();
  for (const row of rows) {
    if (row.debitCents === 0 && row.creditCents === 0 && row.entries === 0) continue;
    for (let size = 1; size < row.code.length; size += 1) {
      const prefix = row.code.slice(0, size);
      const current = byPrefix.get(prefix) ?? { debitCents: 0, creditCents: 0, entries: 0 };
      byPrefix.set(prefix, {
        debitCents: current.debitCents + row.debitCents,
        creditCents: current.creditCents + row.creditCents,
        entries: current.entries + row.entries,
      });
    }
  }
  return rows.map((row) => {
    const children = byPrefix.get(row.code) ?? { debitCents: 0, creditCents: 0, entries: 0 };
    return {
      ...row,
      debitCents: row.debitCents + children.debitCents,
      creditCents: row.creditCents + children.creditCents,
      entries: row.entries + children.entries,
    };
  });
}

/**
 * Plan contable plano con sumas por cuenta (agregadas por prefijo en los grupos).
 * Con `range` las sumas son del periodo y `opening` es el saldo anterior (sin cierre y apertura,
 * como los estados financieros); sin él, todo el histórico.
 */
export async function listAccounts(companyId: string, range?: { from: Date; toExclusive: Date }) {
  const lifecycle = sql`coalesce(${journalEntry.sourceType}, '') in ('fiscalYearRegularization', 'fiscalYearClosing', 'fiscalYearOpening')`;
  const closingOpening = sql`coalesce(${journalEntry.sourceType}, '') in ('fiscalYearClosing', 'fiscalYearOpening')`;
  // Límites en la hora local de la empresa, como el ejercicio (ver `fiscal-year-date.ts`).
  const period = range ? accountingRange(range, await loadCompanyTimeZone(db, companyId)) : null;
  const inPeriod = period ? sql`not ${postedBeforeSql(period, "from")} and ${postedBeforeSql(period, "toExclusive")} and not ${lifecycle}` : sql`true`;
  const beforePeriod = period ? sql`${postedBeforeSql(period, "from")} and not ${closingOpening}` : sql`false`;
  const rows = await db
    .select({
      id: accountChart.id,
      companyId: accountChart.companyId,
      code: accountChart.code,
      name: accountChart.name,
      type: accountChart.type,
      parentCode: accountChart.parentCode,
      level: accountChart.level,
      isPostable: accountChart.isPostable,
      isBlocked: accountChart.isBlocked,
      nature: accountChart.nature,
      isConfiguredActive: accountChart.isActive,
      source: accountChart.source,
      templateVersion: accountChart.templateVersion,
      partnerId: accountChart.partnerId,
      partnerName: partner.name,
      partnerNumber: partner.number,
      opening: sql<string>`coalesce(sum(case when ${beforePeriod} then ${journalLine.debit} - ${journalLine.credit} else 0 end), '0')`,
      debit: sql<string>`coalesce(sum(case when ${inPeriod} then ${journalLine.debit} else 0 end), '0')`,
      credit: sql<string>`coalesce(sum(case when ${inPeriod} then ${journalLine.credit} else 0 end), '0')`,
      entries: sql<number>`count(case when ${journalLine.id} is not null and ${inPeriod} then 1 end)`.mapWith(Number),
    })
    .from(accountChart)
    .leftJoin(journalLine, eq(journalLine.accountId, accountChart.id))
    .leftJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
    .leftJoin(partner, eq(partner.id, accountChart.partnerId))
    .where(eq(accountChart.companyId, companyId))
    .groupBy(accountChart.id, partner.id)
    .orderBy(accountChart.code);

  // El saldo inicial se agrega como un importe más (en el debe) y se separa después.
  const openings = aggregateAccountTotals(rows.map((row) => ({ code: row.code, debitCents: toCents(row.opening), creditCents: 0, entries: 0 })));
  const aggregated = aggregateAccountTotals(rows.map((row) => ({
    ...row,
    debitCents: toCents(row.debit),
    creditCents: toCents(row.credit),
  })));
  return aggregated.map(({ debitCents, creditCents, ...row }, index) => {
    const openingCents = openings[index]?.debitCents ?? 0;
    const debit = debitCents / 100;
    const credit = creditCents / 100;
    const balance = (openingCents + debitCents - creditCents) / 100;
    return {
      ...row,
      opening: openingCents / 100,
      debit,
      credit,
      balance,
      isActive: row.isConfiguredActive || row.entries > 0 || Math.abs(balance) >= 0.005,
    };
  });
}

/** Cuentas donde se puede apuntar (subcuentas no bloqueadas), para los selectores de cuenta. */
export async function listPostingAccounts(companyId: string) {
  return db
    .select()
    .from(accountChart)
    .where(and(eq(accountChart.companyId, companyId), eq(accountChart.isPostable, true), eq(accountChart.isBlocked, false)))
    .orderBy(accountChart.code);
}

/** Terceros de la empresa (clientes y proveedores) para el campo «Tercero» de los apuntes manuales. */
export async function listPartnerOptions(companyId: string) {
  return db
    .select({ id: partner.id, name: partner.name })
    .from(partner)
    .where(and(eq(partner.companyId, companyId), eq(partner.isActive, true)))
    .orderBy(asc(partner.name));
}

export async function getAccount(companyId: string, id: string) {
  const rows = await db.select().from(accountChart).where(and(eq(accountChart.companyId, companyId), eq(accountChart.id, id))).limit(1);
  return rows[0] ?? null;
}

export async function createAccount(companyId: string, tenantId: string, actorUserId: string, payload: { code: string; name: string; type: AccountType }) {
  return db.transaction(async (tx) => {
    const created = await createManualAccount(tx, companyId, payload);
    await recordAudit({ tenantId, companyId, actorUserId, action: "accounting.account.create", entityName: "accountChart", entityId: created.id, payload: { ...payload, postingCode: created.code } }, tx);
    return created;
  });
}

/**
 * Edición de una cuenta. El código no se puede cambiar si la cuenta tiene apuntes (rompería el
 * histórico) ni en las subcuentas de terceros; si cambia, se vuelve a enlazar con su cuenta padre.
 */
export async function updateAccount(
  companyId: string,
  tenantId: string,
  actorUserId: string,
  id: string,
  payload: { code: string; name: string; type: AccountType; isBlocked?: boolean },
) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: accountChart.id, code: accountChart.code, partnerId: accountChart.partnerId, isPostable: accountChart.isPostable })
      .from(accountChart)
      .where(and(eq(accountChart.companyId, companyId), eq(accountChart.id, id)))
      .for("update")
      .limit(1);
    if (!current) return null;
    const code = payload.code.trim();
    const changes: Partial<typeof accountChart.$inferInsert> = {
      name: payload.name.trim(),
      type: payload.type,
      nature: natureForAccountType(payload.type),
      ...(payload.isBlocked !== undefined ? { isBlocked: payload.isBlocked } : {}),
    };
    if (code !== current.code) {
      const [used] = await tx.select({ id: journalLine.id }).from(journalLine).where(eq(journalLine.accountId, id)).limit(1);
      if (used) throw new AccountingRuleError(409, "ACCOUNT_HAS_ENTRIES", "La cuenta tiene apuntes: su código no se puede cambiar. Crea una cuenta nueva si la necesitas.");
      if (current.partnerId) throw new AccountingRuleError(409, "ACCOUNT_PARTNER", "El código de la subcuenta de un cliente o proveedor lo asigna el sistema.");
      const context = await loadChartContext(companyId, tx);
      if (!/^\d+$/.test(code)) throw new AccountingRuleError(422, "ACCOUNT_CODE_INVALID", "El código de la cuenta solo puede tener dígitos.");
      if (current.isPostable && !isCanonicalSubaccountCode(code, context.subaccountLength)) {
        throw new AccountingRuleError(422, "ACCOUNT_CODE_LENGTH", `Una subcuenta debe tener ${context.subaccountLength} dígitos.`);
      }
      const [clash] = await tx.select({ id: accountChart.id }).from(accountChart).where(and(eq(accountChart.companyId, companyId), eq(accountChart.code, code))).limit(1);
      if (clash) throw new AccountingRuleError(409, "ACCOUNT_EXISTS", `Ya existe la cuenta ${code} en el plan contable.`);
      const prefixes = Array.from({ length: code.length - 1 }, (_, index) => code.slice(0, index + 1));
      const parents = prefixes.length > 0
        ? await tx.select({ code: accountChart.code }).from(accountChart).where(and(eq(accountChart.companyId, companyId), inArray(accountChart.code, prefixes)))
        : [];
      const parentCode = parents.map((row) => row.code).sort((a, b) => b.length - a.length)[0] ?? null;
      if (current.isPostable && !parentCode) {
        throw new AccountingRuleError(422, "ACCOUNT_PARENT_MISSING", `No existe ninguna cuenta de grupo para ${code}.`);
      }
      Object.assign(changes, { code, parentCode, level: code.length });
    }
    const [updated] = await tx.update(accountChart).set(changes).where(and(eq(accountChart.companyId, companyId), eq(accountChart.id, id))).returning();
    await recordAudit({ tenantId, companyId, actorUserId, action: "accounting.account.update", entityName: "accountChart", entityId: id, payload: { before: { code: current.code }, ...payload } }, tx);
    return updated;
  });
}

/**
 * Bloquea o desbloquea una subcuenta: bloqueada no admite apuntes manuales nuevos (los automáticos
 * y el histórico no cambian). Las cuentas de grupo no admiten apuntes, así que no se bloquean.
 */
export async function setAccountBlocked(companyId: string, tenantId: string, actorUserId: string, id: string, blocked: boolean) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: accountChart.id, code: accountChart.code, isPostable: accountChart.isPostable })
      .from(accountChart)
      .where(and(eq(accountChart.companyId, companyId), eq(accountChart.id, id)))
      .for("update")
      .limit(1);
    if (!current) return null;
    if (!current.isPostable) {
      throw new AccountingRuleError(422, "ACCOUNT_GROUP_BLOCK", "Solo se pueden bloquear subcuentas: una cuenta de grupo no admite apuntes.");
    }
    const [updated] = await tx
      .update(accountChart)
      .set({ isBlocked: blocked })
      .where(and(eq(accountChart.companyId, companyId), eq(accountChart.id, id)))
      .returning({ id: accountChart.id, code: accountChart.code, isBlocked: accountChart.isBlocked });
    await recordAudit({
      tenantId,
      companyId,
      actorUserId,
      action: blocked ? "accounting.account.block" : "accounting.account.unblock",
      entityName: "accountChart",
      entityId: id,
      payload: { code: current.code },
    }, tx);
    return updated;
  });
}

export async function deleteAccount(companyId: string, tenantId: string, actorUserId: string, id: string) {
  const [updated] = await db
    .update(accountChart)
    .set({ isActive: false })
    .where(and(eq(accountChart.companyId, companyId), eq(accountChart.id, id)))
    .returning({ id: accountChart.id });
  if (!updated) return false;
  await recordAudit({ tenantId, companyId, actorUserId, action: "accounting.account.deactivate", entityName: "accountChart", entityId: id });
  return true;
}

/** Diario general (GEN) de la empresa, creado si falta. */
export async function ensureDefaultJournal(companyId: string, client: DbClient = db) {
  return ensureJournal(companyId, "GEN", client);
}

export async function listJournalEntries(companyId: string) {
  return db
    .select({
      id: journalEntry.id,
      number: journalEntry.number,
      postedAt: journalEntry.postedAt,
      reference: journalEntry.reference,
      isAutomatic: journalEntry.isAutomatic,
      reversedAt: journalEntry.reversedAt,
      reversesEntryId: journalEntry.reversesEntryId,
      sourceType: journalEntry.sourceType,
      debit: sql<string>`coalesce(sum(${journalLine.debit}), '0')`,
      credit: sql<string>`coalesce(sum(${journalLine.credit}), '0')`,
    })
    .from(journalEntry)
    .leftJoin(journalLine, eq(journalLine.journalEntryId, journalEntry.id))
    .where(eq(journalEntry.companyId, companyId))
    .groupBy(journalEntry.id, journalEntry.number, journalEntry.postedAt, journalEntry.reference, journalEntry.isAutomatic, journalEntry.reversedAt, journalEntry.reversesEntryId, journalEntry.sourceType)
    .orderBy(desc(journalEntry.postedAt), desc(journalEntry.number));
}

/** Asiento con sus apuntes: cuenta, concepto, tercero y documento de cada línea, en su orden. */
export async function getJournalEntry(companyId: string, id: string) {
  const entries = await db.select().from(journalEntry).where(and(eq(journalEntry.companyId, companyId), eq(journalEntry.id, id))).limit(1);
  if (!entries[0]) return null;
  const lines = await db
    .select({
      id: journalLine.id,
      journalEntryId: journalLine.journalEntryId,
      lineNumber: journalLine.lineNumber,
      accountId: journalLine.accountId,
      accountCode: accountChart.code,
      accountName: accountChart.name,
      debit: journalLine.debit,
      credit: journalLine.credit,
      concept: journalLine.concept,
      partnerId: journalLine.partnerId,
      partnerName: partner.name,
      documentType: journalLine.documentType,
      documentNumber: journalLine.documentNumber,
      documentId: journalLine.documentId,
      dueDate: journalLine.dueDate,
    })
    .from(journalLine)
    .innerJoin(accountChart, eq(accountChart.id, journalLine.accountId))
    .leftJoin(partner, eq(partner.id, journalLine.partnerId))
    .where(eq(journalLine.journalEntryId, id))
    .orderBy(asc(journalLine.lineNumber), asc(journalLine.id));
  return { ...entries[0], lines };
}

export type ManualJournalLineInput = JournalLineInput & { concept?: string | null; partnerId?: string | null };

type PreparedLine = { accountId: string; debit: string; credit: string; concept: string | null; partnerId: string | null };

/**
 * Valida cuentas (de la empresa, que admitan apuntes y no bloqueadas) y terceros de un asiento
 * manual, y lleva cada línea a su subcuenta canónica.
 */
async function prepareManualLines(client: DbClient, companyId: string, input: ManualJournalLineInput[], reference: string | undefined) {
  const { lines } = validateJournalLines(input);
  const accountIds = [...new Set(lines.map((line) => line.accountId))];
  const allowedAccounts = await client
    .select({ id: accountChart.id, isBlocked: accountChart.isBlocked, code: accountChart.code })
    .from(accountChart)
    .where(and(eq(accountChart.companyId, companyId), eq(accountChart.isPostable, true), inArray(accountChart.id, accountIds)));
  const allowed = new Map(allowedAccounts.map((account) => [account.id, account]));
  if (accountIds.some((id) => !allowed.has(id))) {
    throw new AccountingRuleError(422, "ACCOUNT_INVALID", "Alguna cuenta del asiento no existe en el plan contable de la empresa o no admite apuntes.");
  }
  const blocked = allowedAccounts.find((account) => account.isBlocked);
  if (blocked) throw new AccountingRuleError(422, "ACCOUNT_BLOCKED", `La cuenta ${blocked.code} está bloqueada y no admite apuntes nuevos.`);

  const partnerIds = [...new Set(input.map((line) => line.partnerId?.trim()).filter((id): id is string => Boolean(id)))];
  if (partnerIds.length > 0) {
    const owned = await client.select({ id: partner.id }).from(partner).where(and(eq(partner.companyId, companyId), inArray(partner.id, partnerIds)));
    if (owned.length !== partnerIds.length) throw new AccountingRuleError(422, "PARTNER_INVALID", "Algún tercero del asiento no existe en la empresa.");
  }

  const postable = new Map<string, string>();
  for (const id of accountIds) postable.set(id, await toPostableAccountId(companyId, id, client));
  let previousConcept = reference?.trim() || null;
  return lines.map((line, index): PreparedLine => {
    // Como en ContaPlus/Sage: una línea sin concepto hereda el de la anterior (o la referencia).
    const concept = input[index]?.concept?.trim() || previousConcept;
    previousConcept = concept;
    return {
      accountId: postable.get(line.accountId) ?? line.accountId,
      debit: line.debit,
      credit: line.credit,
      concept: concept ? concept.slice(0, 200) : null,
      partnerId: input[index]?.partnerId?.trim() || null,
    };
  });
}

function manualLineValues(entryId: string, lines: PreparedLine[]) {
  return lines.map((line, index) => ({
    journalEntryId: entryId,
    lineNumber: index + 1,
    accountId: line.accountId,
    debit: line.debit,
    credit: line.credit,
    concept: line.concept,
    partnerId: line.partnerId,
  }));
}

export type ManualJournalEntryPayload = {
  postedAt: Date;
  reference?: string;
  lines: ManualJournalLineInput[];
  /** El usuario ha confirmado que sabe que los libros del ejercicio están presentados a legalizar. */
  acknowledgeLegalizedBooks?: boolean;
};

/** Rastro en la auditoría de que se modificó un ejercicio con libros legalizados (con confirmación). */
function legalizedAuditPayload(notices: Awaited<ReturnType<typeof requireLegalizedBooksConfirmation>>) {
  return notices.length > 0 ? { legalizedBooksConfirmed: notices } : {};
}

export async function createJournalEntry(
  companyId: string,
  tenantId: string,
  actorUserId: string,
  input: ManualJournalEntryPayload,
) {
  const { acknowledgeLegalizedBooks, ...payload } = input;
  validateJournalLines(payload.lines);
  await assertFiscalPeriodOpen(companyId, payload.postedAt);

  const { entry, lines, legalizedBooks } = await db.transaction(async (tx) => {
    const prepared = await prepareManualLines(tx, companyId, payload.lines, payload.reference);
    const generalJournal = await ensureJournal(companyId, "GEN", tx);
    const { number, fiscalYearId } = await reserveJournalEntryNumber(tx, companyId, payload.postedAt);
    // Libros del ejercicio ya presentados a legalizar: hace falta confirmación expresa (si falta, la
    // transacción se deshace y no se consume el número).
    const legalized = await requireLegalizedBooksConfirmation(tx, companyId, [fiscalYearId], acknowledgeLegalizedBooks);
    const [created] = await tx
      .insert(journalEntry)
      .values({ companyId, number, fiscalYearId, journalId: generalJournal.id, postedAt: payload.postedAt, reference: payload.reference ?? null })
      .returning();
    await tx.insert(journalLine).values(manualLineValues(created.id, prepared));
    await tx
      .update(accountChart)
      .set({ isActive: true })
      .where(and(eq(accountChart.companyId, companyId), inArray(accountChart.id, [...new Set(prepared.map((line) => line.accountId))])));
    return { entry: created, lines: prepared, legalizedBooks: legalized };
  });

  await recordAudit({ tenantId, companyId, actorUserId, action: "accounting.entry.create", entityName: "journalEntry", entityId: entry.id, payload: { ...payload, lines, ...legalizedAuditPayload(legalizedBooks) } });
  return entry;
}

async function fiscalYearIdFor(client: DbClient, companyId: string, date: Date) {
  // Día civil en la zona horaria de la empresa, como la serie y la numeración de asientos.
  const day = await resolveAccountingDay(client, companyId, date);
  const [year] = await client
    .select({ id: fiscalYear.id })
    .from(fiscalYear)
    .where(and(eq(fiscalYear.companyId, companyId), sql`${day} >= ${fiscalYear.startsAt}`, sql`${day} < (${fiscalYear.endsAt} + interval '1 day')`))
    .limit(1);
  return year?.id ?? null;
}

/**
 * Edición de un asiento manual.
 * - Solo asientos manuales, vigentes (no revertidos) y que no sean a su vez una reversión.
 *   Para corregir asientos automáticos o ya revertidos hay que revertir y crear uno nuevo.
 * - Tanto la fecha original como la nueva deben estar en un periodo abierto: así un asiento
 *   de un periodo presentado o de un ejercicio cerrado no puede "sacarse" de él.
 * - Si los libros del ejercicio están presentados a legalizar, exige confirmación expresa.
 * - La numeración es por ejercicio: el asiento no puede pasar a otro ejercicio.
 * - Se audita con los datos anteriores y los nuevos dentro de la misma transacción.
 */
export async function updateJournalEntry(
  companyId: string,
  tenantId: string,
  actorUserId: string,
  id: string,
  input: ManualJournalEntryPayload,
) {
  const { acknowledgeLegalizedBooks, ...payload } = input;
  validateJournalLines(payload.lines);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        postedAt: journalEntry.postedAt,
        reference: journalEntry.reference,
        fiscalYearId: journalEntry.fiscalYearId,
        isAutomatic: journalEntry.isAutomatic,
        reversedAt: journalEntry.reversedAt,
        reversesEntryId: journalEntry.reversesEntryId,
      })
      .from(journalEntry)
      .where(and(eq(journalEntry.companyId, companyId), eq(journalEntry.id, id)))
      .for("update")
      .limit(1);
    if (!existing) return null;
    assertJournalEntryEditable(existing);
    await assertFiscalPeriodOpen(companyId, existing.postedAt, tx);
    await assertFiscalPeriodOpen(companyId, payload.postedAt, tx);
    if (existing.fiscalYearId && (await fiscalYearIdFor(tx, companyId, payload.postedAt)) !== existing.fiscalYearId) {
      throw new AccountingRuleError(409, "ENTRY_OTHER_FISCAL_YEAR", "La nueva fecha es de otro ejercicio. Revierte este asiento y créalo en el ejercicio correcto.");
    }
    const legalizedBooks = await requireLegalizedBooksConfirmation(tx, companyId, [existing.fiscalYearId], acknowledgeLegalizedBooks);
    const lines = await prepareManualLines(tx, companyId, payload.lines, payload.reference);

    const previousLines = await tx
      .select({ accountId: journalLine.accountId, debit: journalLine.debit, credit: journalLine.credit, concept: journalLine.concept, partnerId: journalLine.partnerId })
      .from(journalLine)
      .where(eq(journalLine.journalEntryId, id));
    const [entry] = await tx
      .update(journalEntry)
      .set({ postedAt: payload.postedAt, reference: payload.reference ?? null })
      .where(and(eq(journalEntry.companyId, companyId), eq(journalEntry.id, id)))
      .returning();
    await tx.delete(journalLine).where(eq(journalLine.journalEntryId, id));
    await tx.insert(journalLine).values(manualLineValues(id, lines));
    await tx
      .update(accountChart)
      .set({ isActive: true })
      .where(and(eq(accountChart.companyId, companyId), inArray(accountChart.id, [...new Set(lines.map((line) => line.accountId))])));
    await recordAudit({
      tenantId,
      companyId,
      actorUserId,
      action: "accounting.entry.update",
      entityName: "journalEntry",
      entityId: id,
      payload: {
        before: { postedAt: existing.postedAt, reference: existing.reference, lines: previousLines },
        after: { postedAt: payload.postedAt, reference: payload.reference ?? null, lines },
        ...legalizedAuditPayload(legalizedBooks),
      },
    }, tx);
    return entry;
  });
}

/** Reglas de edición de asientos (función pura, testeable). */
export function assertJournalEntryEditable(entry: { isAutomatic: boolean; reversedAt: Date | null; reversesEntryId: string | null }) {
  if (entry.isAutomatic) {
    throw new AccountingRuleError(409, "ENTRY_AUTOMATIC", "Los asientos automáticos no se pueden editar. Corrige o anula el documento de origen (factura, cobro, movimiento) y el asiento se regenerará.");
  }
  if (entry.reversedAt) {
    throw new AccountingRuleError(409, "ENTRY_REVERSED", "Este asiento ya está revertido y no se puede editar. Crea un asiento nuevo con los importes correctos.");
  }
  if (entry.reversesEntryId) {
    throw new AccountingRuleError(409, "ENTRY_IS_REVERSAL", "Este asiento es una reversión y no se puede editar. Si es necesario, revierte el asiento original de nuevo con un asiento manual.");
  }
}

/**
 * Revierte un asiento manual con un contraasiento fechado hoy. Si los libros del ejercicio del
 * asiento original (o del ejercicio en curso) están presentados a legalizar, exige confirmación.
 */
export async function deleteJournalEntry(companyId: string, tenantId: string, actorUserId: string, id: string, options: { acknowledgeLegalizedBooks?: boolean } = {}) {
  return db.transaction(async (tx) => {
    const [editable] = await tx
      .select({ postedAt: journalEntry.postedAt, fiscalYearId: journalEntry.fiscalYearId, journalId: journalEntry.journalId, reference: journalEntry.reference, isAutomatic: journalEntry.isAutomatic, reversedAt: journalEntry.reversedAt })
      .from(journalEntry)
      .where(and(eq(journalEntry.companyId, companyId), eq(journalEntry.id, id)))
      .for("update")
      .limit(1);
    if (!editable) return false;
    if (editable.isAutomatic) throw new AccountingRuleError(409, "ENTRY_AUTOMATIC", "Los asientos automáticos no se pueden revertir desde aquí; corrige o anula el documento de origen.");
    if (editable.reversedAt) throw new AccountingRuleError(409, "ENTRY_REVERSED", "Este asiento ya está revertido.");
    const reversedAt = new Date();
    await assertFiscalPeriodOpen(companyId, reversedAt, tx);
    const lines = await tx.select().from(journalLine).where(eq(journalLine.journalEntryId, id)).orderBy(asc(journalLine.lineNumber), asc(journalLine.id));
    if (lines.length === 0) throw new AccountingRuleError(422, "ENTRY_EMPTY", "No se puede revertir un asiento sin líneas.");
    const { number, fiscalYearId } = await reserveJournalEntryNumber(tx, companyId, reversedAt);
    const legalizedBooks = await requireLegalizedBooksConfirmation(tx, companyId, [editable.fiscalYearId, fiscalYearId], options.acknowledgeLegalizedBooks);
    const reference = `Reversión · ${editable.reference ?? id}`;
    const [reversal] = await tx
      .insert(journalEntry)
      .values({
        companyId,
        number,
        fiscalYearId,
        journalId: editable.journalId,
        postedAt: reversedAt,
        reference,
        sourceType: "journalEntryReversal",
        sourceId: id,
        reversesEntryId: id,
      })
      .returning({ id: journalEntry.id });
    await tx.insert(journalLine).values(lines.map((line, index) => ({
      journalEntryId: reversal.id,
      lineNumber: index + 1,
      accountId: line.accountId,
      debit: line.credit,
      credit: line.debit,
      concept: reversalConcept(line.concept, reference),
      partnerId: line.partnerId,
      documentType: line.documentType,
      documentNumber: line.documentNumber,
      documentId: line.documentId,
      dueDate: line.dueDate,
    })));
    await tx.update(journalEntry).set({ reversedAt }).where(eq(journalEntry.id, id));
    await recordAudit({ tenantId, companyId, actorUserId, action: "accounting.entry.reverse", entityName: "journalEntry", entityId: id, payload: { reversalEntryId: reversal.id, ...legalizedAuditPayload(legalizedBooks) } }, tx);
    return true;
  });
}

/**
 * Mayor de una cuenta. El rango son días civiles (`toExclusive` = día siguiente al último) y se
 * aplica con los límites del ejercicio en hora local (ver `fiscal-year-date.ts`).
 */
export async function getLedgerByAccount(companyId: string, accountId: string, range?: { from?: Date; toExclusive?: Date }) {
  const inRange = range?.from || range?.toExclusive ? postedBetweenSql(range, await loadCompanyTimeZone(db, companyId)) : undefined;
  return db
    .select({
      lineId: journalLine.id,
      entryId: journalEntry.id,
      number: journalEntry.number,
      postedAt: journalEntry.postedAt,
      reference: journalEntry.reference,
      concept: journalLine.concept,
      partnerId: journalLine.partnerId,
      partnerName: partner.name,
      documentType: journalLine.documentType,
      documentNumber: journalLine.documentNumber,
      documentId: journalLine.documentId,
      dueDate: journalLine.dueDate,
      debit: journalLine.debit,
      credit: journalLine.credit,
    })
    .from(journalLine)
    .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
    .leftJoin(partner, eq(partner.id, journalLine.partnerId))
    .where(and(eq(journalEntry.companyId, companyId), eq(journalLine.accountId, accountId), inRange))
    .orderBy(desc(journalEntry.postedAt), desc(journalEntry.number), desc(journalLine.lineNumber));
}

/** Saldo (debe − haber) de una cuenta antes del día civil `before`: saldo anterior del libro mayor filtrado. */
export async function getLedgerBalanceBefore(companyId: string, accountId: string, before: Date) {
  const range = accountingRange({ from: before, toExclusive: before }, await loadCompanyTimeZone(db, companyId));
  const [row] = await db
    .select({ balance: sql<string>`coalesce(sum(${journalLine.debit} - ${journalLine.credit}), 0)` })
    .from(journalLine)
    .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
    .where(and(eq(journalEntry.companyId, companyId), eq(journalLine.accountId, accountId), postedBeforeSql(range, "from")));
  return Number(row?.balance ?? 0);
}

/** Cambia la longitud de las subcuentas de la empresa (solo sin asientos) y lo audita. */
export async function updateSubaccountLength(companyId: string, tenantId: string, actorUserId: string, subaccountLength: number) {
  return db.transaction(async (tx) => {
    const result = await changeSubaccountLength(tx, companyId, subaccountLength);
    await recordAudit({ tenantId, companyId, actorUserId, action: "accounting.subaccountLength.update", entityName: "companySettings", entityId: companyId, payload: { subaccountLength, renamed: result.changed } }, tx);
    return result;
  });
}
