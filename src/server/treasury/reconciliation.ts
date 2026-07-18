import { and, eq, gte, ilike, lte } from "drizzle-orm";

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
  const pending = await db
    .select({
      id: bankTransaction.id,
      amount: bankTransaction.amount,
      description: bankTransaction.description,
      postedAt: bankTransaction.postedAt,
    })
    .from(bankTransaction)
    .innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.bankAccountId))
    .where(and(eq(bankAccount.companyId, companyId), eq(bankTransaction.reconciliationStatus, "PENDING")));

  let reconciled = 0;
  for (const tx of pending) {
    const amountAbs = Math.abs(Number(tx.amount));
    const normalizedDescription = tx.description.trim().toLowerCase();
    const from = new Date(tx.postedAt);
    from.setDate(from.getDate() - 3);
    const to = new Date(tx.postedAt);
    to.setDate(to.getDate() + 3);

    if (Number(tx.amount) >= 0) {
      const byReference = await db
        .select({ id: invoicePayment.id })
        .from(invoicePayment)
        .innerJoin(payment, eq(payment.id, invoicePayment.paymentId))
        .innerJoin(invoice, eq(invoice.id, invoicePayment.invoiceId))
        .where(and(eq(invoicePayment.companyId, companyId), ilike(invoice.number, `%${normalizedDescription}%`)))
        .limit(1);
      if (byReference[0]) {
        await db
          .update(bankTransaction)
          .set({
            reconciliationStatus: "RECONCILED",
            matchedInvoicePaymentId: byReference[0].id,
            reconciledAt: new Date(),
          })
          .where(eq(bankTransaction.id, tx.id));
        reconciled += 1;
        continue;
      }

      const [match] = await db
        .select({ id: invoicePayment.id })
        .from(invoicePayment)
        .innerJoin(payment, eq(payment.id, invoicePayment.paymentId))
        .where(
          and(
            eq(invoicePayment.companyId, companyId),
            eq(invoicePayment.amountApplied, amountAbs.toFixed(2)),
            gte(payment.postedAt, from),
            lte(payment.postedAt, to),
          ),
        )
        .limit(1);

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
        continue;
      }
    } else {
      const byReference = await db
        .select({ id: supplierInvoicePayment.id })
        .from(supplierInvoicePayment)
        .innerJoin(supplierPayment, eq(supplierPayment.id, supplierInvoicePayment.supplierPaymentId))
        .innerJoin(supplierInvoice, eq(supplierInvoice.id, supplierInvoicePayment.supplierInvoiceId))
        .where(and(eq(supplierInvoicePayment.companyId, companyId), ilike(supplierInvoice.number, `%${normalizedDescription}%`)))
        .limit(1);
      if (byReference[0]) {
        await db
          .update(bankTransaction)
          .set({
            reconciliationStatus: "RECONCILED",
            matchedSupplierPaymentId: byReference[0].id,
            reconciledAt: new Date(),
          })
          .where(eq(bankTransaction.id, tx.id));
        reconciled += 1;
        continue;
      }

      const [match] = await db
        .select({ id: supplierInvoicePayment.id })
        .from(supplierInvoicePayment)
        .innerJoin(supplierPayment, eq(supplierPayment.id, supplierInvoicePayment.supplierPaymentId))
        .where(
          and(
            eq(supplierInvoicePayment.companyId, companyId),
            eq(supplierInvoicePayment.amountApplied, amountAbs.toFixed(2)),
            gte(supplierPayment.postedAt, from),
            lte(supplierPayment.postedAt, to),
          ),
        )
        .limit(1);

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
        continue;
      }
    }

  }

  return { reconciled, totalPending: pending.length };
}
