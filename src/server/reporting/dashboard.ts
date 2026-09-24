import { and, asc, count, desc, eq, gte, inArray, lt, lte, notInArray, or, sql } from "drizzle-orm";

import {
  accountChart,
  bankAccount,
  bankTransaction,
  companySettings,
  customer,
  deliveryNote,
  fiscalReport,
  invoice,
  invoiceLine,
  invoiceLineTax,
  invoicePayment,
  item,
  journalEntry,
  journalLine,
  partner,
  salesOrder,
  salesQuote,
  stockLocation,
  supplierInvoice,
  supplierInvoiceLine,
  supplierInvoicePayment,
} from "@/db/schema";
import { db } from "@/lib/db";
import type { DashboardCockpitSummary } from "@/lib/dashboard-cockpit";
import {
  cumulativeSeries,
  currentQuarter,
  daysPastDue,
  fillMonthlySeries,
  financePeriodRanges,
  lastMonths,
  mapAgingRows,
  percentChange,
  toAmount,
  upcomingFiscalDeadlines,
  type FinancePeriod,
} from "@/server/reporting/dashboard-model";

/**
 * `GROUP BY 1`: grouping by an expression that embeds bound parameters (dates) fails in
 * Postgres because the SELECT and GROUP BY copies get different placeholders.
 */
const groupByFirstColumn = sql`1`;
import { creditedByInvoiceSubquery, invoiceIsIssuedSql, netOutstandingSql, paidByInvoiceSubquery } from "@/server/invoices/sql";

/*
 * Dashboard and reporting aggregates. Every figure is computed in Postgres with
 * count/sum/group by over indexed columns (companyId + date/status); no query loads
 * a company's full invoice, payment or ledger history into memory.
 */

const closedInvoiceStatuses = ["PAID", "VOID"] as const;
const inactiveSalesStatuses = ["VOID", "PAID", "INVOICED"] as const;

/** Net line amount (base imponible) of an issued invoice line. */
const salesLineBase = sql`round(${invoiceLine.quantity} * ${invoiceLine.unitPrice} * (1 - ${invoiceLine.discountPct} / 100), 2)`;

/**
 * Issued invoices that count as sales (same rule as the VAT models): no voided invoices and no
 * drafts (provisional BORRADOR-… number). Credit notes count with their negative sign, and a
 * fully rectified invoice (payment status VOID) still counts: its credit note offsets it.
 */
function issuedInvoiceIn(companyId: string, start: Date, end: Date) {
  return and(eq(invoice.companyId, companyId), invoiceIsIssuedSql, gte(invoice.issueDate, start), lt(invoice.issueDate, end));
}

/** Received invoices that count as expenses (no VOID or DRAFT, as in the VAT models). */
function receivedInvoiceIn(companyId: string, start: Date, end: Date) {
  return and(
    eq(supplierInvoice.companyId, companyId),
    notInArray(supplierInvoice.status, ["VOID", "DRAFT"]),
    gte(supplierInvoice.issueDate, start),
    lt(supplierInvoice.issueDate, end),
  );
}

const monthOf = (column: typeof invoice.issueDate | typeof supplierInvoice.issueDate | typeof journalEntry.postedAt) =>
  sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM')`;

function number(value: string | number | null | undefined) {
  return toAmount(value);
}

