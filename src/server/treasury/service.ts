import { and, count, desc, eq, like } from "drizzle-orm";

import { accountChart, bankAccount, bankTransaction, paymentMethod } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { postBankTransaction, reverseAutomaticEntries } from "@/server/accounting/auto-post";
import { AccountingRuleError } from "@/server/accounting/errors";
import { recordAudit } from "@/server/audit";
import { assertFiscalPeriodOpen } from "@/server/fiscal/locks";

type BankAccountPayload = { iban: string; bankName: string; accountId?: string | null };
type BankTransactionPayload = { bankAccountId: string; amount: string; description: string; postedAt: Date };

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
  return db
    .select({
      id: bankAccount.id,
      companyId: bankAccount.companyId,
      iban: bankAccount.iban,
      bankName: bankAccount.bankName,
      accountId: bankAccount.accountId,
      accountCode: accountChart.code,
      accountName: accountChart.name,
      isActive: bankAccount.isActive,
      archivedAt: bankAccount.archivedAt,
    })
    .from(bankAccount)
    .leftJoin(accountChart, eq(accountChart.id, bankAccount.accountId))
    .where(eq(bankAccount.companyId, companyId))
    .orderBy(desc(bankAccount.isActive), bankAccount.bankName, bankAccount.id);
}

export async function getBankAccount(companyId: string, id: string) {
  const rows = await db
    .select({
      id: bankAccount.id,
      companyId: bankAccount.companyId,
      iban: bankAccount.iban,
      bankName: bankAccount.bankName,
      accountId: bankAccount.accountId,
      accountCode: accountChart.code,
      accountName: accountChart.name,
      isActive: bankAccount.isActive,
      archivedAt: bankAccount.archivedAt,
    })
    .from(bankAccount)
    .leftJoin(accountChart, eq(accountChart.id, bankAccount.accountId))
    .where(and(eq(bankAccount.companyId, companyId), eq(bankAccount.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

/** Cuentas contables de tesorería (grupo 57) que admiten apuntes, para vincularlas a un banco. */
export async function listTreasuryLedgerAccounts(companyId: string) {
  return db
    .select({ id: accountChart.id, code: accountChart.code, name: accountChart.name })
    .from(accountChart)
    .where(and(eq(accountChart.companyId, companyId), eq(accountChart.isPostable, true), like(accountChart.code, "57%")))
    .orderBy(accountChart.code);
}

/** La subcuenta contable de un banco debe ser de la empresa, admitir apuntes y ser de tesorería (grupo 57). */
async function assertBankLedgerAccount(client: DbClient, companyId: string, accountId: string | null | undefined) {
  if (!accountId) return null;
  const [account] = await client
    .select({ id: accountChart.id, code: accountChart.code })
    .from(accountChart)
    .where(and(eq(accountChart.companyId, companyId), eq(accountChart.id, accountId), eq(accountChart.isPostable, true)))
    .limit(1);
  if (!account) throw new AccountingRuleError(422, "ACCOUNT_INVALID", "La cuenta contable elegida no existe o no admite apuntes.");
  if (!account.code.startsWith("57")) {
    throw new AccountingRuleError(422, "ACCOUNT_NOT_TREASURY", "La cuenta contable de un banco debe ser de tesorería (grupo 57, por ejemplo 572).");
  }
  return account.id;
}

export async function createBankAccount(companyId: string, tenantId: string, actorUserId: string, payload: BankAccountPayload) {
  return db.transaction(async (tx) => {
    const accountId = await assertBankLedgerAccount(tx, companyId, payload.accountId);
    const [created] = await tx.insert(bankAccount).values({ companyId, iban: payload.iban, bankName: payload.bankName, accountId }).returning();
    await tx.insert(paymentMethod).values({
      companyId,
      bankAccountId: created.id,
      code: `AUTO-BANK-${created.id}`,
      name: `Transferencia · ${created.bankName}`,
      type: "BANK_TRANSFER",
      bankAccountNumber: created.iban,
    });
    await recordAudit({ tenantId, companyId, actorUserId, action: "treasury.account.create", entityName: "bankAccount", entityId: created.id, payload }, tx);
    return created;
  });
}

export async function updateBankAccount(companyId: string, tenantId: string, actorUserId: string, id: string, payload: BankAccountPayload) {
  return db.transaction(async (tx) => {
    const accountId = payload.accountId === undefined ? undefined : await assertBankLedgerAccount(tx, companyId, payload.accountId);
    const [updated] = await tx
      .update(bankAccount)
      .set({ iban: payload.iban, bankName: payload.bankName, ...(accountId === undefined ? {} : { accountId }) })
      .where(and(eq(bankAccount.companyId, companyId), eq(bankAccount.id, id)))
      .returning();
    if (!updated) return null;
    await tx.update(paymentMethod)
      .set({ bankAccountNumber: updated.iban, updatedAt: new Date() })
      .where(and(eq(paymentMethod.companyId, companyId), eq(paymentMethod.bankAccountId, id)));
    await tx.update(paymentMethod)
      .set({ name: `Transferencia · ${updated.bankName}`, updatedAt: new Date() })
      .where(and(
        eq(paymentMethod.companyId, companyId),
        eq(paymentMethod.bankAccountId, id),
        eq(paymentMethod.code, `AUTO-BANK-${id}`),
      ));
    await recordAudit({ tenantId, companyId, actorUserId, action: "treasury.account.update", entityName: "bankAccount", entityId: id, payload }, tx);
    return updated;
  });
}

/** Archiva (o reactiva) una cuenta bancaria: deja de ofrecerse para nuevos movimientos sin perder el historial. */
export async function setBankAccountArchived(companyId: string, tenantId: string, actorUserId: string, id: string, archived: boolean) {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(bankAccount)
      .set({ isActive: !archived, archivedAt: archived ? new Date() : null })
      .where(and(eq(bankAccount.companyId, companyId), eq(bankAccount.id, id)))
      .returning();
    if (!updated) return null;
    await recordAudit({
      tenantId, companyId, actorUserId,
      action: archived ? "treasury.account.archive" : "treasury.account.reactivate",
      entityName: "bankAccount",
      entityId: id,
    }, tx);
    return updated;
  });
}

/**
 * Borra una cuenta bancaria solo si no tiene movimientos. Con movimientos se exige archivarla:
 * los movimientos tienen asientos contabilizados y no se pueden eliminar en cascada.
 */
export async function deleteBankAccount(companyId: string, tenantId: string, actorUserId: string, id: string) {
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ id: bankAccount.id })
      .from(bankAccount)
      .where(and(eq(bankAccount.companyId, companyId), eq(bankAccount.id, id)))
      .for("update")
      .limit(1);
    if (!owned) return false;
    const [movements] = await tx.select({ total: count() }).from(bankTransaction).where(eq(bankTransaction.bankAccountId, id));
    if ((movements?.total ?? 0) > 0) {
      throw new AccountingRuleError(
        409,
        "BANK_ACCOUNT_HAS_MOVEMENTS",
        "Esta cuenta tiene movimientos contabilizados y no se puede borrar. Archívala para ocultarla sin perder el historial.",
      );
    }
    await tx.delete(paymentMethod).where(and(eq(paymentMethod.companyId, companyId), eq(paymentMethod.bankAccountId, id)));
    await tx.delete(bankAccount).where(and(eq(bankAccount.companyId, companyId), eq(bankAccount.id, id)));
    await recordAudit({ tenantId, companyId, actorUserId, action: "treasury.account.delete", entityName: "bankAccount", entityId: id }, tx);
    return true;
  });
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
    .orderBy(desc(bankTransaction.postedAt), desc(bankTransaction.id));
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

