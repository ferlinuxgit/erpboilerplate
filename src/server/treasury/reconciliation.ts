import { and, eq, gte, lte } from "drizzle-orm";

import { bankAccount, bankTransaction, bankTransactionAllocation, invoice, invoicePayment, payment, supplierInvoice, supplierInvoicePayment, supplierPayment } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { planImport } from "@/lib/bank-import/dedupe";
import { parseBankCsv } from "@/lib/bank-csv";
import { postBankTransaction, reverseAutomaticEntries } from "@/server/accounting/auto-post";
import { AccountingRuleError, isAccountingRuleError } from "@/server/accounting/errors";
import { toCents } from "@/server/accounting/money";
import { recordAudit } from "@/server/audit";
import { resolveOpenPostingDate } from "@/server/fiscal/locks";
import { recordBankTransaction } from "@/server/treasury/service";

/*
 * Modelo contable de la conciliación (evita la doble contabilización banco/cobro):
 *
 * - Un movimiento bancario (manual o importado) se contabiliza Banco ↔ 555 "Partidas pendientes
 *   de aplicación": refleja el extracto aunque aún no sepamos a qué corresponde.
 * - Un cobro/pago de factura se contabiliza Banco ↔ 430/400.
 * - Al conciliar ambos, el asiento del movimiento se revierte: queda un único efecto en Banco
 *   (el del cobro/pago, que además salda al cliente/proveedor) y 555 vuelve a cero.
 * - Al desconciliar, se vuelve a contabilizar el movimiento contra 555.
 * - Lo que quede en 555 al final del periodo son movimientos sin identificar (comisiones,
 *   cobros desconocidos…), que el usuario debe conciliar o reclasificar.
 *
 * La fecha de la reversión/recontabilización es la del movimiento si su periodo está abierto;
 * si ya está presentado o cerrado se usa la fecha de hoy.
 */

type Actor = { companyId: string; tenantId: string; actorUserId: string };
export type ReconcileKind = "customer" | "supplier";

async function lockBankTransaction(client: DbClient, companyId: string, transactionId: string) {
  const [row] = await client
    .select({
      id: bankTransaction.id,
      bankAccountId: bankTransaction.bankAccountId,
      amount: bankTransaction.amount,
      description: bankTransaction.description,
      postedAt: bankTransaction.postedAt,
      status: bankTransaction.reconciliationStatus,
    })
    .from(bankTransaction)
    .innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.bankAccountId))
    .where(and(eq(bankTransaction.id, transactionId), eq(bankAccount.companyId, companyId)))
    .for("update", { of: bankTransaction })
    .limit(1);
  return row ?? null;
}

/** Tipo de contrapartida esperado según el signo del movimiento (función pura). */
export function expectedReconcileKind(amount: string | number): ReconcileKind {
  return Number(amount) >= 0 ? "customer" : "supplier";
}

/**
 * Concilia un movimiento con un cobro (invoicePayment) o pago (supplierInvoicePayment) del mismo
 * importe y revierte el asiento provisional del movimiento. Debe ejecutarse dentro de una transacción.
 */
