import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { accountChart, company, journal, journalEntry, journalLine } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { recordAudit } from "@/server/audit";
import { AccountingRuleError } from "@/server/accounting/errors";
import { validateJournalLines, type JournalLineInput } from "@/server/accounting/journal-validation";
import { assertFiscalPeriodOpen } from "@/server/fiscal/locks";
import { reserveJournalEntryNumber } from "@/server/accounting/numbers";

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

export async function listAccounts(companyId: string) {
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
      isConfiguredActive: accountChart.isActive,
      source: accountChart.source,
      templateVersion: accountChart.templateVersion,
      debit: sql<string>`coalesce(sum(${journalLine.debit}), '0')`,
      credit: sql<string>`coalesce(sum(${journalLine.credit}), '0')`,
      entries: sql<number>`count(${journalLine.id})`,
    })
    .from(accountChart)
    .leftJoin(journalLine, eq(journalLine.accountId, accountChart.id))
    .where(eq(accountChart.companyId, companyId))
    .groupBy(
      accountChart.id,
      accountChart.companyId,
      accountChart.code,
      accountChart.name,
      accountChart.type,
      accountChart.parentCode,
      accountChart.level,
      accountChart.isPostable,
      accountChart.isActive,
      accountChart.source,
      accountChart.templateVersion,
    )
    .orderBy(accountChart.code);

  return rows.map((row) => {
    const debit = Number(row.debit);
    const credit = Number(row.credit);
    const balance = debit - credit;
    return {
      ...row,
      debit,
      credit,
      balance,
      isActive: row.isConfiguredActive || row.entries > 0 || Math.abs(balance) >= 0.005,
    };
  });
}

export async function listPostingAccounts(companyId: string) {
  return db
    .select()
    .from(accountChart)
    .where(and(eq(accountChart.companyId, companyId), eq(accountChart.isPostable, true)))
    .orderBy(accountChart.code);
}

export async function getAccount(companyId: string, id: string) {
  const rows = await db.select().from(accountChart).where(and(eq(accountChart.companyId, companyId), eq(accountChart.id, id))).limit(1);
  return rows[0] ?? null;
}