async function assertUsableBankAccount(client: DbClient, companyId: string, bankAccountId: string) {
  const [account] = await client
    .select({ id: bankAccount.id, isActive: bankAccount.isActive })
    .from(bankAccount)
    .where(and(eq(bankAccount.companyId, companyId), eq(bankAccount.id, bankAccountId)))
    .limit(1);
  if (!account) throw new AccountingRuleError(404, "BANK_ACCOUNT_NOT_FOUND", "Cuenta bancaria no encontrada.");
  if (!account.isActive) throw new AccountingRuleError(409, "BANK_ACCOUNT_ARCHIVED", "La cuenta bancaria está archivada. Reactívala para registrar movimientos.");
  return account;
}

export async function createBankTransaction(
  companyId: string,
  tenantId: string,
  actorUserId: string,
  payload: BankTransactionPayload,
  client: DbClient = db,
) {
  await assertUsableBankAccount(client, companyId, payload.bankAccountId);
  const [created] = await client.insert(bankTransaction).values(payload).returning();
  await recordAudit({ tenantId, companyId, actorUserId, action: "treasury.transaction.create", entityName: "bankTransaction", entityId: created.id, payload }, client);
  return created;
}

/** Alta de movimiento + asiento banco ↔ 555 (pendiente de aplicación), en la transacción recibida. */
export async function recordBankTransaction(
  companyId: string,
  tenantId: string,
  actorUserId: string,
  payload: BankTransactionPayload,
  client: DbClient,
) {
  await assertFiscalPeriodOpen(companyId, payload.postedAt, client);
  const created = await createBankTransaction(companyId, tenantId, actorUserId, payload, client);
  await postBankTransaction({
    tenantId,
    companyId,
    actorUserId,
    bankTransactionId: created.id,
    bankAccountId: payload.bankAccountId,
    postedAt: payload.postedAt,
    reference: `Movimiento bancario · ${payload.description}`.slice(0, 200),
    amount: Number(payload.amount),
    dbClient: client,
  });
  return created;
}

