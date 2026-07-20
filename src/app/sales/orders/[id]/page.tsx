import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SalesDocumentLines } from "@/components/sales/sales-document-lines";
import { buttonVariants } from "@/components/ui/button";
import { MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { customer, deliveryNote, salesOrder, salesOrderLine } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { getSalesOrderTransition } from "@/lib/document-pipelines";
import { formatDate, formatMoney } from "@/lib/format";
import { salesDocumentStatusLabels, salesDocumentStatusTone, statusLabel } from "@/lib/status-labels";

export default async function SalesOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("invoice.read");
  const { id } = await params;
  const [record] = await db
    .select({
      id: salesOrder.id,
      number: salesOrder.number,
      customerId: salesOrder.customerId,
      customerName: customer.name,
      salesQuoteId: salesOrder.salesQuoteId,
      issueDate: salesOrder.issueDate,
      subtotal: salesOrder.subtotal,
      taxAmount: salesOrder.taxAmount,
      retentionAmount: salesOrder.retentionAmount,
      totalAmount: salesOrder.totalAmount,
      status: salesOrder.status,
    })
    .from(salesOrder)
    .innerJoin(customer, eq(customer.id, salesOrder.customerId))
    .where(and(eq(salesOrder.id, id), eq(salesOrder.companyId, ctx.company.id)))
    .limit(1);
  if (!record) notFound();

  const [lines, deliveries] = await Promise.all([
    db.select().from(salesOrderLine).where(eq(salesOrderLine.salesOrderId, id)),
    db
      .select({ id: deliveryNote.id, number: deliveryNote.number, status: deliveryNote.status, issuedAt: deliveryNote.issuedAt })
      .from(deliveryNote)
      .where(and(eq(deliveryNote.companyId, ctx.company.id), eq(deliveryNote.salesOrderId, id))),
  ]);
  const transition = getSalesOrderTransition(record.status);
  const currency = ctx.company.baseCurrencyCode;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Pedido"
        title={record.number}
        description={`${record.customerName} · ${formatDate(record.issueDate)}`}
        backHref="/sales/orders"
        backLabel="Volver a pedidos"
        meta={<StatusBadge tone={salesDocumentStatusTone(record.status)}>{statusLabel(salesDocumentStatusLabels, record.status)}</StatusBadge>}
        actions={
          <>
            <a className={buttonVariants({ variant: "outline" })} href={`/api/sales-orders/${record.id}/pdf`} rel="noreferrer" target="_blank">PDF</a>
            <Link className={buttonVariants({ variant: "outline" })} href={`/customers/${record.customerId}`}>Ver cliente</Link>
            {record.salesQuoteId ? <Link className={buttonVariants({ variant: "outline" })} href={`/sales/quotes/${record.salesQuoteId}`}>Ver presupuesto</Link> : null}
            {transition.allowed ? <Link className={buttonVariants()} href={`/sales/delivery-notes/new?orderId=${record.id}`}>Preparar albarán</Link> : null}
          </>
        }
      />
      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Base" value={formatMoney(record.subtotal, currency)} />
        <MetricCard label="IVA" value={formatMoney(record.taxAmount, currency)} />
        <MetricCard label="Retención" value={formatMoney(record.retentionAmount, currency)} />
        <MetricCard label="Total" value={formatMoney(record.totalAmount, currency)} tone="success" />
      </section>
      <PageSection title="Líneas" description="Productos y servicios confirmados.">
        <SalesDocumentLines currencyCode={currency} lines={lines} />
      </PageSection>
      <PageSection title="Albaranes relacionados" description="Entregas generadas desde este pedido." contentClassName="space-y-2">
        {deliveries.length === 0 ? <p className="text-sm text-muted-foreground">No hay entregas registradas.</p> : deliveries.map((delivery) => (
          <Link className="flex items-center justify-between rounded-lg border p-3 text-sm hover:bg-accent" href={`/sales/delivery-notes/${delivery.id}`} key={delivery.id}>
            <span><span className="font-medium">{delivery.number}</span><span className="block text-xs text-muted-foreground">{formatDate(delivery.issuedAt)}</span></span>
            <StatusBadge tone={salesDocumentStatusTone(delivery.status)}>{statusLabel(salesDocumentStatusLabels, delivery.status)}</StatusBadge>
          </Link>
        ))}
      </PageSection>
    </PageShell>
  );
}
