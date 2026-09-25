import { count, eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";

import { SalesDocumentsList } from "@/components/sales/sales-documents-list";
import { buttonVariants } from "@/components/ui/button";
import { MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { customer, deliveryNote, salesDocumentStatusEnum, salesOrder } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
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
} from "@/server/lists/paginate";

export const metadata: Metadata = { title: "Albaranes" };

const deliveryNoteListConfig = {
  sortKeys: ["recent", "number", "date", "origin", "status"] as const,
  // Newest first: a just-created delivery note is always on page 1.
  defaultSort: { key: "recent" as const, dir: "desc" as const },
  filters: { status: salesDocumentStatusEnum.enumValues },
};

type SalesDocumentStatus = (typeof salesDocumentStatusEnum.enumValues)[number];

export default async function DeliveryNotesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireContext("invoice.read");
  const companyId = ctx.company.id;
  const params = parseListParams(await searchParams, deliveryNoteListConfig);

  const where = listWhere({
    base: [eq(deliveryNote.companyId, companyId)],
    search: { q: params.q, columns: [deliveryNote.number, customer.name, salesOrder.number] },
    dateRange: { column: deliveryNote.issuedAt, from: params.from, to: params.to },
    filters: [params.filters.status ? eq(deliveryNote.status, params.filters.status as SalesDocumentStatus) : undefined],
  });
  const sortColumns = {
    recent: deliveryNote.createdAt,
    number: deliveryNote.number,
    date: deliveryNote.issuedAt,
    origin: salesOrder.number,
    status: deliveryNote.status,
  };

  const [result, [metrics]] = await Promise.all([
    paginate({
      page: params.page,
      pageSize: params.pageSize,
      fetchPage: (limit, offset) =>
        db
          .select({
            id: deliveryNote.id,
            number: deliveryNote.number,
            customerName: customer.name,
            date: deliveryNote.issuedAt,
            status: deliveryNote.status,
            orderNumber: salesOrder.number,
            total: windowCount(),
          })
          .from(deliveryNote)
          .innerJoin(customer, eq(customer.id, deliveryNote.customerId))
          .leftJoin(salesOrder, eq(salesOrder.id, deliveryNote.salesOrderId))
          .where(where)
          .orderBy(...listOrderBy(sortColumns, params, deliveryNote.id))
          .limit(limit)
          .offset(offset),
      countAll: () =>
        countRows(
          db
            .select({ value: count() })
            .from(deliveryNote)
            .innerJoin(customer, eq(customer.id, deliveryNote.customerId))
            .leftJoin(salesOrder, eq(salesOrder.id, deliveryNote.salesOrderId))
            .where(where),
        ),
    }),
    // Metric cards cover every delivery note of the company (not only the filtered page).
    db
      .select({
        count: count(),
        delivered: sql<string>`count(*) filter (where ${deliveryNote.status} = 'DELIVERED')`.mapWith(Number),
        invoiced: sql<string>`count(*) filter (where ${deliveryNote.status} = 'INVOICED')`.mapWith(Number),
        voided: sql<string>`count(*) filter (where ${deliveryNote.status} = 'VOID')`.mapWith(Number),
      })
      .from(deliveryNote)
      .where(eq(deliveryNote.companyId, companyId)),
  ]);
  const recordCount = await unfilteredTotal(params, result.total, async () => metrics?.count ?? 0);

  const delivered = metrics?.delivered ?? 0;
  const invoiced = metrics?.invoiced ?? 0;
  const voided = metrics?.voided ?? 0;
  const canCreate = can(ctx.membership.role, "invoice.create");

  return (
    <PageShell>
      <PageHeader
        eyebrow="Albaranes"
        title="Albaranes"
        description="Entregas realizadas al cliente y pendientes de convertir en factura."
        actions={<><Link className={buttonVariants({ variant: "outline" })} href="/sales/orders">Ver pedidos</Link>{canCreate ? <Link className={buttonVariants()} href="/sales/delivery-notes/new">Nuevo albarán</Link> : null}</>}
      />
      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Albaranes" value={metrics?.count ?? 0} helper="Entregas registradas" />
        <MetricCard label="Por facturar" value={delivered} helper="Entregados sin factura" tone={delivered > 0 ? "warning" : "neutral"} />
        <MetricCard label="Facturados" value={invoiced} helper="Convertidos en factura" tone={invoiced > 0 ? "success" : "neutral"} />
        <MetricCard label="Anulados" value={voided} helper="Entregas canceladas" tone={voided > 0 ? "danger" : "neutral"} />
      </section>
      <PageSection title="Listado de albaranes" description="Consulta las entregas y abre su ficha para revisar líneas o generar la factura.">
        <SalesDocumentsList kind="delivery"
          basePath="/sales/delivery-notes"
          currencyCode={ctx.company.baseCurrencyCode}
          dateLabel="Entrega"
          emptyDescription="Los albaranes aparecerán al preparar una entrega desde un pedido confirmado."
          emptyTitle="Sin albaranes"
          rows={result.rows.map((row) => ({ ...row, originLabel: row.orderNumber ? `Pedido ${row.orderNumber}` : null }))}
          server={toServerListState(params, result, recordCount)}
          showAmounts={false}
          showOrigin
          testId="sales-delivery-notes-list"
          title="Albaranes"
        />
      </PageSection>
    </PageShell>
  );
}
