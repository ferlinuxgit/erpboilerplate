import { and, desc, eq, sql } from "drizzle-orm";

import { accountChart, company, journal, journalEntry, journalLine } from "@/db/schema";
import { db } from "@/lib/db";
import { recordAudit } from "@/server/audit";

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
  return db.select().from(accountChart).where(eq(accountChart.companyId, companyId)).orderBy(accountChart.code);
}

export async function getAccount(companyId: string, id: string) {
  const rows = await db.select().from(accountChart).where(and(eq(accountChart.companyId, companyId), eq(accountChart.id, id))).limit(1);
  return rows[0] ?? null;
}

export async function createAccount(companyId: string, tenantId: string, actorUserId: string, payload: { code: string; name: string; type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE" }) {
  const [created] = await db.insert(accountChart).values({ companyId, ...payload }).returning();
  await recordAudit({ tenantId, companyId, actorUserId, action: "accounting.account.create", entityName: "accountChart", entityId: created.id, payload });
  return created;
}

export async function updateAccount(companyId: string, tenantId: string, actorUserId: string, id: string, payload: { code: string; name: string; type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE" }) {
  const [updated] = await db.update(accountChart).set(payload).where(and(eq(accountChart.companyId, companyId), eq(accountChart.id, id))).returning();
  if (!updated) return null;
  await recordAudit({ tenantId, companyId, actorUserId, action: "accounting.account.update", entityName: "accountChart", entityId: id, payload });
  return updated;
}

export async function deleteAccount(companyId: string, tenantId: string, actorUserId: string, id: string) {
  const [deleted] = await db.delete(accountChart).where(and(eq(accountChart.companyId, companyId), eq(accountChart.id, id))).returning({ id: accountChart.id });
  if (!deleted) return false;
  await recordAudit({ tenantId, companyId, actorUserId, action: "accounting.account.delete", entityName: "accountChart", entityId: id });
  return true;
}

export async function ensureDefaultJournal(companyId: string) {
  const existing = await db.select().from(journal).where(eq(journal.companyId, companyId)).limit(1);
  if (existing[0]) return existing[0];
  const [created] = await db.insert(journal).values({ companyId, code: "GEN", name: "Diario general" }).returning();
  return created;
}

export async function listJournalEntries(companyId: string) {
  return db
    .select({
      id: journalEntry.id,
      postedAt: journalEntry.postedAt,
      reference: journalEntry.reference,
      debit: sql<string>`coalesce(sum(${journalLine.debit}), '0')`,
      credit: sql<string>`coalesce(sum(${journalLine.credit}), '0')`,
    })
    .from(journalEntry)
    .leftJoin(journalLine, eq(journalLine.journalEntryId, journalEntry.id))
    .where(eq(journalEntry.companyId, companyId))
    .groupBy(journalEntry.id, journalEntry.postedAt, journalEntry.reference)
    .orderBy(desc(journalEntry.postedAt));
}

export async function getJournalEntry(companyId: string, id: string) {
  const entries = await db.select().from(journalEntry).where(and(eq(journalEntry.companyId, companyId), eq(journalEntry.id, id))).limit(1);
  if (!entries[0]) return null;
  const lines = await db.select().from(journalLine).where(eq(journalLine.journalEntryId, id));
  return { ...entries[0], lines };
}

function validateLines(lines: Array<{ accountId: string; debit: string; credit: string }>) {
  if (lines.length < 2) throw new Error("El asiento debe tener al menos dos lineas.");
  const totalDebit = lines.reduce((acc, line) => acc + Number(line.debit || 0), 0);
  const totalCredit = lines.reduce((acc, line) => acc + Number(line.credit || 0), 0);
  if (totalDebit <= 0 || totalCredit <= 0 || Number(totalDebit.toFixed(2)) !== Number(totalCredit.toFixed(2))) {
    throw new Error("El asiento debe estar balanceado (debe = haber).");
  }
}

export async function createJournalEntry(
  companyId: string,
  tenantId: string,
  actorUserId: string,
  payload: { postedAt: Date; reference?: string; lines: Array<{ accountId: string; debit: string; credit: string }> },
) {
  validateLines(payload.lines);
  const allowedAccounts = await db.select({ id: accountChart.id }).from(accountChart).where(eq(accountChart.companyId, companyId));
  const allowedSet = new Set(allowedAccounts.map((a) => a.id));
  if (payload.lines.some((line) => !allowedSet.has(line.accountId))) throw new Error("Cuenta contable invalida.");
  return db.transaction(async (tx) => {
    const defaultJournal = await ensureDefaultJournal(companyId);
    const [entry] = await tx.insert(journalEntry).values({ companyId, journalId: defaultJournal.id, postedAt: payload.postedAt, reference: payload.reference ?? null }).returning();
    await tx.insert(journalLine).values(payload.lines.map((line) => ({ journalEntryId: entry.id, accountId: line.accountId, debit: line.debit, credit: line.credit })));
    await recordAudit({ tenantId, companyId, actorUserId, action: "accounting.entry.create", entityName: "journalEntry", entityId: entry.id, payload });
    return entry;
  });
}

export async function updateJournalEntry(
  companyId: string,
  tenantId: string,
  actorUserId: string,
  id: string,
  payload: { postedAt: Date; reference?: string; lines: Array<{ accountId: string; debit: string; credit: string }> },
) {
  validateLines(payload.lines);
  return db.transaction(async (tx) => {
    const [updated] = await tx.update(journalEntry).set({ postedAt: payload.postedAt, reference: payload.reference ?? null }).where(and(eq(journalEntry.companyId, companyId), eq(journalEntry.id, id))).returning();
    if (!updated) return null;
    await tx.delete(journalLine).where(eq(journalLine.journalEntryId, id));
    await tx.insert(journalLine).values(payload.lines.map((line) => ({ journalEntryId: id, accountId: line.accountId, debit: line.debit, credit: line.credit })));
    await recordAudit({ tenantId, companyId, actorUserId, action: "accounting.entry.update", entityName: "journalEntry", entityId: id, payload });
    return updated;
  });
}

export async function deleteJournalEntry(companyId: string, tenantId: string, actorUserId: string, id: string) {
  const [deleted] = await db.delete(journalEntry).where(and(eq(journalEntry.companyId, companyId), eq(journalEntry.id, id))).returning({ id: journalEntry.id });
  if (!deleted) return false;
  await recordAudit({ tenantId, companyId, actorUserId, action: "accounting.entry.delete", entityName: "journalEntry", entityId: id });
  return true;
}

export async function getLedgerByAccount(companyId: string, accountId: string) {
  return db
    .select({
      entryId: journalEntry.id,
      postedAt: journalEntry.postedAt,
      reference: journalEntry.reference,
      debit: journalLine.debit,
      credit: journalLine.credit,
    })
    .from(journalLine)
    .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
    .where(and(eq(journalEntry.companyId, companyId), eq(journalLine.accountId, accountId)))
    .orderBy(desc(journalEntry.postedAt));
}
