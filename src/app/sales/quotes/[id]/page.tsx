import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SalesDocumentLines } from "@/components/sales/sales-document-lines";
import { SalesTransitionButton } from "@/components/sales/sales-transition-button";
import { buttonVariants } from "@/components/ui/button";
import { MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { salesStatusLabel, salesStatusTone } from "@/components/sales/sales-status";
import { customer, invoice, salesOrder, salesQuote, salesQuoteLine } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { invoiceLifecycle } from "@/server/invoices/lifecycle";
import { QUOTE_STATUS_ACTIONS, quoteConversionBlocker, type QuoteStatusTarget } from "@/server/sales/service";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const ctx = await requireContext("invoice.read");
    const { id } = await params;
    const [row] = await db
      .select({ number: salesQuote.number })
      .from(salesQuote)
      .where(and(eq(salesQuote.id, id), eq(salesQuote.companyId, ctx.company.id)))
      .limit(1);
    return { title: row ? `Presupuesto ${row.number}` : "Presupuesto" };
  } catch {
    return { title: "Presupuesto" };
  }
}

export default async function SalesQuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("invoice.read");
  const { id } = await params;
  const [record] = await db
    .select({
      id: salesQuote.id,
      number: salesQuote.number,
      customerId: salesQuote.customerId,
      customerName: customer.name,
      issueDate: salesQuote.issueDate,
      validUntil: salesQuote.validUntil,
      subtotal: salesQuote.subtotal,
      taxAmount: salesQuote.taxAmount,
      retentionAmount: salesQuote.retentionAmount,
      totalAmount: salesQuote.totalAmount,
      status: salesQuote.status,
    })
    .from(salesQuote)
    .innerJoin(customer, eq(customer.id, salesQuote.customerId))
    .where(and(eq(salesQuote.id, id), eq(salesQuote.companyId, ctx.company.id)))
    .limit(1);
  if (!record) notFound();

  const [lines, relatedOrders, relatedInvoices] = await Promise.all([
    db.select().from(salesQuoteLine).where(eq(salesQuoteLine.salesQuoteId, id)),
    db
      .select({ id: salesOrder.id, number: salesOrder.number, status: salesOrder.status })
      .from(salesOrder)
      .where(and(eq(salesOrder.companyId, ctx.company.id), eq(salesOrder.salesQuoteId, id))),
    db
      .select({ id: invoice.id, number: invoice.number, status: invoice.status, issuedAt: invoice.issuedAt })
      .from(invoice)
      .where(and(eq(invoice.companyId, ctx.company.id), eq(invoice.salesQuoteId, id))),
  ]);
  const liveInvoices = relatedInvoices.filter((row) => row.status !== "VOID");
  const blocker = quoteConversionBlocker(record.status, { orders: relatedOrders.length, invoices: liveInvoices.length });
  const currency = ctx.company.baseCurrencyCode;
  const canManage = can(ctx.membership.role, "invoice.create");
  const canEdit = canManage && record.status === "DRAFT";
  const converted = relatedOrders.length > 0 || liveInvoices.length > 0;
  const statusActions = (Object.keys(QUOTE_STATUS_ACTIONS) as QuoteStatusTarget[]).filter((target) =>
    (QUOTE_STATUS_ACTIONS[target].from as readonly string[]).includes(record.status) && (target === "VOID" || !converted));
  const statusCopy: Record<QuoteStatusTarget, { title: string; description: string; confirm: string }> = {
    SENT: { title: "¿Marcar como enviado?", description: `Indica que ya has mandado el presupuesto ${record.number} a ${record.customerName}. Podrás seguir marcándolo como aceptado o rechazado.`, confirm: "Marcar como enviado" },
    CONFIRMED: { title: "¿El cliente lo ha aceptado?", description: `El presupuesto ${record.number} quedará como aceptado y ya no se podrá editar. Después podrás convertirlo en pedido o directamente en factura.`, confirm: "Sí, aceptado" },
    REJECTED: { title: "¿El cliente lo ha rechazado?", description: `El presupuesto ${record.number} quedará como rechazado. No se borra: seguirá en el historial del cliente.`, confirm: "Sí, rechazado" },
    VOID: { title: "¿Anular el presupuesto?", description: `El presupuesto ${record.number} quedará anulado y no se podrá convertir en pedido ni factura. No se borra del historial.`, confirm: "Anular presupuesto" },
  };

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[
          { label: "Comercial" },
          { label: "Presupuestos", href: "/sales/quotes" },
          { label: record.number },
        ]}
        title={record.number}
        description={`${record.customerName} · Emitido el ${formatDate(record.issueDate)}`}
        meta={<StatusBadge tone={salesStatusTone(record.status)}>{salesStatusLabel(record.status, "quote")}</StatusBadge>}
        actions={
          <>
            <a className={buttonVariants({ variant: "outline" })} href={`/api/sales-quotes/${record.id}/pdf`} rel="noreferrer" target="_blank">PDF</a>
            <Link className={buttonVariants({ variant: "outline" })} href={`/customers/${record.customerId}`}>Ver cliente</Link>
            {canEdit ? <Link className={buttonVariants({ variant: "outline" })} href={`/sales/quotes/${record.id}/edit`}>Editar</Link> : null}
            {canManage && !blocker ? (
              <>
                <SalesTransitionButton
                  confirmDescription={`Se creará una factura en borrador para ${record.customerName} con las mismas líneas (${formatMoney(record.totalAmount, currency)}), con el vencimiento y las formas de pago del cliente. Podrás revisarla antes de emitirla.`}
                  confirmLabel="Crear factura en borrador"
                  confirmTitle="¿Facturar este presupuesto?"
                  label="Facturar"
                  successMessage="Factura en borrador creada desde el presupuesto. Revísala y emítela."
                  targetBasePath="/invoices"
                  testId="quote-to-invoice"
                  url={`/api/sales-quotes/${record.id}/to-invoice`}
                  variant="secondary"
                />
                <SalesTransitionButton
                  confirmDescription={`Se creará un pedido confirmado con las líneas del presupuesto ${record.number}. Úsalo si vas a entregar mercancía con albarán.`}
                  confirmLabel="Crear pedido"
                  confirmTitle="¿Convertir en pedido?"
                  label="Convertir a pedido"
                  successMessage="Pedido {number} creado desde el presupuesto."
                  targetBasePath="/sales/orders"
                  testId="quote-to-order"
                  url={`/api/sales-quotes/${record.id}/to-order`}
                />
              </>
            ) : null}
            {canManage ? statusActions.map((target) => (
              <SalesTransitionButton
                body={{ status: target }}
                confirmDescription={statusCopy[target].description}
                confirmLabel={statusCopy[target].confirm}
                confirmTitle={statusCopy[target].title}
                key={target}
                label={QUOTE_STATUS_ACTIONS[target].label}
                showArrow={false}
                successMessage={QUOTE_STATUS_ACTIONS[target].done}
                testId={`quote-status-${target.toLowerCase()}`}
                url={`/api/sales-quotes/${record.id}/status`}
                variant={target === "VOID" || target === "REJECTED" ? "destructive" : "outline"}
              />
            )) : null}
          </>
        }
      />
      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Base" value={formatMoney(record.subtotal, currency)} />
        <MetricCard label="IVA" value={formatMoney(record.taxAmount, currency)} />
        <MetricCard label="Retención" value={formatMoney(record.retentionAmount, currency)} />
        <MetricCard label="Total" value={formatMoney(record.totalAmount, currency)} tone="success" />
      </section>
      <PageSection title="Líneas" description="Conceptos e impuestos incluidos en la propuesta.">
        <SalesDocumentLines currencyCode={currency} lines={lines} />
      </PageSection>
      <section className="grid gap-4 lg:grid-cols-2">
        <PageSection title="Vigencia" description="Fechas y validez del presupuesto." contentClassName="space-y-2 text-sm">
          <p>Emisión: <strong>{formatDate(record.issueDate)}</strong></p>
          <p>Válido hasta: <strong>{record.validUntil ? formatDate(record.validUntil) : "Sin fecha límite"}</strong></p>
          {blocker ? <p className="rounded-[2px] border border-window-dark-shadow bg-window-panel p-3 text-muted-foreground">{blocker}</p> : null}
        </PageSection>
        <PageSection title="Documentos generados" description="Pedidos y facturas creados a partir de este presupuesto." contentClassName="space-y-2">
          {relatedOrders.length === 0 && relatedInvoices.length === 0 ? <p className="text-sm text-muted-foreground">Todavía no se ha convertido en pedido ni en factura.</p> : null}
          {relatedOrders.map((order) => (
            <Link className="flex items-center justify-between rounded-[2px] border p-3 text-sm hover:bg-accent" href={`/sales/orders/${order.id}`} key={order.id}>
              <span className="font-medium">Pedido {order.number}</span>
              <StatusBadge tone={salesStatusTone(order.status)}>{salesStatusLabel(order.status)}</StatusBadge>
            </Link>
          ))}
          {relatedInvoices.map((row) => {
            const lifecycle = invoiceLifecycle(row);
            return (
              <Link className="flex items-center justify-between rounded-[2px] border p-3 text-sm hover:bg-accent" href={`/invoices/${row.id}`} key={row.id}>
                <span className="font-medium">{lifecycle === "DRAFT" ? "Factura en borrador" : `Factura ${row.number}`}</span>
                <StatusBadge tone={lifecycle === "VOID" ? "danger" : lifecycle === "DRAFT" ? "neutral" : "info"}>{lifecycle === "VOID" ? "Anulada" : lifecycle === "DRAFT" ? "Borrador" : "Emitida"}</StatusBadge>
              </Link>
            );
          })}
        </PageSection>
      </section>
    </PageShell>
  );
}
