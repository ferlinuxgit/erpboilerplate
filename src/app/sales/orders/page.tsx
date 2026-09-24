import { count, eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";

import { SalesDocumentsList } from "@/components/sales/sales-documents-list";
import { buttonVariants } from "@/components/ui/button";
import { MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { customer, salesDocumentStatusEnum, salesOrder, salesQuote } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { parseListParams, type RawSearchParams } from "@/lib/list-params";
import { can } from "@/lib/rbac";
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

export const metadata: Metadata = { title: "Pedidos de venta" };

const orderListConfig = {
  sortKeys: ["recent", "number", "date", "origin", "total", "status"] as const,
  // Newest first: a just-created order is always on page 1.
  defaultSort: { key: "recent" as const, dir: "desc" as const },
  filters: { status: salesDocumentStatusEnum.enumValues },
};

type SalesDocumentStatus = (typeof salesDocumentStatusEnum.enumValues)[number];

export default async function SalesOrdersPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireContext("invoice.read");
  const companyId = ctx.company.id;
  const params = parseListParams(await searchParams, orderListConfig);

  const where = listWhere({
    base: [eq(salesOrder.companyId, companyId)],
    search: {
      q: params.q,
      columns: [salesOrder.number, customer.name, salesQuote.number, sql`${salesOrder.totalAmount}::text`],
    },
    dateRange: { column: salesOrder.issueDate, from: params.from, to: params.to },
    filters: [params.filters.status ? eq(salesOrder.status, params.filters.status as SalesDocumentStatus) : undefined],
  });
  const sortColumns = {
    recent: salesOrder.createdAt,
    number: salesOrder.number,
    date: salesOrder.issueDate,
    origin: salesQuote.number,
    total: salesOrder.totalAmount,
    status: salesOrder.status,
  };

  const [result, [metrics]] = await Promise.all([
    paginate({
      page: params.page,
      pageSize: params.pageSize,
      fetchPage: (limit, offset) =>
        db
          .select({
            id: salesOrder.id,
            number: salesOrder.number,
            customerName: customer.name,
            date: salesOrder.issueDate,
            totalAmount: salesOrder.totalAmount,
            status: salesOrder.status,
            quoteNumber: salesQuote.number,
            total: windowCount(),
            ...windowTotals({ sumTotal: salesOrder.totalAmount }),
          })
          .from(salesOrder)
          .innerJoin(customer, eq(customer.id, salesOrder.customerId))
          .leftJoin(salesQuote, eq(salesQuote.id, salesOrder.salesQuoteId))
          .where(where)
          .orderBy(...listOrderBy(sortColumns, params, salesOrder.id))
          .limit(limit)
          .offset(offset),
      countAll: () =>
        countRows(
          db
            .select({ value: count() })
            .from(salesOrder)
            .innerJoin(customer, eq(customer.id, salesOrder.customerId))
            .leftJoin(salesQuote, eq(salesQuote.id, salesOrder.salesQuoteId))
            .where(where),
        ),
    }),
    // Metric cards cover every order of the company (not only the filtered page).
    db
      .select({
        count: count(),
        confirmed: sql<string>`count(*) filter (where ${salesOrder.status} = 'CONFIRMED')`.mapWith(Number),
        delivered: sql<string>`count(*) filter (where ${salesOrder.status} in ('DELIVERED', 'INVOICED'))`.mapWith(Number),
        amount: sql<string>`coalesce(sum(${salesOrder.totalAmount}) filter (where ${salesOrder.status} <> 'VOID'), 0)`.mapWith(Number),
      })
      .from(salesOrder)
      .where(eq(salesOrder.companyId, companyId)),
  ]);
  const recordCount = await unfilteredTotal(params, result.total, async () => metrics?.count ?? 0);

  const confirmed = metrics?.confirmed ?? 0;
  const delivered = metrics?.delivered ?? 0;
  const amount = metrics?.amount ?? 0;
  const canCreate = can(ctx.membership.role, "invoice.create");

  return (
    <PageShell>
      <PageHeader
        eyebrow="Pedidos"
        title="Pedidos"
        description="Compromisos de venta confirmados, preparados para generar la entrega al cliente."
        actions={<><Link className={buttonVariants({ variant: "outline" })} href="/sales/quotes">Ver presupuestos</Link>{canCreate ? <Link className={buttonVariants()} href="/sales/orders/new">Nuevo pedido</Link> : null}</>}
      />
      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Pedidos" value={metrics?.count ?? 0} helper="Documentos registrados" />
        <MetricCard label="Por entregar" value={confirmed} helper="Confirmados sin albarán" tone={confirmed > 0 ? "warning" : "neutral"} />
        <MetricCard label="Entregados" value={delivered} helper="Con albarán generado" tone={delivered > 0 ? "success" : "neutral"} />
        <MetricCard label="Importe comprometido" value={formatMoney(amount, ctx.company.baseCurrencyCode)} helper="Excluye anulados" />
      </section>
      <PageSection title="Listado de pedidos" description="Consulta los pedidos y abre su ficha para preparar el albarán.">
        <SalesDocumentsList
          basePath="/sales/orders"
          currencyCode={ctx.company.baseCurrencyCode}
          dateLabel="Fecha"
          emptyDescription="Los pedidos aparecerán al aceptar o convertir un presupuesto."
          emptyTitle="Sin pedidos"
          rows={result.rows.map((row) => ({ ...row, originLabel: row.quoteNumber ? `Presupuesto ${row.quoteNumber}` : "Pedido directo" }))}
          server={toServerListState(params, result, recordCount)}
          showAmounts
          showOrigin
          testId="sales-orders-list"
          title="Pedidos"
          totals={{ totalAmount: result.rows[0]?.sumTotal ?? 0 }}
        />
      </PageSection>
    </PageShell>
  );
}