/** Counts behind the operational cockpit (cards, alerts and guided steps). */
export async function loadCockpitSummary(companyId: string, now = new Date()): Promise<DashboardCockpitSummary> {
  const paidByInvoice = paidByInvoiceSubquery(companyId);
  const creditedByInvoice = creditedByInvoiceSubquery(companyId);
  const outstanding = netOutstandingSql(paidByInvoice, creditedByInvoice);
  // Open receivable: issued invoice (not draft/void/credit note) with net outstanding left.
  const isUnpaid = sql`(${notInArray(invoice.paymentStatus, [...closedInvoiceStatuses])} and ${outstanding} > 0)`;
  const stockByItem = db
    .select({ itemId: stockLocation.itemId, quantity: sql<string>`sum(${stockLocation.currentQuantity})`.as("quantity") })
    .from(stockLocation)
    .where(eq(stockLocation.companyId, companyId))
    .groupBy(stockLocation.itemId)
    .as("stock_by_item");

  const [[customers], [quotes], [orders], [notes], [invoices], [payments], [items]] = await Promise.all([
    db.select({ active: count() }).from(customer).where(and(eq(customer.companyId, companyId), eq(customer.status, "ACTIVE"))),
    db.select({ open: count() }).from(salesQuote).where(and(eq(salesQuote.companyId, companyId), notInArray(salesQuote.status, [...inactiveSalesStatuses]))),
    db.select({ open: count() }).from(salesOrder).where(and(eq(salesOrder.companyId, companyId), notInArray(salesOrder.status, [...inactiveSalesStatuses]))),
    db.select({ open: count() }).from(deliveryNote).where(and(eq(deliveryNote.companyId, companyId), notInArray(deliveryNote.status, [...inactiveSalesStatuses]))),
    db
      .select({
        total: count(),
        unpaid: sql<number>`count(*) filter (where ${isUnpaid})`.mapWith(Number),
        overdue: sql<number>`count(*) filter (where ${isUnpaid} and (${invoice.paymentStatus} = 'OVERDUE' or ${invoice.dueDate} < ${now}))`.mapWith(Number),
        receivables: sql<string>`coalesce(sum(${outstanding}) filter (where ${isUnpaid}), 0)`,
        partlyOrFullyPaid: sql<number>`count(*) filter (where ${invoice.paymentStatus} in ('PARTIAL', 'PAID') and ${invoice.invoiceType} = 'INVOICE')`.mapWith(Number),
      })
      .from(invoice)
      .leftJoin(paidByInvoice, eq(paidByInvoice.invoiceId, invoice.id))
      .leftJoin(creditedByInvoice, eq(creditedByInvoice.invoiceId, invoice.id))
      .where(eq(invoice.companyId, companyId)),
    db.select({ total: count() }).from(invoicePayment).where(eq(invoicePayment.companyId, companyId)),
    db
      .select({
        total: count(),
        lowStock: sql<number>`count(*) filter (where not ${item.isService} and ${item.minimumStock} > 0 and coalesce(${stockByItem.quantity}, 0) <= ${item.minimumStock})`.mapWith(Number),
      })
      .from(item)
      .leftJoin(stockByItem, eq(stockByItem.itemId, item.id))
      .where(eq(item.companyId, companyId)),
  ]);

  return {
    activeCustomers: Number(customers?.active ?? 0),
    salesInProgress: Number(quotes?.open ?? 0) + Number(orders?.open ?? 0) + Number(notes?.open ?? 0),
    invoiceCount: Number(invoices?.total ?? 0),
    unpaidInvoices: Number(invoices?.unpaid ?? 0),
    overdueInvoices: Number(invoices?.overdue ?? 0),
    receivablesAmount: number(invoices?.receivables),
    lowStockAlerts: Number(items?.lowStock ?? 0),
    hasRecordedPayment: Number(invoices?.partlyOrFullyPaid ?? 0) > 0 || Number(payments?.total ?? 0) > 0,
    inventoryItemsCount: Number(items?.total ?? 0),
  };
}

export type DashboardFinance = Awaited<ReturnType<typeof loadDashboardFinance>>;

