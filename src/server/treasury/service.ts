import { and, desc, eq } from "drizzle-orm";

import { bankAccount, bankTransaction } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { recordAudit } from "@/server/audit";

export async function listTreasury(companyId: string) {
  return db
    .select({
      bankName: bankAccount.bankName,
      iban: bankAccount.iban,
      amount: bankTransaction.amount,
      description: bankTransaction.description,
      postedAt: bankTransaction.postedAt,
    })
    .from(bankAccount)
    .leftJoin(bankTransaction, eq(bankTransaction.bankAccountId, bankAccount.id))
    .where(eq(bankAccount.companyId, companyId))
    .orderBy(desc(bankTransaction.postedAt));
}

export async function listBankAccounts(companyId: string) {
  return db.select().from(bankAccount).where(eq(bankAccount.companyId, companyId)).orderBy(desc(bankAccount.bankName));
}

export async function getBankAccount(companyId: string, id: string) {
  const rows = await db
    .select()
    .from(bankAccount)
    .where(and(eq(bankAccount.companyId, companyId), eq(bankAccount.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createBankAccount(companyId: string, tenantId: string, actorUserId: string, payload: { iban: string; bankName: string }) {
  const [created] = await db.insert(bankAccount).values({ companyId, iban: payload.iban, bankName: payload.bankName }).returning();
  await recordAudit({ tenantId, companyId, actorUserId, action: "treasury.account.create", entityName: "bankAccount", entityId: created.id, payload });
  return created;
}

export async function updateBankAccount(companyId: string, tenantId: string, actorUserId: string, id: string, payload: { iban: string; bankName: string }) {
  const [updated] = await db
    .update(bankAccount)
    .set({ iban: payload.iban, bankName: payload.bankName })
    .where(and(eq(bankAccount.companyId, companyId), eq(bankAccount.id, id)))
    .returning();
  if (!updated) return null;
  await recordAudit({ tenantId, companyId, actorUserId, action: "treasury.account.update", entityName: "bankAccount", entityId: id, payload });
  return updated;
}

export async function deleteBankAccount(companyId: string, tenantId: string, actorUserId: string, id: string) {
  const [deleted] = await db.delete(bankAccount).where(and(eq(bankAccount.companyId, companyId), eq(bankAccount.id, id))).returning({ id: bankAccount.id });
  if (!deleted) return false;
  await recordAudit({ tenantId, companyId, actorUserId, action: "treasury.account.delete", entityName: "bankAccount", entityId: id });
  return true;
}

export async function listBankTransactions(companyId: string, bankAccountId?: string) {
  return db
    .select({
      id: bankTransaction.id,
      bankAccountId: bankAccount.id,
      bankName: bankAccount.bankName,
      iban: bankAccount.iban,
      amount: bankTransaction.amount,
      description: bankTransaction.description,
      postedAt: bankTransaction.postedAt,
      reconciliationStatus: bankTransaction.reconciliationStatus,
      matchedInvoicePaymentId: bankTransaction.matchedInvoicePaymentId,
      matchedSupplierPaymentId: bankTransaction.matchedSupplierPaymentId,
      reconciledAt: bankTransaction.reconciledAt,
    })
    .from(bankTransaction)
    .innerJoin(bankAccount, eq(bankTransaction.bankAccountId, bankAccount.id))
    .where(
      bankAccountId
        ? and(eq(bankAccount.companyId, companyId), eq(bankAccount.id, bankAccountId))
        : eq(bankAccount.companyId, companyId),
    )
    .orderBy(desc(bankTransaction.postedAt));
}

export async function getBankTransaction(companyId: string, id: string, client: DbClient = db) {
  const [row] = await client
    .select({
      id: bankTransaction.id,
      bankAccountId: bankAccount.id,
      bankName: bankAccount.bankName,
      iban: bankAccount.iban,
      amount: bankTransaction.amount,
      description: bankTransaction.description,
      postedAt: bankTransaction.postedAt,
      reconciliationStatus: bankTransaction.reconciliationStatus,
      matchedInvoicePaymentId: bankTransaction.matchedInvoicePaymentId,
      matchedSupplierPaymentId: bankTransaction.matchedSupplierPaymentId,
      reconciledAt: bankTransaction.reconciledAt,
    })
    .from(bankTransaction)
    .innerJoin(bankAccount, eq(bankTransaction.bankAccountId, bankAccount.id))
    .where(and(eq(bankTransaction.id, id), eq(bankAccount.companyId, companyId)))
    .limit(1);
  return row ?? null;
}

export async function createBankTransaction(
  companyId: string,
  tenantId: string,
  actorUserId: string,
  payload: { bankAccountId: string; amount: string; description: string; postedAt: Date },
  client: DbClient = db,
) {
  const [account] = await client
    .select({ id: bankAccount.id })
    .from(bankAccount)
    .where(and(eq(bankAccount.companyId, companyId), eq(bankAccount.id, payload.bankAccountId)))
    .limit(1);
  if (!account) throw new Error("Cuenta bancaria no encontrada.");
  const [created] = await client.insert(bankTransaction).values(payload).returning();
  await recordAudit({ tenantId, companyId, actorUserId, action: "treasury.transaction.create", entityName: "bankTransaction", entityId: created.id, payload }, client);
  return created;
}

export async function updateBankTransaction(
  companyId: string,
  tenantId: string,
  actorUserId: string,
  id: string,
  payload: { bankAccountId: string; amount: string; description: string; postedAt: Date },
  client: DbClient = db,
) {
  const [account] = await client.select({ id: bankAccount.id }).from(bankAccount).where(and(eq(bankAccount.companyId, companyId), eq(bankAccount.id, payload.bankAccountId))).limit(1);
  if (!account) throw new Error("Cuenta bancaria no encontrada.");
  const [existingTransaction] = await client.select({ id: bankTransaction.id, bankAccountId: bankTransaction.bankAccountId }).from(bankTransaction).innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.bankAccountId)).where(and(eq(bankTransaction.id, id), eq(bankAccount.companyId, companyId))).limit(1);
  if (!existingTransaction) return null;
  const [updated] = await client
    .update(bankTransaction)
    .set(payload)
    .where(and(eq(bankTransaction.id, id), eq(bankTransaction.bankAccountId, existingTransaction.bankAccountId)))
    .returning();
  if (!updated) return null;
  await recordAudit({ tenantId, companyId, actorUserId, action: "treasury.transaction.update", entityName: "bankTransaction", entityId: id, payload }, client);
  return updated;
}

export async function deleteBankTransaction(companyId: string, tenantId: string, actorUserId: string, id: string, client: DbClient = db) {
  const [txRow] = await client.select({ id: bankTransaction.id, bankAccountId: bankTransaction.bankAccountId }).from(bankTransaction).innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.bankAccountId)).where(and(eq(bankTransaction.id, id), eq(bankAccount.companyId, companyId))).limit(1);
  if (!txRow) return false;
  await client.delete(bankTransaction).where(and(eq(bankTransaction.id, id), eq(bankTransaction.bankAccountId, txRow.bankAccountId)));
  await recordAudit({ tenantId, companyId, actorUserId, action: "treasury.transaction.delete", entityName: "bankTransaction", entityId: id }, client);
  return true;
}