/** Edita un movimiento pendiente: revierte su asiento y lo vuelve a contabilizar con los datos nuevos. */
export async function updateBankTransactionWithPosting(
  companyId: string,
  tenantId: string,
  actorUserId: string,
  id: string,
  payload: BankTransactionPayload,
) {
  return db.transaction(async (tx) => {
    const existing = await getBankTransaction(companyId, id, tx);
    if (!existing) return null;
    if (existing.reconciliationStatus === "RECONCILED") {
      throw new AccountingRuleError(409, "BANK_TRANSACTION_RECONCILED", "No se puede editar un movimiento conciliado. Desconcílialo primero.");
    }
    await assertFiscalPeriodOpen(companyId, existing.postedAt, tx);
    await assertFiscalPeriodOpen(companyId, payload.postedAt, tx);
    if (payload.bankAccountId !== existing.bankAccountId) await assertUsableBankAccount(tx, companyId, payload.bankAccountId);
    await reverseAutomaticEntries({
      tenantId, companyId, actorUserId,
      postedAt: payload.postedAt,
      reference: `Corrección movimiento ${id}`,
      sourceType: "bankTransaction",
      sourceId: id,
      reason: `Reversión por edición del movimiento ${existing.description}`.slice(0, 200),
      dbClient: tx,
    });
    const [updated] = await tx
      .update(bankTransaction)
      .set(payload)
      .where(and(eq(bankTransaction.id, id), eq(bankTransaction.bankAccountId, existing.bankAccountId)))
      .returning();
    if (!updated) return null;
    await postBankTransaction({
      tenantId, companyId, actorUserId,
      bankTransactionId: id,
      bankAccountId: payload.bankAccountId,
      postedAt: payload.postedAt,
      reference: `Movimiento bancario corregido · ${payload.description}`.slice(0, 200),
      amount: Number(payload.amount),
      dbClient: tx,
    });
    await recordAudit({
      tenantId, companyId, actorUserId,
      action: "treasury.transaction.update",
      entityName: "bankTransaction",
      entityId: id,
      payload: { before: { amount: existing.amount, postedAt: existing.postedAt, description: existing.description, bankAccountId: existing.bankAccountId }, after: payload },
    }, tx);
    return updated;
  });
}

/** Elimina un movimiento pendiente revirtiendo su asiento (nunca se borran asientos). */
export async function deleteBankTransactionWithPosting(companyId: string, tenantId: string, actorUserId: string, id: string) {
  return db.transaction(async (tx) => {
    const existing = await getBankTransaction(companyId, id, tx);
    if (!existing) return false;
    if (existing.reconciliationStatus === "RECONCILED") {
      throw new AccountingRuleError(409, "BANK_TRANSACTION_RECONCILED", "No se puede eliminar un movimiento conciliado. Desconcílialo primero.");
    }
    await assertFiscalPeriodOpen(companyId, existing.postedAt, tx);
    await reverseAutomaticEntries({
      tenantId, companyId, actorUserId,
      postedAt: existing.postedAt,
      reference: `Eliminación movimiento ${id}`,
      sourceType: "bankTransaction",
      sourceId: id,
      reason: `Reversión por eliminación del movimiento ${existing.description}`.slice(0, 200),
      dbClient: tx,
    });
    await tx.delete(bankTransaction).where(and(eq(bankTransaction.id, id), eq(bankTransaction.bankAccountId, existing.bankAccountId)));
    await recordAudit({
      tenantId, companyId, actorUserId,
      action: "treasury.transaction.delete",
      entityName: "bankTransaction",
      entityId: id,
      payload: { amount: existing.amount, postedAt: existing.postedAt, description: existing.description },
    }, tx);
    return true;
  });
}
