import { and, eq, gte, ilike, lte } from "drizzle-orm";

import { bankAccount, bankTransaction, invoice, invoicePayment, payment, supplierInvoice, supplierInvoicePayment, supplierPayment } from "@/db/schema";
import { db } from "@/lib/db";

type CsvRow = {
  postedAt: Date;
  amount: number;
  description: string;
};

export function parseBankCsv(content: string): CsvRow[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length <= 1) return [];

  const rows: CsvRow[] = [];
  for (const line of lines.slice(1)) {
    const [postedAtRaw, amountRaw, descriptionRaw] = line.split(";");
    if (!postedAtRaw || !amountRaw || !descriptionRaw) continue;
    const amount = Number(amountRaw.replace(",", "."));
    if (Number.isNaN(amount)) continue;
    const postedAt = new Date(postedAtRaw);
    if (Number.isNaN(postedAt.getTime())) continue;
    rows.push({ postedAt, amount, description: descriptionRaw.trim() });
  }
  return rows;
}

export async function importBankCsv(companyId: string, bankAccountId: string, content: string) {
  const [ownedAccount] = await db
    .select({ id: bankAccount.id })
    .from(bankAccount)
    .where(and(eq(bankAccount.id, bankAccountId), eq(bankAccount.companyId, companyId)))
    .limit(1);
  if (!ownedAccount) throw new Error("Cuenta bancaria no encontrada.");

  const rows = parseBankCsv(content);
  if (rows.length === 0) return [];

  return db
    .insert(bankTransaction)
    .values(rows.map((row) => ({ bankAccountId, postedAt: row.postedAt, amount: row.amount.toFixed(2), description: row.description })))
    .returning();
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