export async function createAccount(companyId: string, tenantId: string, actorUserId: string, payload: { code: string; name: string; type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE" | "MIXED" }) {
  const code = payload.code.trim();
  const [created] = await db.insert(accountChart).values({ companyId, ...payload, code, level: code.length, isPostable: true, isActive: true, source: "manual" }).returning();
  await recordAudit({ tenantId, companyId, actorUserId, action: "accounting.account.create", entityName: "accountChart", entityId: created.id, payload });
  return created;
}

export async function updateAccount(companyId: string, tenantId: string, actorUserId: string, id: string, payload: { code: string; name: string; type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE" | "MIXED" }) {
  const [updated] = await db.update(accountChart).set(payload).where(and(eq(accountChart.companyId, companyId), eq(accountChart.id, id))).returning();
  if (!updated) return null;
  await recordAudit({ tenantId, companyId, actorUserId, action: "accounting.account.update", entityName: "accountChart", entityId: id, payload });
  return updated;
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

export async function ensureDefaultJournal(companyId: string, client: DbClient = db) {
  const existing = await client.select().from(journal).where(eq(journal.companyId, companyId)).limit(1);
  if (existing[0]) return existing[0];
  const [created] = await client.insert(journal).values({ companyId, code: "GEN", name: "Diario general" }).returning();
  return created;
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

export async function getJournalEntry(companyId: string, id: string) {
  const entries = await db.select().from(journalEntry).where(and(eq(journalEntry.companyId, companyId), eq(journalEntry.id, id))).limit(1);
  if (!entries[0]) return null;
  const lines = await db.select().from(journalLine).where(eq(journalLine.journalEntryId, id));
  return { ...entries[0], lines };
}

async function assertAccountsBelongToCompany(companyId: string, lines: Array<{ accountId: string }>) {
  const allowedAccounts = await db
    .select({ id: accountChart.id })
    .from(accountChart)
    .where(and(eq(accountChart.companyId, companyId), eq(accountChart.isPostable, true)));
  const allowedSet = new Set(allowedAccounts.map((account) => account.id));
  if (lines.some((line) => !allowedSet.has(line.accountId))) {
    throw new AccountingRuleError(422, "ACCOUNT_INVALID", "Alguna cuenta del asiento no existe en el plan contable de la empresa o no admite apuntes.");
  }
}

export async function createJournalEntry(
  companyId: string,
  tenantId: string,
  actorUserId: string,
  payload: { postedAt: Date; reference?: string; lines: JournalLineInput[] },
) {
  const { lines } = validateJournalLines(payload.lines);
  await assertFiscalPeriodOpen(companyId, payload.postedAt);
  await assertAccountsBelongToCompany(companyId, lines);
  const defaultJournal = await ensureDefaultJournal(companyId);

  const entry = await db.transaction(async (tx) => {
    const number = await reserveJournalEntryNumber(tx, companyId);
    const [created] = await tx.insert(journalEntry).values({ companyId, number, journalId: defaultJournal.id, postedAt: payload.postedAt, reference: payload.reference ?? null }).returning();
    await tx.insert(journalLine).values(lines.map((line) => ({ journalEntryId: created.id, accountId: line.accountId, debit: line.debit, credit: line.credit })));
    await tx
      .update(accountChart)
      .set({ isActive: true })
      .where(and(eq(accountChart.companyId, companyId), inArray(accountChart.id, [...new Set(lines.map((line) => line.accountId))])));
    return created;
  });

  await recordAudit({ tenantId, companyId, actorUserId, action: "accounting.entry.create", entityName: "journalEntry", entityId: entry.id, payload: { ...payload, lines } });
  return entry;
}

/**
 * Edición de un asiento manual.
 * - Solo asientos manuales, vigentes (no revertidos) y que no sean a su vez una reversión.
 *   Para corregir asientos automáticos o ya revertidos hay que revertir y crear uno nuevo.
 * - Tanto la fecha original como la nueva deben estar en un periodo abierto: así un asiento
 *   de un periodo presentado o de un ejercicio cerrado no puede "sacarse" de él.
 * - Se audita con los datos anteriores y los nuevos dentro de la misma transacción.
 */
export async function updateJournalEntry(
  companyId: string,
  tenantId: string,
  actorUserId: string,
  id: string,
  payload: { postedAt: Date; reference?: string; lines: JournalLineInput[] },
) {
  const { lines } = validateJournalLines(payload.lines);
  await assertAccountsBelongToCompany(companyId, lines);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        postedAt: journalEntry.postedAt,
        reference: journalEntry.reference,
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

    const previousLines = await tx
      .select({ accountId: journalLine.accountId, debit: journalLine.debit, credit: journalLine.credit })
      .from(journalLine)
      .where(eq(journalLine.journalEntryId, id));
    const [entry] = await tx
      .update(journalEntry)
      .set({ postedAt: payload.postedAt, reference: payload.reference ?? null })
      .where(and(eq(journalEntry.companyId, companyId), eq(journalEntry.id, id)))
      .returning();
    await tx.delete(journalLine).where(eq(journalLine.journalEntryId, id));
    await tx.insert(journalLine).values(lines.map((line) => ({ journalEntryId: id, accountId: line.accountId, debit: line.debit, credit: line.credit })));
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

export async function deleteJournalEntry(companyId: string, tenantId: string, actorUserId: string, id: string) {
  return db.transaction(async (tx) => {
    const [editable] = await tx
      .select({ postedAt: journalEntry.postedAt, journalId: journalEntry.journalId, reference: journalEntry.reference, isAutomatic: journalEntry.isAutomatic, reversedAt: journalEntry.reversedAt })
      .from(journalEntry)
      .where(and(eq(journalEntry.companyId, companyId), eq(journalEntry.id, id)))
      .for("update")
      .limit(1);
    if (!editable) return false;
    if (editable.isAutomatic) throw new AccountingRuleError(409, "ENTRY_AUTOMATIC", "Los asientos automáticos no se pueden revertir desde aquí; corrige o anula el documento de origen.");
    if (editable.reversedAt) throw new AccountingRuleError(409, "ENTRY_REVERSED", "Este asiento ya está revertido.");
    const reversedAt = new Date();
    await assertFiscalPeriodOpen(companyId, reversedAt, tx);
    const lines = await tx.select().from(journalLine).where(eq(journalLine.journalEntryId, id));
    if (lines.length === 0) throw new AccountingRuleError(422, "ENTRY_EMPTY", "No se puede revertir un asiento sin líneas.");
    const number = await reserveJournalEntryNumber(tx, companyId);
    const [reversal] = await tx
      .insert(journalEntry)
      .values({
        companyId,
        number,
        journalId: editable.journalId,
        postedAt: reversedAt,
        reference: `Reversión · ${editable.reference ?? id}`,
        sourceType: "journalEntryReversal",
        sourceId: id,
        reversesEntryId: id,
      })
      .returning({ id: journalEntry.id });
    await tx.insert(journalLine).values(lines.map((line) => ({
      journalEntryId: reversal.id,
      accountId: line.accountId,
      debit: line.credit,
      credit: line.debit,
    })));
    await tx.update(journalEntry).set({ reversedAt }).where(eq(journalEntry.id, id));
    await recordAudit({ tenantId, companyId, actorUserId, action: "accounting.entry.reverse", entityName: "journalEntry", entityId: id, payload: { reversalEntryId: reversal.id } }, tx);
    return true;
  });
}

export async function getLedgerByAccount(companyId: string, accountId: string, range?: { from?: Date; toExclusive?: Date }) {
  return db
    .select({
      lineId: journalLine.id,
      entryId: journalEntry.id,
      number: journalEntry.number,
      postedAt: journalEntry.postedAt,
      reference: journalEntry.reference,
      debit: journalLine.debit,
      credit: journalLine.credit,
    })
    .from(journalLine)
    .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
    .where(and(
      eq(journalEntry.companyId, companyId),
      eq(journalLine.accountId, accountId),
      range?.from ? gte(journalEntry.postedAt, range.from) : undefined,
      range?.toExclusive ? lt(journalEntry.postedAt, range.toExclusive) : undefined,
    ))
    .orderBy(desc(journalEntry.postedAt), desc(journalEntry.number));
}

/** Saldo (debe − haber) de una cuenta antes de `before`: saldo anterior del libro mayor filtrado. */
export async function getLedgerBalanceBefore(companyId: string, accountId: string, before: Date) {
  const [row] = await db
    .select({ balance: sql<string>`coalesce(sum(${journalLine.debit} - ${journalLine.credit}), 0)` })
    .from(journalLine)
    .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
    .where(and(eq(journalEntry.companyId, companyId), eq(journalLine.accountId, accountId), lt(journalEntry.postedAt, before)));
  return Number(row?.balance ?? 0);
}
