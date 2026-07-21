import { and, eq, gte, lte } from "drizzle-orm";

import { bankAccount, bankTransaction, invoice, invoicePayment, payment, supplierInvoice, supplierInvoicePayment, supplierPayment } from "@/db/schema";
import { db } from "@/lib/db";
import { parseBankCsv } from "@/lib/bank-csv";
import { postBankTransaction } from "@/server/accounting/auto-post";
import { assertFiscalPeriodOpen } from "@/server/fiscal/locks";
import { createBankTransaction } from "@/server/treasury/service";

export async function importBankCsv(input: { companyId: string; tenantId: string; actorUserId: string; bankAccountId: string; content: string }) {
  const [ownedAccount] = await db
    .select({ id: bankAccount.id })
    .from(bankAccount)
    .where(and(eq(bankAccount.id, input.bankAccountId), eq(bankAccount.companyId, input.companyId)))
    .limit(1);
  if (!ownedAccount) throw new Error("Cuenta bancaria no encontrada.");

  const rows = parseBankCsv(input.content);
  if (rows.length === 0) return [];

  return db.transaction(async (tx) => {
    const created = [];
    for (const row of rows) {
      const amount = row.amount.toFixed(2);
      const [duplicate] = await tx
        .select({ id: bankTransaction.id })
        .from(bankTransaction)
        .where(and(
          eq(bankTransaction.bankAccountId, input.bankAccountId),
          eq(bankTransaction.postedAt, row.postedAt),
          eq(bankTransaction.amount, amount),
          eq(bankTransaction.description, row.description),
        ))
        .limit(1);
      if (duplicate) continue;
      await assertFiscalPeriodOpen(input.companyId, row.postedAt, tx);
      const transaction = await createBankTransaction(input.companyId, input.tenantId, input.actorUserId, {
        bankAccountId: input.bankAccountId,
        postedAt: row.postedAt,
        amount,
        description: row.description,
      }, tx);
      await postBankTransaction({
        tenantId: input.tenantId,
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        bankTransactionId: transaction.id,
        postedAt: row.postedAt,
        reference: `Movimiento bancario importado ${transaction.id}`,
        amount: row.amount,
        dbClient: tx,
      });
      created.push(transaction);
    }
    return created;
  });
}

export async function autoReconcileBankTransactions(companyId: string) {
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
  for (const tx of pending) {
    const amountAbs = Math.abs(Number(tx.amount));
    const normalizedDescription = normalizeReference(tx.description);
    const from = new Date(tx.postedAt);
    from.setDate(from.getDate() - 3);
    const to = new Date(tx.postedAt);
    to.setDate(to.getDate() + 3);

    if (Number(tx.amount) >= 0) {
      const candidates = (await db
        .select({ id: invoicePayment.id, number: payment.number, amount: invoicePayment.amountApplied, postedAt: payment.postedAt })
        .from(invoicePayment)
        .innerJoin(payment, eq(payment.id, invoicePayment.paymentId))
        .innerJoin(invoice, eq(invoice.id, invoicePayment.invoiceId))
        .where(
          and(
            eq(invoicePayment.companyId, companyId),
            eq(invoicePayment.amountApplied, amountAbs.toFixed(2)),
            gte(payment.postedAt, from),
            lte(payment.postedAt, to),
          ),
        )
      ).filter((candidate) => !usedInvoicePayments.has(candidate.id));
      const referenceMatches = candidates.filter((candidate) => {
        const reference = normalizeReference(candidate.number);
        return reference.length >= 4 && normalizedDescription.includes(reference);
      });
      const match = referenceMatches.length === 1 ? referenceMatches[0] : referenceMatches.length === 0 && candidates.length === 1 ? candidates[0] : null;

      if (match) {
        await db
          .update(bankTransaction)
          .set({
            reconciliationStatus: "RECONCILED",
            matchedInvoicePaymentId: match.id,
            reconciledAt: new Date(),
          })
          .where(eq(bankTransaction.id, tx.id));
        reconciled += 1;
        usedInvoicePayments.add(match.id);
        continue;
      }
    } else {
      const candidates = (await db
        .select({ id: supplierInvoicePayment.id, number: supplierPayment.number, amount: supplierInvoicePayment.amountApplied, postedAt: supplierPayment.postedAt })
        .from(supplierInvoicePayment)
        .innerJoin(supplierPayment, eq(supplierPayment.id, supplierInvoicePayment.supplierPaymentId))
        .innerJoin(supplierInvoice, eq(supplierInvoice.id, supplierInvoicePayment.supplierInvoiceId))
        .where(
          and(
            eq(supplierInvoicePayment.companyId, companyId),
            eq(supplierInvoicePayment.amountApplied, amountAbs.toFixed(2)),
            gte(supplierPayment.postedAt, from),
            lte(supplierPayment.postedAt, to),
          ),
        )
      ).filter((candidate) => !usedSupplierPayments.has(candidate.id));
      const referenceMatches = candidates.filter((candidate) => {
        const reference = normalizeReference(candidate.number);
        return reference.length >= 4 && normalizedDescription.includes(reference);
      });
      const match = referenceMatches.length === 1 ? referenceMatches[0] : referenceMatches.length === 0 && candidates.length === 1 ? candidates[0] : null;

      if (match) {
        await db
          .update(bankTransaction)
          .set({
            reconciliationStatus: "RECONCILED",
            matchedSupplierPaymentId: match.id,
            reconciledAt: new Date(),
          })
          .where(eq(bankTransaction.id, tx.id));
        reconciled += 1;
        usedSupplierPayments.add(match.id);
        continue;
      }
    }

  }

  return { reconciled, totalPending: pending.length };
}
