import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { accountChart, company, journal, journalEntry, journalLine } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { recordAudit } from "@/server/audit";
import { validateJournalLines, type JournalLineInput } from "@/server/accounting/journal-validation";
import { assertFiscalPeriodOpen } from "@/server/fiscal/locks";

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

async function assertAccountsBelongToCompany(companyId: string, lines: Array<{ accountId: string }>) {
  const allowedAccounts = await db
    .select({ id: accountChart.id })
    .from(accountChart)
    .where(and(eq(accountChart.companyId, companyId), eq(accountChart.isPostable, true)));
  const allowedSet = new Set(allowedAccounts.map((account) => account.id));
  if (lines.some((line) => !allowedSet.has(line.accountId))) throw new Error("Cuenta contable invalida.");
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
    const [created] = await tx.insert(journalEntry).values({ companyId, journalId: defaultJournal.id, postedAt: payload.postedAt, reference: payload.reference ?? null }).returning();
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

export async function updateJournalEntry(
  companyId: string,
  tenantId: string,
  actorUserId: string,
  id: string,
  payload: { postedAt: Date; reference?: string; lines: JournalLineInput[] },
) {
  const { lines } = validateJournalLines(payload.lines);
  await assertFiscalPeriodOpen(companyId, payload.postedAt);
  await assertAccountsBelongToCompany(companyId, lines);

  const [editable] = await db.select({ isAutomatic: journalEntry.isAutomatic }).from(journalEntry).where(and(eq(journalEntry.companyId, companyId), eq(journalEntry.id, id))).limit(1);
  if (editable?.isAutomatic) throw new Error("Los asientos automáticos no se pueden editar; corrige el documento de origen.");

  const updated = await db.transaction(async (tx) => {
    const [entry] = await tx.update(journalEntry).set({ postedAt: payload.postedAt, reference: payload.reference ?? null }).where(and(eq(journalEntry.companyId, companyId), eq(journalEntry.id, id))).returning();
    if (!entry) return null;
    await tx.delete(journalLine).where(eq(journalLine.journalEntryId, id));
    await tx.insert(journalLine).values(lines.map((line) => ({ journalEntryId: id, accountId: line.accountId, debit: line.debit, credit: line.credit })));
    await tx
      .update(accountChart)
      .set({ isActive: true })
      .where(and(eq(accountChart.companyId, companyId), inArray(accountChart.id, [...new Set(lines.map((line) => line.accountId))])));
    return entry;
  });

  if (!updated) return null;
  await recordAudit({ tenantId, companyId, actorUserId, action: "accounting.entry.update", entityName: "journalEntry", entityId: id, payload: { ...payload, lines } });
  return updated;
}

export async function deleteJournalEntry(companyId: string, tenantId: string, actorUserId: string, id: string) {
  const [editable] = await db.select({ postedAt: journalEntry.postedAt, isAutomatic: journalEntry.isAutomatic }).from(journalEntry).where(and(eq(journalEntry.companyId, companyId), eq(journalEntry.id, id))).limit(1);
  if (!editable) return false;
  if (editable.isAutomatic) throw new Error("Los asientos automáticos no se pueden eliminar; corrige el documento de origen.");
  await assertFiscalPeriodOpen(companyId, editable.postedAt);
  const [deleted] = await db.delete(journalEntry).where(and(eq(journalEntry.companyId, companyId), eq(journalEntry.id, id))).returning({ id: journalEntry.id });
  if (!deleted) return false;
  await recordAudit({ tenantId, companyId, actorUserId, action: "accounting.entry.delete", entityName: "journalEntry", entityId: id });
  return true;
}

export async function getLedgerByAccount(companyId: string, accountId: string) {
  return db
    .select({
      lineId: journalLine.id,
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
