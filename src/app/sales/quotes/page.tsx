import { count, eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";

import { SalesDocumentsList } from "@/components/sales/sales-documents-list";
import { buttonVariants } from "@/components/ui/button";
import { MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { customer, salesDocumentStatusEnum, salesQuote } from "@/db/schema";
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

export const metadata: Metadata = { title: "Presupuestos" };

const quoteListConfig = {
  sortKeys: ["recent", "number", "date", "total", "status"] as const,
  // Newest first: a just-created quote is always on page 1.
  defaultSort: { key: "recent" as const, dir: "desc" as const },
  filters: { status: salesDocumentStatusEnum.enumValues },
};

type SalesDocumentStatus = (typeof salesDocumentStatusEnum.enumValues)[number];

export default async function SalesQuotesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireContext("invoice.read");
  const companyId = ctx.company.id;
  const params = parseListParams(await searchParams, quoteListConfig);

  const where = listWhere({
    base: [eq(salesQuote.companyId, companyId)],
    search: { q: params.q, columns: [salesQuote.number, customer.name, sql`${salesQuote.totalAmount}::text`] },
    dateRange: { column: salesQuote.issueDate, from: params.from, to: params.to },
    filters: [params.filters.status ? eq(salesQuote.status, params.filters.status as SalesDocumentStatus) : undefined],
  });
  const sortColumns = {
    recent: salesQuote.createdAt,
    number: salesQuote.number,
    date: salesQuote.issueDate,
    total: salesQuote.totalAmount,
    status: salesQuote.status,
  };

  const [result, [metrics]] = await Promise.all([
    paginate({
      page: params.page,
      pageSize: params.pageSize,
      fetchPage: (limit, offset) =>
        db
          .select({
            id: salesQuote.id,
            number: salesQuote.number,
            customerName: customer.name,
            date: salesQuote.issueDate,
            totalAmount: salesQuote.totalAmount,
            status: salesQuote.status,
            total: windowCount(),
            ...windowTotals({ sumTotal: salesQuote.totalAmount }),
          })
          .from(salesQuote)
          .innerJoin(customer, eq(customer.id, salesQuote.customerId))
          .where(where)
          .orderBy(...listOrderBy(sortColumns, params, salesQuote.id))
          .limit(limit)
          .offset(offset),
      countAll: () =>
        countRows(
          db.select({ value: count() }).from(salesQuote).innerJoin(customer, eq(customer.id, salesQuote.customerId)).where(where),
        ),
    }),
    // Metric cards cover every quote of the company (not only the filtered page).
    db
      .select({
        count: count(),
        drafts: sql<string>`count(*) filter (where ${salesQuote.status} = 'DRAFT')`.mapWith(Number),
        confirmed: sql<string>`count(*) filter (where ${salesQuote.status} = 'CONFIRMED')`.mapWith(Number),
        amount: sql<string>`coalesce(sum(${salesQuote.totalAmount}) filter (where ${salesQuote.status} <> 'VOID'), 0)`.mapWith(Number),
      })
      .from(salesQuote)
      .where(eq(salesQuote.companyId, companyId)),
  ]);
  const recordCount = await unfilteredTotal(params, result.total, async () => metrics?.count ?? 0);

  const drafts = metrics?.drafts ?? 0;
  const confirmed = metrics?.confirmed ?? 0;
  const amount = metrics?.amount ?? 0;
  const canCreate = can(ctx.membership.role, "invoice.create");

  return (
    <PageShell>
      <PageHeader
        eyebrow="Presupuestos"
        title="Presupuestos"
        description="Propuestas comerciales enviadas a clientes, con vigencia, importe y estado de aceptación."
        actions={canCreate ? <Link className={buttonVariants()} href="/sales/new">Nuevo presupuesto</Link> : null}
      />
      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Presupuestos" value={metrics?.count ?? 0} helper="Documentos registrados" />
        <MetricCard label="Borradores" value={drafts} helper="Pendientes de completar" tone={drafts > 0 ? "warning" : "neutral"} />
        <MetricCard label="Aceptados" value={confirmed} helper="Aceptados o convertidos" tone={confirmed > 0 ? "success" : "neutral"} />
        <MetricCard label="Importe propuesto" value={formatMoney(amount, ctx.company.baseCurrencyCode)} helper="Excluye anulados" />
      </section>
      <PageSection title="Listado de presupuestos" description="Busca, ordena, configura columnas, guarda vistas y exporta el resultado.">
        <SalesDocumentsList kind="quote"
          basePath="/sales/quotes"
          currencyCode={ctx.company.baseCurrencyCode}
          dateLabel="Emisión"
          emptyDescription="Crea el primer presupuesto para preparar una propuesta comercial."
          emptyTitle="Sin presupuestos"
          rows={result.rows}
          server={toServerListState(params, result, recordCount)}
          showAmounts
          showOrigin={false}
          testId="sales-quotes-list"
          title="Presupuestos"
          totals={{ totalAmount: result.rows[0]?.sumTotal ?? 0 }}
        />
      </PageSection>
    </PageShell>
  );
}