export async function reconcileBankTransaction(
  client: DbClient,
  input: Actor & { transactionId: string; kind: ReconcileKind; matchId: string; now?: Date },
) {
  const row = await lockBankTransaction(client, input.companyId, input.transactionId);
  if (!row) throw new AccountingRuleError(404, "BANK_TRANSACTION_NOT_FOUND", "Movimiento no encontrado.");
  if (row.status === "RECONCILED") throw new AccountingRuleError(409, "ALREADY_RECONCILED", "El movimiento ya está conciliado.");
  if (input.kind !== expectedReconcileKind(row.amount)) {
    throw new AccountingRuleError(422, "KIND_MISMATCH", "Un ingreso solo se concilia con cobros de clientes y un cargo con pagos a proveedores.");
  }
  const amount = (Math.abs(toCents(row.amount)) / 100).toFixed(2);

  let matchedInvoicePaymentId: string | null = null;
  let matchedSupplierPaymentId: string | null = null;
  if (input.kind === "customer") {
    const [candidate] = await client
      .select({ id: invoicePayment.id })
      .from(invoicePayment)
      .where(and(eq(invoicePayment.id, input.matchId), eq(invoicePayment.companyId, input.companyId), eq(invoicePayment.amountApplied, amount)))
      .limit(1);
    if (!candidate) throw new AccountingRuleError(422, "MATCH_INVALID", "El cobro no existe o no coincide en importe con el movimiento.");
    const [alreadyUsed] = await client
      .select({ id: bankTransaction.id })
      .from(bankTransaction)
      .innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.bankAccountId))
      .where(and(eq(bankAccount.companyId, input.companyId), eq(bankTransaction.matchedInvoicePaymentId, candidate.id)))
      .limit(1);
    if (alreadyUsed) throw new AccountingRuleError(409, "MATCH_USED", "Ese cobro ya está conciliado con otro movimiento.");
    const [allocated] = await client
      .select({ id: bankTransactionAllocation.id })
      .from(bankTransactionAllocation)
      .where(and(eq(bankTransactionAllocation.companyId, input.companyId), eq(bankTransactionAllocation.invoicePaymentId, candidate.id)))
      .limit(1);
    if (allocated) throw new AccountingRuleError(409, "MATCH_USED", "Ese cobro ya está conciliado con otro movimiento.");
    matchedInvoicePaymentId = candidate.id;
  } else {
    const [candidate] = await client
      .select({ id: supplierInvoicePayment.id })
      .from(supplierInvoicePayment)
      .where(and(eq(supplierInvoicePayment.id, input.matchId), eq(supplierInvoicePayment.companyId, input.companyId), eq(supplierInvoicePayment.amountApplied, amount)))
      .limit(1);
    if (!candidate) throw new AccountingRuleError(422, "MATCH_INVALID", "El pago no existe o no coincide en importe con el movimiento.");
    const [alreadyUsed] = await client
      .select({ id: bankTransaction.id })
      .from(bankTransaction)
      .innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.bankAccountId))
      .where(and(eq(bankAccount.companyId, input.companyId), eq(bankTransaction.matchedSupplierPaymentId, candidate.id)))
      .limit(1);
    if (alreadyUsed) throw new AccountingRuleError(409, "MATCH_USED", "Ese pago ya está conciliado con otro movimiento.");
    const [allocated] = await client
      .select({ id: bankTransactionAllocation.id })
      .from(bankTransactionAllocation)
      .where(and(eq(bankTransactionAllocation.companyId, input.companyId), eq(bankTransactionAllocation.supplierInvoicePaymentId, candidate.id)))
      .limit(1);
    if (allocated) throw new AccountingRuleError(409, "MATCH_USED", "Ese pago ya está conciliado con otro movimiento.");
    matchedSupplierPaymentId = candidate.id;
  }

  const now = input.now ?? new Date();
  const reversalDate = await resolveOpenPostingDate(input.companyId, row.postedAt, now, client);
  const reversed = await reverseAutomaticEntries({
    tenantId: input.tenantId,
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    postedAt: reversalDate,
    reference: `Conciliación movimiento ${row.description}`.slice(0, 200),
    sourceType: "bankTransaction",
    sourceId: row.id,
    reason: `Conciliado con ${input.kind === "customer" ? "cobro" : "pago"}: se anula el apunte pendiente de aplicación`,
    dbClient: client,
  });

  const [updated] = await client
    .update(bankTransaction)
    .set({ reconciliationStatus: "RECONCILED", matchedInvoicePaymentId, matchedSupplierPaymentId, reconciledAt: now, resolution: "PAYMENT" })
    .where(eq(bankTransaction.id, row.id))
    .returning();
  await recordAudit({
    tenantId: input.tenantId,
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    action: "treasury.reconcile.match",
    entityName: "bankTransaction",
    entityId: row.id,
    payload: { kind: input.kind, matchId: input.matchId, reversedEntries: reversed, reversalDate },
  }, client);
  return updated;
}

