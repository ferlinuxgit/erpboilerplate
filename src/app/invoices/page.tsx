import type { Metadata } from "next";
import Link from "next/link";
import { and, count, eq, not, sql } from "drizzle-orm";

import { customer, invoice, paymentMethod, paymentStatusEnum } from "@/db/schema";
import { InvoicesList } from "@/components/invoices/invoices-list";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { roleLabels, statusLabel } from "@/lib/status-labels";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { parseListParams, type RawSearchParams } from "@/lib/list-params";
import { canManageInvoices } from "@/lib/rbac";
import { todayDateInput } from "@/server/invoices/due-dates";
import {
  creditedByInvoiceSubquery,
  invoiceIsDraftSql,
  invoiceIsIssuedSql,
  invoiceLifecycleSql,
  netOutstandingSql,
  paidByInvoiceSubquery,
} from "@/server/invoices/sql";
import {
  countRows,
  listOrderBy,
  listWhere,
  paginate,
  toServerListState,
  unfilteredTotal,
  windowCount,
  windowTotals,
} from "@/server/lists/paginate";

export const metadata: Metadata = { title: "Facturas" };

const invoiceListConfig = {
  sortKeys: ["recent", "number", "customer", "issueDate", "dueDate", "total", "outstanding", "status"] as const,
  // Newest first: a just-created invoice is always on page 1.
  defaultSort: { key: "recent" as const, dir: "desc" as const },
  filters: { status: paymentStatusEnum.enumValues, due: ["overdue"], type: ["invoice", "credit_note", "draft"] },
};

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  await requireUserSession();
  const tenantContext = await requireContext("invoice.read");
  const companyId = tenantContext.company.id;
  const params = parseListParams(await searchParams, invoiceListConfig);

  // Payments and issued credit notes aggregated once per company (no per-invoice queries):
  // net outstanding = total + rectificativas − cobros, as in `getInvoiceBalance`.
  const paidByInvoice = paidByInvoiceSubquery(companyId);
  const creditedByInvoice = creditedByInvoiceSubquery(companyId);
  const outstanding = netOutstandingSql(paidByInvoice, creditedByInvoice);
  const isVoided = sql`(${invoice.paymentStatus} = 'VOID' or ${invoice.status} = 'VOID')`;
  // "Hoy" en la zona horaria de la empresa (España), no la del servidor.
  const startOfToday = new Date(`${todayDateInput(tenantContext.company.timezone || undefined)}T00:00:00.000Z`);
  const isOverdue = sql`(not ${isVoided} and ${outstanding} > 0 and ${invoice.dueDate} < ${startOfToday})`;

  const where = listWhere({
    base: [eq(invoice.companyId, companyId)],
    search: { q: params.q, columns: [invoice.number, customer.name, sql`${invoice.totalAmount}::text`] },
    dateRange: { column: invoice.issueDate, from: params.from, to: params.to },
    filters: [
      params.filters.status ? eq(invoice.paymentStatus, params.filters.status as (typeof paymentStatusEnum.enumValues)[number]) : undefined,
      params.filters.due === "overdue" ? isOverdue : undefined,
      params.filters.type === "draft" ? invoiceIsDraftSql : undefined,
      params.filters.type === "invoice" ? and(eq(invoice.invoiceType, "INVOICE"), not(invoiceIsDraftSql)) : undefined,
      params.filters.type === "credit_note" ? and(eq(invoice.invoiceType, "CREDIT_NOTE"), not(invoiceIsDraftSql)) : undefined,
    ],
  });
  const sortColumns = {
    recent: invoice.createdAt,
    number: invoice.number,
    customer: customer.name,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    total: invoice.totalAmount,
    outstanding,
    status: invoice.paymentStatus,
  };

  const [result, paymentMethods] = await Promise.all([
    paginate({
      page: params.page,
      pageSize: params.pageSize,
      fetchPage: (limit, offset) =>
        db
          .select({
            id: invoice.id,
            number: invoice.number,
            status: invoice.status,
            paymentStatus: invoice.paymentStatus,
            invoiceType: invoice.invoiceType,
            lifecycle: invoiceLifecycleSql,
            totalAmount: invoice.totalAmount,
            issueDate: invoice.issueDate,
            dueDate: invoice.dueDate,
            outstandingAmount: outstanding.mapWith(Number),
            isOverdue: sql<boolean>`coalesce(${isOverdue}, false)`,
            customerName: customer.name,
            total: windowCount(),
            // Totales del pie: solo facturas con validez fiscal (sin borradores ni anuladas); los borradores aparte.
            ...windowTotals({
              sumTotal: sql`case when ${invoiceIsIssuedSql} then ${invoice.totalAmount} else 0 end`,
              sumOutstanding: outstanding,
              sumDrafts: sql`case when ${invoiceIsDraftSql} and ${invoice.status} <> 'VOID' then ${invoice.totalAmount} else 0 end`,
              draftCount: sql`case when ${invoiceIsDraftSql} and ${invoice.status} <> 'VOID' then 1 else 0 end`,
            }),
          })
          .from(invoice)
          .innerJoin(customer, eq(invoice.customerId, customer.id))
          .leftJoin(paidByInvoice, eq(paidByInvoice.invoiceId, invoice.id))
          .leftJoin(creditedByInvoice, eq(creditedByInvoice.invoiceId, invoice.id))
          .where(where)
          .orderBy(...listOrderBy(sortColumns, params, invoice.id))
          .limit(limit)
          .offset(offset),
      countAll: () =>
        countRows(
          db
            .select({ value: count() })
            .from(invoice)
            .innerJoin(customer, eq(invoice.customerId, customer.id))
            .leftJoin(paidByInvoice, eq(paidByInvoice.invoiceId, invoice.id))
            .leftJoin(creditedByInvoice, eq(creditedByInvoice.invoiceId, invoice.id))
            .where(where),
        ),
    }),
    db
      .select({ id: paymentMethod.id, name: paymentMethod.name })
      .from(paymentMethod)
      .where(eq(paymentMethod.companyId, companyId))
      .orderBy(paymentMethod.name),
  ]);
  const recordCount = await unfilteredTotal(params, result.total, () =>
    countRows(db.select({ value: count() }).from(invoice).where(and(eq(invoice.companyId, companyId)))),
  );

  const canCreateInvoice = canManageInvoices(tenantContext.membership.role);
  const currencyCode = tenantContext.company.baseCurrencyCode;
  const firstRow = result.rows[0];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Facturas"
        title="Facturas"
        description={`Emisión y seguimiento de facturas de ${tenantContext.company.name}.`}
        meta={<StatusBadge tone="neutral">Rol: {statusLabel(roleLabels, tenantContext.membership.role)}</StatusBadge>}
        actions={
          <>
            <Link className={buttonVariants({ variant: "outline" })} href="/invoices/collections">
              Cobros pendientes
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/invoices/recurring">
              Recurrentes
            </Link>
            {canCreateInvoice ? (
              <Link className={buttonVariants()} href="/invoices/new">
                Nueva factura
              </Link>
            ) : null}
          </>
        }
      />

      <PageSection
        title="Facturas"
        description={
          (firstRow?.draftCount ?? 0) > 0
            ? `Emitidas, rectificativas y borradores. Los totales solo suman facturas emitidas; hay ${firstRow?.draftCount} ${firstRow?.draftCount === 1 ? "borrador" : "borradores"} por ${formatMoney(firstRow?.sumDrafts ?? 0, currencyCode)} sin emitir.`
            : "Emitidas y rectificativas. Abre una factura para ver sus datos, el PDF o registrar un cobro."
        }
      >
        <InvoicesList
          currencyCode={currencyCode}
          paymentMethods={paymentMethods}
          server={toServerListState(params, result, recordCount)}
          totals={{ totalAmount: firstRow?.sumTotal ?? 0, outstandingAmount: firstRow?.sumOutstanding ?? 0, draftAmount: firstRow?.sumDrafts ?? 0, draftCount: firstRow?.draftCount ?? 0 }}
          rows={result.rows.map((row) => {
            const outstandingAmount = Math.round(row.outstandingAmount * 100) / 100;
            return {
              id: row.id,
              number: row.number,
              status: row.paymentStatus,
              lifecycle: row.lifecycle,
              invoiceType: row.invoiceType === "CREDIT_NOTE" ? "CREDIT_NOTE" : "INVOICE",
              totalAmount: row.totalAmount,
              totalAmountLabel: formatMoney(row.totalAmount.toString(), currencyCode),
              outstandingAmount,
              outstandingAmountLabel: formatMoney(outstandingAmount, currencyCode),
              issueDate: row.issueDate,
              issueDateLabel: formatDate(row.issueDate),
              dueDate: row.dueDate,
              dueDateLabel: row.dueDate ? formatDate(row.dueDate) : null,
              isOverdue: Boolean(row.isOverdue),
              customerName: row.customerName,
            };
          })}
        />
      </PageSection>
    </PageShell>
  );
}
