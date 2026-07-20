import { desc, eq } from "drizzle-orm";
import Link from "next/link";

import { SalesDocumentsList } from "@/components/sales/sales-documents-list";
import { buttonVariants } from "@/components/ui/button";
import { MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { customer, salesOrder, salesQuote } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/format";

export default async function SalesOrdersPage() {
  const ctx = await requireContext("invoice.read");
  const rows = await db
    .select({
      id: salesOrder.id,
      number: salesOrder.number,
      customerName: customer.name,
      date: salesOrder.issueDate,
      totalAmount: salesOrder.totalAmount,
      status: salesOrder.status,
      quoteNumber: salesQuote.number,
    })
    .from(salesOrder)
    .innerJoin(customer, eq(customer.id, salesOrder.customerId))
    .leftJoin(salesQuote, eq(salesQuote.id, salesOrder.salesQuoteId))
    .where(eq(salesOrder.companyId, ctx.company.id))
    .orderBy(desc(salesOrder.issueDate));

  const confirmed = rows.filter((row) => row.status === "CONFIRMED").length;
  const delivered = rows.filter((row) => row.status === "DELIVERED" || row.status === "INVOICED").length;
  const amount = rows.filter((row) => row.status !== "VOID").reduce((sum, row) => sum + Number(row.totalAmount), 0);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Ventas"
        title="Pedidos"
        description="Compromisos de venta confirmados, preparados para generar la entrega al cliente."
        backHref="/sales"
        backLabel="Volver a ventas"
        actions={<Link className={buttonVariants({ variant: "outline" })} href="/sales/quotes">Ver presupuestos</Link>}
      />
      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Pedidos" value={rows.length} helper="Documentos registrados" />
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
          rows={rows.map((row) => ({ ...row, originLabel: row.quoteNumber ? `Presupuesto ${row.quoteNumber}` : "Pedido directo" }))}
          testId="sales-orders-list"
          title="Pedidos"
        />
      </PageSection>
    </PageShell>
  );
}