/** Deshace la conciliación y vuelve a contabilizar el movimiento contra 555. */
export async function unreconcileBankTransaction(client: DbClient, input: Actor & { transactionId: string; now?: Date }) {
  const row = await lockBankTransaction(client, input.companyId, input.transactionId);
  if (!row) throw new AccountingRuleError(404, "BANK_TRANSACTION_NOT_FOUND", "Movimiento no encontrado.");
  if (row.status !== "RECONCILED") throw new AccountingRuleError(409, "NOT_RECONCILED", "El movimiento ya está pendiente de conciliar.");

  const now = input.now ?? new Date();
  const postingDate = await resolveOpenPostingDate(input.companyId, row.postedAt, now, client);
  await postBankTransaction({
    tenantId: input.tenantId,
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    bankTransactionId: row.id,
    bankAccountId: row.bankAccountId,
    postedAt: postingDate,
    reference: `Movimiento desconciliado · ${row.description}`.slice(0, 200),
    amount: Number(row.amount),
    dbClient: client,
  });
  const [updated] = await client
    .update(bankTransaction)
    .set({ reconciliationStatus: "PENDING", matchedInvoicePaymentId: null, matchedSupplierPaymentId: null, reconciledAt: null, resolution: null })
    .where(eq(bankTransaction.id, row.id))
    .returning();
  await recordAudit({
    tenantId: input.tenantId,
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    action: "treasury.reconcile.undo",
    entityName: "bankTransaction",
    entityId: row.id,
    payload: { postingDate },
  }, client);
  return updated;
}

/** Clave de deduplicación de un movimiento importado (fecha exacta, importe con 2 decimales y concepto). */
export function bankTransactionKey(postedAt: Date, amount: string | number, description: string) {
  return `${postedAt.getTime()}|${Number(amount).toFixed(2)}|${description}`;
}

async function existingBankTransactions(client: DbClient, bankAccountId: string, dates: Date[]) {
  const times = dates.map((date) => date.getTime()).filter(Number.isFinite);
  if (times.length === 0) return [];
  return client
    .select({ postedAt: bankTransaction.postedAt, amount: bankTransaction.amount, description: bankTransaction.description, balanceAfter: bankTransaction.balanceAfter })
    .from(bankTransaction)
    .where(and(
      eq(bankTransaction.bankAccountId, bankAccountId),
      gte(bankTransaction.postedAt, new Date(Math.min(...times))),
      lte(bankTransaction.postedAt, new Date(Math.max(...times))),
    ));
}

/**
 * Importación rápida de un CSV "fecha;importe;concepto" (API). El asistente de la interfaz usa
 * `commitBankImport` (CSV/Excel con mapeo de columnas y Norma 43).
 */
export async function importBankCsv(input: Actor & { bankAccountId: string; content: string }) {
  const [ownedAccount] = await db
    .select({ id: bankAccount.id, isActive: bankAccount.isActive })
    .from(bankAccount)
    .where(and(eq(bankAccount.id, input.bankAccountId), eq(bankAccount.companyId, input.companyId)))
    .limit(1);
  if (!ownedAccount) throw new AccountingRuleError(404, "BANK_ACCOUNT_NOT_FOUND", "Cuenta bancaria no encontrada.");
  if (!ownedAccount.isActive) throw new AccountingRuleError(409, "BANK_ACCOUNT_ARCHIVED", "La cuenta bancaria está archivada. Reactívala para importar movimientos.");

  const rows = parseBankCsv(input.content);
  if (rows.length === 0) return { created: [], duplicates: 0 };

  return db.transaction(async (tx) => {
    const created = [];
    // Duplicados: una sola consulta por el rango de fechas del fichero. Se cuentan ocurrencias
    // (ver `planImport`): dos cargos idénticos del mismo día en el fichero son dos movimientos
    // reales; solo se omiten los que ya estaban guardados.
    const existing = await existingBankTransactions(tx, input.bankAccountId, rows.map((row) => row.postedAt));
    const plan = planImport(existing, rows.map((row, index) => ({ ...row, line: index + 2, valueDate: null, reference: null, balanceAfter: null })));
    for (const row of plan.toInsert) {
      const transaction = await recordBankTransaction(input.companyId, input.tenantId, input.actorUserId, {
        bankAccountId: input.bankAccountId,
        postedAt: row.postedAt,
        amount: row.amount.toFixed(2),
        description: row.description,
      }, tx);
      created.push(transaction);
    }
    return { created, duplicates: plan.duplicates.length };
  });
}