/** Sales and expenses (net of VAT) between two dates. */
async function salesAndExpenses(companyId: string, ranges: ReturnType<typeof financePeriodRanges>) {
  const inCurrent = (column: typeof invoice.issueDate | typeof supplierInvoice.issueDate) =>
    sql`${column} >= ${ranges.current.start} and ${column} < ${ranges.current.end}`;
  const inPrevious = (column: typeof invoice.issueDate | typeof supplierInvoice.issueDate) =>
    sql`${column} >= ${ranges.previous.start} and ${column} < ${ranges.previous.end}`;
  const [[sales], [expenses]] = await Promise.all([
    db
      .select({
        current: sql<string>`coalesce(sum(${salesLineBase}) filter (where ${inCurrent(invoice.issueDate)}), 0)`,
        previous: sql<string>`coalesce(sum(${salesLineBase}) filter (where ${inPrevious(invoice.issueDate)}), 0)`,
        invoices: sql<number>`count(distinct ${invoice.id}) filter (where ${inCurrent(invoice.issueDate)} and ${invoice.invoiceType} = 'INVOICE')`.mapWith(Number),
      })
      .from(invoice)
      .innerJoin(invoiceLine, eq(invoiceLine.invoiceId, invoice.id))
      .where(issuedInvoiceIn(companyId, ranges.previous.start, ranges.current.end)),
    db
      .select({
        current: sql<string>`coalesce(sum(${supplierInvoice.subtotalAmount}) filter (where ${inCurrent(supplierInvoice.issueDate)}), 0)`,
        previous: sql<string>`coalesce(sum(${supplierInvoice.subtotalAmount}) filter (where ${inPrevious(supplierInvoice.issueDate)}), 0)`,
      })
      .from(supplierInvoice)
      .where(receivedInvoiceIn(companyId, ranges.previous.start, ranges.current.end)),
  ]);
  return {
    salesCurrent: number(sales?.current),
    salesPrevious: number(sales?.previous),
    invoicesCurrent: Number(sales?.invoices ?? 0),
    expensesCurrent: number(expenses?.current),
    expensesPrevious: number(expenses?.previous),
  };
}

/**
 * Estimated VAT of the calendar quarter: output VAT of issued invoices (credit notes subtract,
 * drafts excluded) − deductible input VAT.
 */
async function quarterVatEstimate(companyId: string, now: Date) {
  const quarter = currentQuarter(now);
  const hasTaxRows = sql`exists (select 1 from ${invoiceLineTax} where ${invoiceLineTax.invoiceLineId} = ${invoiceLine.id})`;
  const vatFromTaxRows = sql`(select coalesce(sum(${invoiceLineTax.amount}), 0) from ${invoiceLineTax} where ${invoiceLineTax.invoiceLineId} = ${invoiceLine.id} and ${invoiceLineTax.kind} = 'VAT' and ${invoiceLineTax.operation} = 'ADD')`;
  const [[output], [input]] = await Promise.all([
    db
      .select({
        vat: sql<string>`coalesce(sum(case when ${hasTaxRows} then ${vatFromTaxRows} else round(${salesLineBase} * ${invoiceLine.taxRate} / 100, 2) end), 0)`,
      })
      .from(invoice)
      .innerJoin(invoiceLine, eq(invoiceLine.invoiceId, invoice.id))
      .where(issuedInvoiceIn(companyId, quarter.start, quarter.end)),
    db
      .select({ vat: sql<string>`coalesce(sum(round(${supplierInvoiceLine.taxAmount} * ${supplierInvoiceLine.taxDeductiblePct} / 100, 2)), 0)` })
      .from(supplierInvoice)
      .innerJoin(supplierInvoiceLine, eq(supplierInvoiceLine.supplierInvoiceId, supplierInvoice.id))
      .where(receivedInvoiceIn(companyId, quarter.start, quarter.end)),
  ]);
  const outputVat = number(output?.vat);
  const inputVat = number(input?.vat);
  return { label: quarter.label, outputVat, inputVat, result: Math.round((outputVat - inputVat) * 100) / 100 };
}

/**
 * Receivables, aging and overdue invoices on the net outstanding (total + issued credit notes −
 * payments). Drafts, voided invoices and credit notes have no outstanding, so they never appear.
 */
