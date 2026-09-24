import { count, eq, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { goodsReceipt, partner, paymentStatusEnum, purchaseOrder, supplierInvoice, supplierInvoicePayment } from "@/db/schema";
import { db } from "@/lib/db";
import type { ListParams, ListParamsConfig } from "@/lib/list-params";
import {
  countRows,
  listOrderBy,
  listWhere,
  paginate,
  unfilteredTotal,
  windowCount,
  windowTotals,
} from "@/server/lists/paginate";

/**
 * Server-paginated supplier invoices (`/expenses`). Mirrors `listExpenseInvoices`
 * (service.ts) but computes paid/outstanding amounts and the displayed payment status in SQL.
 */

export const expenseInvoiceSortKeys = ["recent", "relation", "supplier", "issueDate", "dueDate", "status", "total", "outstanding"] as const;
export type ExpenseInvoiceSortKey = (typeof expenseInvoiceSortKeys)[number];

export const expenseInvoiceListConfig: ListParamsConfig<ExpenseInvoiceSortKey, "status"> = {
  sortKeys: expenseInvoiceSortKeys,
  // Newest first: a just-registered invoice is always on page 1, whatever its issue date.
  defaultSort: { key: "recent", dir: "desc" },
  filters: { status: paymentStatusEnum.enumValues },
};

function paidByInvoice(companyId: string) {
  return db
    .select({
      supplierInvoiceId: supplierInvoicePayment.supplierInvoiceId,
      paidAmount: sql<string>`coalesce(sum(${supplierInvoicePayment.amountApplied}), 0)`.as("paidAmount"),
    })
    .from(supplierInvoicePayment)
    .where(eq(supplierInvoicePayment.companyId, companyId))
    .groupBy(supplierInvoicePayment.supplierInvoiceId)
    .as("paid_by_supplier_invoice");
}

/** SQL versions of the amounts/status `listExpenseInvoices` derives in JS. */
function expenseExpressions(paid: ReturnType<typeof paidByInvoice>, now: Date) {
  const paidAmount = sql<string>`coalesce(${paid.paidAmount}, 0)`;
  const isVoid = sql`(${supplierInvoice.status} = 'VOID')`;
  const outstanding = sql<string>`case when ${isVoid} then 0 else greatest(${supplierInvoice.totalAmount} - ${paidAmount}, 0) end`;
  // Same rules as getPaymentStatus(): VOID, PAID, PARTIAL, OVERDUE, PENDING.
  const paymentStatus = sql<string>`case
    when ${isVoid} then 'VOID'
    when ${paidAmount} >= ${supplierInvoice.totalAmount} and ${supplierInvoice.totalAmount} > 0 then 'PAID'
    when ${paidAmount} > 0 then 'PARTIAL'
    when ${supplierInvoice.dueDate} is not null and ${supplierInvoice.dueDate} < ${now} then 'OVERDUE'
    else 'PENDING'
  end`;
  return { paidAmount, isVoid, outstanding, paymentStatus };
}

export async function listExpenseInvoicesPage(companyId: string, params: ListParams<ExpenseInvoiceSortKey, "status">) {
  const paid = paidByInvoice(companyId);
  const { paidAmount, outstanding, paymentStatus } = expenseExpressions(paid, new Date());

  const where = listWhere({
    base: [eq(supplierInvoice.companyId, companyId)],
    search: {
      q: params.q,
      columns: [supplierInvoice.number, supplierInvoice.supplierDocumentNumber, partner.name, purchaseOrder.number, goodsReceipt.number],
    },
    dateRange: { column: supplierInvoice.issueDate, from: params.from, to: params.to },
    filters: [params.filters.status ? sql`${paymentStatus} = ${params.filters.status}` : undefined],
  });
  const sortColumns: Record<ExpenseInvoiceSortKey, AnyColumn | SQL> = {
    recent: supplierInvoice.createdAt,
    relation: purchaseOrder.number,
    supplier: partner.name,
    issueDate: supplierInvoice.issueDate,
    dueDate: supplierInvoice.dueDate,
    status: paymentStatus,
    total: supplierInvoice.totalAmount,
    outstanding,
  };

  const result = await paginate({
    page: params.page,
    pageSize: params.pageSize,
    fetchPage: (limit, offset) =>
      db
        .select({
          id: supplierInvoice.id,
          number: supplierInvoice.number,
          supplierDocumentNumber: supplierInvoice.supplierDocumentNumber,
          supplierName: partner.name,
          purchaseOrderId: supplierInvoice.purchaseOrderId,
          purchaseOrderNumber: purchaseOrder.number,
          goodsReceiptId: supplierInvoice.goodsReceiptId,
          goodsReceiptNumber: goodsReceipt.number,
          issueDate: supplierInvoice.issueDate,
          dueDate: supplierInvoice.dueDate,
          status: supplierInvoice.status,
          paymentStatus,
          totalAmount: supplierInvoice.totalAmount,
          paidAmount: paidAmount.mapWith(Number),
          outstandingAmount: outstanding.mapWith(Number),
          total: windowCount(),
          ...windowTotals({ sumTotal: supplierInvoice.totalAmount, sumOutstanding: outstanding }),
        })
        .from(supplierInvoice)
        .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
        .leftJoin(purchaseOrder, eq(purchaseOrder.id, supplierInvoice.purchaseOrderId))
        .leftJoin(goodsReceipt, eq(goodsReceipt.id, supplierInvoice.goodsReceiptId))
        .leftJoin(paid, eq(paid.supplierInvoiceId, supplierInvoice.id))
        .where(where)
        .orderBy(...listOrderBy(sortColumns, params, supplierInvoice.id))
        .limit(limit)
        .offset(offset),
    countAll: () =>
      countRows(
        db
          .select({ value: count() })
          .from(supplierInvoice)
          .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
          .leftJoin(purchaseOrder, eq(purchaseOrder.id, supplierInvoice.purchaseOrderId))
          .leftJoin(goodsReceipt, eq(goodsReceipt.id, supplierInvoice.goodsReceiptId))
          .leftJoin(paid, eq(paid.supplierInvoiceId, supplierInvoice.id))
          .where(where),
      ),
  });

  const recordCount = await unfilteredTotal(params, result.total, () =>
    countRows(db.select({ value: count() }).from(supplierInvoice).where(eq(supplierInvoice.companyId, companyId))),
  );
  const firstRow = result.rows[0];

  return {
    ...result,
    unfilteredTotal: recordCount,
    totals: { totalAmount: firstRow?.sumTotal ?? 0, outstandingAmount: firstRow?.sumOutstanding ?? 0 },
    rows: result.rows.map((row) => ({
      id: row.id,
      number: row.number,
      supplierDocumentNumber: row.supplierDocumentNumber,
      supplierName: row.supplierName,
      purchaseOrderId: row.purchaseOrderId,
      purchaseOrderNumber: row.purchaseOrderNumber,
      goodsReceiptId: row.goodsReceiptId,
      goodsReceiptNumber: row.goodsReceiptNumber,
      issueDate: row.issueDate,
      dueDate: row.dueDate,
      status: row.status,
      paymentStatus: row.paymentStatus,
      totalAmount: row.totalAmount,
      paidAmount: row.paidAmount.toFixed(2),
      outstandingAmount: row.outstandingAmount.toFixed(2),
    })),
  };
}

/**
 * Metric cards of `/expenses` over every invoice of the company, with the same semantics as
 * `summarizeExpenses` (src/lib/expense-summary.ts): VOID invoices (by `status`) are only counted
 * in `voidCount`; pending = outstanding (total − applied payments, never negative) of the rest.
 */
export async function summarizeExpenseInvoices(companyId: string) {
  const paid = paidByInvoice(companyId);
  const { isVoid, outstanding } = expenseExpressions(paid, new Date());
  const [row] = await db
    .select({
      activeCount: sql<string>`count(*) filter (where not ${isVoid})`.mapWith(Number),
      voidCount: sql<string>`count(*) filter (where ${isVoid})`.mapWith(Number),
      totalAmount: sql<string>`coalesce(sum(${supplierInvoice.totalAmount}) filter (where not ${isVoid}), 0)`.mapWith(Number),
      pendingAmount: sql<string>`coalesce(sum(${outstanding}) filter (where not ${isVoid}), 0)`.mapWith(Number),
      inputTaxAmount: sql<string>`coalesce(sum(${supplierInvoice.taxAmount}) filter (where not ${isVoid}), 0)`.mapWith(Number),
    })
    .from(supplierInvoice)
    .leftJoin(paid, eq(paid.supplierInvoiceId, supplierInvoice.id))
    .where(eq(supplierInvoice.companyId, companyId));
  return {
    activeCount: row?.activeCount ?? 0,
    voidCount: row?.voidCount ?? 0,
    totalAmount: row?.totalAmount ?? 0,
    pendingAmount: row?.pendingAmount ?? 0,
    inputTaxAmount: row?.inputTaxAmount ?? 0,
  };
}
