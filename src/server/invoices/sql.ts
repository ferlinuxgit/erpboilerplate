import { and, eq, isNotNull, ne, not, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { invoice, invoicePayment } from "@/db/schema";
import { db } from "@/lib/db";
import { DRAFT_NUMBER_PREFIX } from "@/server/invoices/lifecycle";

/*
 * SQL counterparts of `invoiceLifecycle` / `getInvoiceBalance` for lists, dashboards and
 * reports, so aggregates follow exactly the same rules as the invoice detail without
 * per-row queries.
 */

const draftNumberPattern = `${DRAFT_NUMBER_PREFIX}%`;

/** Draft of the draft → issue cycle: provisional number and never issued (see `invoiceLifecycle`). */
export const invoiceIsDraftSql: SQL = sql`(${invoice.issuedAt} is null and ${invoice.number} like ${draftNumberPattern})`;

/** Voided (a voided draft, or a legacy voided invoice). */
export const invoiceIsVoidSql: SQL = sql`(${invoice.status} = 'VOID')`;

/**
 * Invoices that exist fiscally: issued (or legacy numbered) and not voided. Same rule as the
 * VAT models (`issuedInvoiceFiscalFilter`): credit notes are included with their (negative) sign.
 */
export const invoiceIsIssuedSql: SQL = and(ne(invoice.status, "VOID"), not(invoiceIsDraftSql)) as SQL;

/** SQL `lifecycle` column ("DRAFT" | "ISSUED" | "VOID"), same precedence as `invoiceLifecycle`. */
export const invoiceLifecycleSql = sql<"DRAFT" | "ISSUED" | "VOID">`case when ${invoiceIsVoidSql} then 'VOID' when ${invoiceIsDraftSql} then 'DRAFT' else 'ISSUED' end`;

/** Applied payments per invoice (one grouped subquery per company). */
export function paidByInvoiceSubquery(companyId: string, name = "paid_by_invoice") {
  return db
    .select({
      invoiceId: invoicePayment.invoiceId,
      paidAmount: sql<string>`coalesce(sum(${invoicePayment.amountApplied}), 0)`.as("paidAmount"),
    })
    .from(invoicePayment)
    .where(eq(invoicePayment.companyId, companyId))
    .groupBy(invoicePayment.invoiceId)
    .as(name);
}

/** Issued, non-voided credit notes per rectified invoice (negative sums), as in `getInvoiceBalance`. */
export function creditedByInvoiceSubquery(companyId: string, name = "credited_by_invoice") {
  const creditNote = alias(invoice, `${name}_note`);
  return db
    .select({
      invoiceId: sql<string>`${creditNote.rectifiedInvoiceId}`.as("creditedInvoiceId"),
      creditedAmount: sql<string>`coalesce(sum(${creditNote.totalAmount}), 0)`.as("creditedAmount"),
    })
    .from(creditNote)
    .where(and(
      eq(creditNote.companyId, companyId),
      eq(creditNote.invoiceType, "CREDIT_NOTE"),
      isNotNull(creditNote.issuedAt),
      ne(creditNote.status, "VOID"),
    ))
    .groupBy(creditNote.rectifiedInvoiceId)
    .as(name);
}

type PaidSubquery = ReturnType<typeof paidByInvoiceSubquery>;
type CreditedSubquery = ReturnType<typeof creditedByInvoiceSubquery>;

/**
 * Net outstanding of an invoice row: total + issued credit notes (negative) − payments, never
 * negative (`outstandingCents`). Drafts, voided invoices and credit notes owe nothing.
 * Needs `paid` and `credited` left-joined on `invoice.id`.
 */
export function netOutstandingSql(paid: PaidSubquery, credited: CreditedSubquery) {
  return sql<string>`case
    when ${invoiceIsVoidSql} or ${invoice.paymentStatus} = 'VOID' or ${invoiceIsDraftSql} or ${invoice.invoiceType} = 'CREDIT_NOTE' then 0
    else greatest(${invoice.totalAmount} + coalesce(${credited.creditedAmount}, 0) - coalesce(${paid.paidAmount}, 0), 0)
  end`;
}