async function receivables(companyId: string, now: Date) {
  const paidByInvoice = paidByInvoiceSubquery(companyId);
  const creditedByInvoice = creditedByInvoiceSubquery(companyId);
  const outstanding = netOutstandingSql(paidByInvoice, creditedByInvoice);
  const daysOverdue = sql`(${now.toISOString().slice(0, 10)}::date - (${invoice.dueDate} at time zone 'UTC')::date)`;
  const bucket = sql<string>`case
    when ${invoice.dueDate} is null or ${daysOverdue} <= 0 then 'current'
    when ${daysOverdue} <= 30 then 'd0_30'
    when ${daysOverdue} <= 60 then 'd31_60'
    when ${daysOverdue} <= 90 then 'd61_90'
    else 'd90_plus' end`;
  const open = and(
    eq(invoice.companyId, companyId),
    notInArray(invoice.paymentStatus, [...closedInvoiceStatuses]),
    invoiceIsIssuedSql,
    eq(invoice.invoiceType, "INVOICE"),
    sql`${outstanding} > 0`,
  );
  const overdue = and(open, lt(invoice.dueDate, now));

  const [agingRows, oldest, [overdueTotals]] = await Promise.all([
    db
      .select({ bucket, amount: sql<string>`sum(${outstanding})`, count: count() })
      .from(invoice)
      .leftJoin(paidByInvoice, eq(paidByInvoice.invoiceId, invoice.id))
      .leftJoin(creditedByInvoice, eq(creditedByInvoice.invoiceId, invoice.id))
      .where(open)
      // Group by position: the bucket expression carries bound date parameters, and Postgres
      // treats `$1` in SELECT and `$17` in GROUP BY as different expressions.
      .groupBy(groupByFirstColumn),
    db
      .select({ id: invoice.id, number: invoice.number, customerName: customer.name, dueDate: invoice.dueDate, outstanding })
      .from(invoice)
      .innerJoin(customer, eq(customer.id, invoice.customerId))
      .leftJoin(paidByInvoice, eq(paidByInvoice.invoiceId, invoice.id))
      .leftJoin(creditedByInvoice, eq(creditedByInvoice.invoiceId, invoice.id))
      .where(overdue)
      .orderBy(asc(invoice.dueDate), desc(outstanding))
      .limit(5),
    db
      .select({ count: count(), amount: sql<string>`coalesce(sum(${outstanding}), 0)` })
      .from(invoice)
      .leftJoin(paidByInvoice, eq(paidByInvoice.invoiceId, invoice.id))
      .leftJoin(creditedByInvoice, eq(creditedByInvoice.invoiceId, invoice.id))
      .where(overdue),
  ]);

  return {
    aging: mapAgingRows(agingRows),
    overdueInvoices: oldest.map((row) => ({
      id: row.id,
      number: row.number,
      customerName: row.customerName,
      dueDate: row.dueDate,
      daysOverdue: daysPastDue(row.dueDate, now),
      amount: number(row.outstanding),
    })),
    overdueCount: Number(overdueTotals?.count ?? 0),
    overdueAmount: number(overdueTotals?.amount),
  };
}

async function payables(companyId: string, now: Date) {
  const paidBySupplierInvoice = db
    .select({ supplierInvoiceId: supplierInvoicePayment.supplierInvoiceId, paid: sql<string>`sum(${supplierInvoicePayment.amountApplied})`.as("paid") })
    .from(supplierInvoicePayment)
    .where(eq(supplierInvoicePayment.companyId, companyId))
    .groupBy(supplierInvoicePayment.supplierInvoiceId)
    .as("paid_by_supplier_invoice");
  const outstanding = sql<string>`greatest(${supplierInvoice.totalAmount} - coalesce(${paidBySupplierInvoice.paid}, 0), 0)`;
  const open = and(
    eq(supplierInvoice.companyId, companyId),
    notInArray(supplierInvoice.status, ["VOID", "DRAFT"]),
    notInArray(supplierInvoice.paymentStatus, [...closedInvoiceStatuses]),
    sql`${outstanding} > 0`,
  );
  const weekEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 8));
  const dueSoon = and(open, lt(supplierInvoice.dueDate, weekEnd));

  const [[totals], dueRows] = await Promise.all([
    db
      .select({
        count: count(),
        amount: sql<string>`coalesce(sum(${outstanding}), 0)`,
        dueSoonCount: sql<number>`count(*) filter (where ${supplierInvoice.dueDate} < ${weekEnd})`.mapWith(Number),
        dueSoonAmount: sql<string>`coalesce(sum(${outstanding}) filter (where ${supplierInvoice.dueDate} < ${weekEnd}), 0)`,
        overdueAmount: sql<string>`coalesce(sum(${outstanding}) filter (where ${supplierInvoice.dueDate} < ${now}), 0)`,
      })
      .from(supplierInvoice)
      .leftJoin(paidBySupplierInvoice, eq(paidBySupplierInvoice.supplierInvoiceId, supplierInvoice.id))
      .where(open),
    db
      .select({
        id: supplierInvoice.id,
        number: supplierInvoice.number,
        supplierDocumentNumber: supplierInvoice.supplierDocumentNumber,
        supplierName: partner.name,
        dueDate: supplierInvoice.dueDate,
        outstanding,
      })
      .from(supplierInvoice)
      .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
      .leftJoin(paidBySupplierInvoice, eq(paidBySupplierInvoice.supplierInvoiceId, supplierInvoice.id))
      .where(dueSoon)
      .orderBy(asc(supplierInvoice.dueDate))
      .limit(5),
  ]);

  return {
    count: Number(totals?.count ?? 0),
    amount: number(totals?.amount),
    overdueAmount: number(totals?.overdueAmount),
    dueSoonCount: Number(totals?.dueSoonCount ?? 0),
    dueSoonAmount: number(totals?.dueSoonAmount),
    dueSoon: dueRows.map((row) => ({
      id: row.id,
      number: row.supplierDocumentNumber || row.number,
      supplierName: row.supplierName,
      dueDate: row.dueDate,
      daysOverdue: daysPastDue(row.dueDate, now),
      amount: number(row.outstanding),
    })),
  };
}

