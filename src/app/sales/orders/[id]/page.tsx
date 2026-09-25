import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SalesDocumentLines } from "@/components/sales/sales-document-lines";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { customer, deliveryNote, salesOrder, salesOrderLine } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { getSalesOrderTransition, type SalesDocumentStatus } from "@/lib/document-pipelines";
import { formatDate, formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { SalesTransitionButton } from "@/components/sales/sales-transition-button";
import { salesStatusLabel, salesStatusTone } from "@/components/sales/sales-status";
import { orderChangeBlocker } from "@/server/sales/service";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const ctx = await requireContext("invoice.read");
    const { id } = await params;
    const [row] = await db
      .select({ number: salesOrder.number })
      .from(salesOrder)
      .where(and(eq(salesOrder.id, id), eq(salesOrder.companyId, ctx.company.id)))
      .limit(1);
    return { title: row ? `Pedido de venta ${row.number}` : "Pedido de venta" };
  } catch {
    return { title: "Pedido de venta" };
  }
}

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
  const transition = getSalesOrderTransition(record.status as SalesDocumentStatus);
  const currency = ctx.company.baseCurrencyCode;
  const canManage = can(ctx.membership.role, "invoice.create");
  const changeBlocker = await orderChangeBlocker(db, ctx.company.id, record, "edit");
  const invoiceBlocker = await orderChangeBlocker(db, ctx.company.id, record, "invoice");

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[
          { label: "Comercial" },
          { label: "Pedidos", href: "/sales/orders" },
          { label: record.number },
        ]}
        title={record.number}
        description={`${record.customerName} · ${formatDate(record.issueDate)}`}
        meta={<StatusBadge tone={salesStatusTone(record.status)}>{salesStatusLabel(record.status)}</StatusBadge>}
        actions={
          <>
            <a className={buttonVariants({ variant: "outline" })} href={`/api/sales-orders/${record.id}/pdf`} rel="noreferrer" target="_blank">PDF</a>
            <Link className={buttonVariants({ variant: "outline" })} href={`/customers/${record.customerId}`}>Ver cliente</Link>
            {record.salesQuoteId ? <Link className={buttonVariants({ variant: "outline" })} href={`/sales/quotes/${record.salesQuoteId}`}>Ver presupuesto</Link> : null}
            {canManage && !changeBlocker ? <Link className={buttonVariants({ variant: "outline" })} data-testid="sales-order-edit-link" href={`/sales/orders/${record.id}/edit`}>Editar</Link> : null}
            {canManage && !invoiceBlocker ? (
              <SalesTransitionButton
                confirmDescription={`Se creará una factura en borrador para ${record.customerName} con todas las líneas del pedido (${formatMoney(record.totalAmount, currency)}), sin albarán. Podrás revisarla antes de emitirla.`}
                confirmLabel="Crear factura en borrador"
                confirmTitle="¿Facturar el pedido sin albarán?"
                label="Facturar"
                successMessage="Factura en borrador creada desde el pedido. Revísala y emítela."
                targetBasePath="/invoices"
                testId="order-to-invoice"
                url={`/api/sales-orders/${record.id}/to-invoice`}
                variant="secondary"
              />
            ) : null}
            {transition.allowed ? <Link className={buttonVariants()} href={`/sales/delivery-notes/new?orderId=${record.id}`}>Preparar albarán</Link> : null}
            {canManage && !changeBlocker ? (
              <SalesTransitionButton
                confirmDescription={`El pedido ${record.number} quedará anulado: no se podrá entregar ni facturar. No se borra del historial.`}
                confirmLabel="Anular pedido"
                confirmTitle="¿Anular el pedido?"
                label="Anular"
                method="DELETE"
                showArrow={false}
                successMessage="Pedido anulado."
                testId="order-cancel"
                url={`/api/sales-orders/${record.id}`}
                variant="destructive"
              />
            ) : null}
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
        {deliveries.length === 0 ? (
          <EmptyState
            title="Sin albaranes"
            description={transition.allowed ? "No hay entregas registradas. Usa «Preparar albarán» para expedir las cantidades pendientes." : "No hay entregas registradas para este pedido."}
          />
        ) :deliveries.map((delivery) => (
          <Link className="flex items-center justify-between rounded-[2px] border p-3 text-sm hover:bg-accent" href={`/sales/delivery-notes/${delivery.id}`} key={delivery.id}>
            <span><span className="font-medium">{delivery.number}</span><span className="block text-xs text-muted-foreground">{formatDate(delivery.issuedAt)}</span></span>
            <StatusBadge tone={salesStatusTone(delivery.status)}>{salesStatusLabel(delivery.status, "delivery")}</StatusBadge>
          </Link>
        ))}
      </PageSection>
    </PageShell>
  );
}