/**
 * Busca cobros/pagos del mismo importe en ±3 días y concilia cuando hay un único candidato
 * (o uno solo cuyo número aparece en el concepto). Cada conciliación va en su propia transacción:
 * si una falla (p. ej. periodo bloqueado) se cuenta como omitida y el resto continúa.
 */
export async function autoReconcileBankTransactions(companyId: string, actor: { tenantId: string; actorUserId: string }) {
  const [pending, existingMatches] = await Promise.all([db
    .select({
      id: bankTransaction.id,
      amount: bankTransaction.amount,
      description: bankTransaction.description,
      postedAt: bankTransaction.postedAt,
    })
    .from(bankTransaction)
    .innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.bankAccountId))
    .where(and(eq(bankAccount.companyId, companyId), eq(bankTransaction.reconciliationStatus, "PENDING"))),
  db
    .select({ invoicePaymentId: bankTransaction.matchedInvoicePaymentId, supplierPaymentId: bankTransaction.matchedSupplierPaymentId })
    .from(bankTransaction)
    .innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.bankAccountId))
    .where(and(eq(bankAccount.companyId, companyId), eq(bankTransaction.reconciliationStatus, "RECONCILED"))),
  ]);

  const usedInvoicePayments = new Set(existingMatches.map((row) => row.invoicePaymentId).filter((id): id is string => Boolean(id)));
  const usedSupplierPayments = new Set(existingMatches.map((row) => row.supplierPaymentId).filter((id): id is string => Boolean(id)));
  const normalizeReference = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");

  let reconciled = 0;
  let skipped = 0;
  for (const tx of pending) {
    const amountAbs = (Math.abs(toCents(tx.amount)) / 100).toFixed(2);
    const normalizedDescription = normalizeReference(tx.description);
    const from = new Date(tx.postedAt);
    from.setDate(from.getDate() - 3);
    const to = new Date(tx.postedAt);
    to.setDate(to.getDate() + 3);
    const kind = expectedReconcileKind(tx.amount);

    const candidates = kind === "customer"
      ? (await db
          .select({ id: invoicePayment.id, number: payment.number })
          .from(invoicePayment)
          .innerJoin(payment, eq(payment.id, invoicePayment.paymentId))
          .innerJoin(invoice, eq(invoice.id, invoicePayment.invoiceId))
          .where(and(eq(invoicePayment.companyId, companyId), eq(invoicePayment.amountApplied, amountAbs), gte(payment.postedAt, from), lte(payment.postedAt, to)))
        ).filter((candidate) => !usedInvoicePayments.has(candidate.id))
      : (await db
          .select({ id: supplierInvoicePayment.id, number: supplierPayment.number })
          .from(supplierInvoicePayment)
          .innerJoin(supplierPayment, eq(supplierPayment.id, supplierInvoicePayment.supplierPaymentId))
          .innerJoin(supplierInvoice, eq(supplierInvoice.id, supplierInvoicePayment.supplierInvoiceId))
          .where(and(eq(supplierInvoicePayment.companyId, companyId), eq(supplierInvoicePayment.amountApplied, amountAbs), gte(supplierPayment.postedAt, from), lte(supplierPayment.postedAt, to)))
        ).filter((candidate) => !usedSupplierPayments.has(candidate.id));

    const referenceMatches = candidates.filter((candidate) => {
      const reference = normalizeReference(candidate.number);
      return reference.length >= 4 && normalizedDescription.includes(reference);
    });
    const match = referenceMatches.length === 1 ? referenceMatches[0] : referenceMatches.length === 0 && candidates.length === 1 ? candidates[0] : null;
    if (!match) continue;

    try {
      await db.transaction((client) => reconcileBankTransaction(client, {
        companyId,
        tenantId: actor.tenantId,
        actorUserId: actor.actorUserId,
        transactionId: tx.id,
        kind,
        matchId: match.id,
      }));
      reconciled += 1;
      if (kind === "customer") usedInvoicePayments.add(match.id);
      else usedSupplierPayments.add(match.id);
    } catch (error) {
      if (!isAccountingRuleError(error)) throw error;
      skipped += 1;
    }
  }

  return { reconciled, skipped, totalPending: pending.length };
}