/**
 * Ledger balance of the bank accounts (accounts linked to each bank account plus the
 * company's default bank account, 572 unless configured), with its monthly evolution.
 */
async function bankBalances(companyId: string, months: ReturnType<typeof lastMonths>) {
  const windowStart = months[0].start;
  const defaultBankCode = sql`coalesce((select ${companySettings.defaultBankAccountCode} from ${companySettings} where ${companySettings.companyId} = ${companyId} limit 1), '572')`;
  const ledgerAccounts = db
    .select({ id: accountChart.id })
    .from(accountChart)
    .where(and(
      eq(accountChart.companyId, companyId),
      or(
        inArray(accountChart.id, db.select({ id: sql`${bankAccount.accountId}` }).from(bankAccount).where(and(eq(bankAccount.companyId, companyId), sql`${bankAccount.accountId} is not null`))),
        sql`${accountChart.code} = ${defaultBankCode}`,
      ),
    ));
  const monthKey = sql<string>`case when ${journalEntry.postedAt} < ${windowStart} then 'opening' else ${monthOf(journalEntry.postedAt)} end`;
  const rows = await db
    .select({ month: monthKey, value: sql<string>`sum(${journalLine.debit} - ${journalLine.credit})` })
    .from(journalLine)
    .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
    .where(and(eq(journalEntry.companyId, companyId), inArray(journalLine.accountId, ledgerAccounts)))
    .groupBy(groupByFirstColumn);

  const opening = number(rows.find((row) => row.month === "opening")?.value);
  const monthly = fillMonthlySeries(months, rows.filter((row) => row.month !== "opening"));
  const balance = Math.round(rows.reduce((sum, row) => sum + number(row.value) * 100, 0)) / 100;
  return { balance, series: cumulativeSeries(opening, monthly), hasMovements: rows.length > 0 };
}

async function monthlySalesAndExpenses(companyId: string, months: ReturnType<typeof lastMonths>, now: Date) {
  const start = months[0].start;
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const salesMonth = monthOf(invoice.issueDate);
  const expenseMonth = monthOf(supplierInvoice.issueDate);
  const [salesRows, expenseRows] = await Promise.all([
    db
      .select({ month: salesMonth, value: sql<string>`sum(${salesLineBase})` })
      .from(invoice)
      .innerJoin(invoiceLine, eq(invoiceLine.invoiceId, invoice.id))
      .where(issuedInvoiceIn(companyId, start, end))
      .groupBy(groupByFirstColumn),
    db
      .select({ month: expenseMonth, value: sql<string>`sum(${supplierInvoice.subtotalAmount})` })
      .from(supplierInvoice)
      .where(receivedInvoiceIn(companyId, start, end))
      .groupBy(groupByFirstColumn),
  ]);
  return { sales: fillMonthlySeries(months, salesRows), expenses: fillMonthlySeries(months, expenseRows) };
}

async function pendingBankMovements(companyId: string) {
  const [row] = await db
    .select({ count: count() })
    .from(bankTransaction)
    .innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.bankAccountId))
    .where(and(eq(bankAccount.companyId, companyId), eq(bankTransaction.reconciliationStatus, "PENDING")));
  return Number(row?.count ?? 0);
}

/** Cheap existence checks: the financial section only shows once there is something to show. */
async function financialActivity(companyId: string) {
  const [[invoices], [expenses], [movements]] = await Promise.all([
    db.select({ id: invoice.id }).from(invoice).where(eq(invoice.companyId, companyId)).limit(1),
    db.select({ id: supplierInvoice.id }).from(supplierInvoice).where(eq(supplierInvoice.companyId, companyId)).limit(1),
    db
      .select({ id: bankTransaction.id })
      .from(bankTransaction)
      .innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.bankAccountId))
      .where(eq(bankAccount.companyId, companyId))
      .limit(1),
  ]);
  return Boolean(invoices || expenses || movements);
}

export async function loadDashboardFinance(companyId: string, options: { period: FinancePeriod; now?: Date; countryCode?: string }) {
  const now = options.now ?? new Date();
  const ranges = financePeriodRanges(options.period, now);
  const months = lastMonths(now, 12);

  const [hasData, totals, vat, receivable, payable, bank, monthly, unreconciled, reports] = await Promise.all([
    financialActivity(companyId),
    salesAndExpenses(companyId, ranges),
    quarterVatEstimate(companyId, now),
    receivables(companyId, now),
    payables(companyId, now),
    bankBalances(companyId, months),
    monthlySalesAndExpenses(companyId, months, now),
    pendingBankMovements(companyId),
    (options.countryCode ?? "ES") === "ES"
      ? db
          .select({ code: fiscalReport.code, period: fiscalReport.period, status: fiscalReport.status })
          .from(fiscalReport)
          .where(and(eq(fiscalReport.companyId, companyId), inArray(fiscalReport.code, ["303", "390", "347"]), gte(fiscalReport.createdAt, new Date(Date.UTC(now.getUTCFullYear() - 2, 0, 1)))))
      : Promise.resolve(null),
  ]);

  const grossMargin = Math.round((totals.salesCurrent - totals.expensesCurrent) * 100) / 100;
  return {
    hasData,
    period: options.period,
    ranges,
    sales: {
      current: totals.salesCurrent,
      previous: totals.salesPrevious,
      change: percentChange(totals.salesCurrent, totals.salesPrevious),
      invoices: totals.invoicesCurrent,
    },
    expenses: { current: totals.expensesCurrent, previous: totals.expensesPrevious },
    grossMargin: {
      amount: grossMargin,
      pct: totals.salesCurrent > 0 ? Math.round((grossMargin / totals.salesCurrent) * 1000) / 10 : null,
    },
    receivables: receivable,
    payables: payable,
    bank,
    vat,
    months: months.map((month) => ({ key: month.key, label: month.label, longLabel: month.longLabel })),
    monthly,
    unreconciledMovements: unreconciled,
    fiscalDeadlines: reports ? upcomingFiscalDeadlines({ now, reports }) : [],
  };
}

/** Upcoming supplier due dates in `[from, to]` (used by reporting exports). */
export async function supplierDueBetween(companyId: string, from: Date, to: Date) {
  const [row] = await db
    .select({ count: count(), amount: sql<string>`coalesce(sum(${supplierInvoice.totalAmount}), 0)` })
    .from(supplierInvoice)
    .where(and(eq(supplierInvoice.companyId, companyId), gte(supplierInvoice.dueDate, from), lte(supplierInvoice.dueDate, to)));
  return { count: Number(row?.count ?? 0), amount: number(row?.amount) };
}
