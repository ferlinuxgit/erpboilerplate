import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SalesDocumentLines } from "@/components/sales/sales-document-lines";
import { SalesTransitionButton } from "@/components/sales/sales-transition-button";
import { buttonVariants } from "@/components/ui/button";
import { MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { customer, salesOrder, salesQuote, salesQuoteLine } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { getSalesQuoteTransition } from "@/lib/document-pipelines";
import { salesDocumentStatusLabels, salesDocumentStatusTone, statusLabel } from "@/lib/status-labels";

export default async function SalesQuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("invoice.read");
  const { id } = await params;
  const [record] = await db.select({ id: salesQuote.id, number: salesQuote.number, customerId: salesQuote.customerId, customerName: customer.name, issueDate: salesQuote.issueDate, validUntil: salesQuote.validUntil, subtotal: salesQuote.subtotal, taxAmount: salesQuote.taxAmount, retentionAmount: salesQuote.retentionAmount, totalAmount: salesQuote.totalAmount, status: salesQuote.status, createdAt: salesQuote.createdAt }).from(salesQuote).innerJoin(customer, eq(customer.id, salesQuote.customerId)).where(and(eq(salesQuote.id, id), eq(salesQuote.companyId, ctx.company.id))).limit(1);
  if (!record) notFound();
  const [lines, relatedOrders] = await Promise.all([db.select().from(salesQuoteLine).where(eq(salesQuoteLine.salesQuoteId, id)), db.select({ id: salesOrder.id, number: salesOrder.number, status: salesOrder.status }).from(salesOrder).where(and(eq(salesOrder.companyId, ctx.company.id), eq(salesOrder.salesQuoteId, id)))]);
  const transition = getSalesQuoteTransition(record.status);
  const currency = ctx.company.baseCurrencyCode;
  return <PageShell><PageHeader eyebrow="Ventas · Presupuesto" title={record.number} description={`${record.customerName} · Emitido el ${formatDate(record.issueDate)}`} backHref="/sales" backLabel="Volver a ventas" meta={<StatusBadge tone={salesDocumentStatusTone(record.status)}>{statusLabel(salesDocumentStatusLabels, record.status)}</StatusBadge>} actions={<><Link className={buttonVariants({ variant: "outline" })} href={`/customers/${record.customerId}`}>Ver cliente</Link>{transition.allowed ? <SalesTransitionButton label={transition.actionLabel ?? "Convertir a pedido"} targetBasePath="/sales/orders" url={`/api/sales-quotes/${record.id}/to-order`} /> : null}</>} /><section className="grid gap-3 md:grid-cols-4"><MetricCard label="Base" value={formatMoney(record.subtotal, currency)} /><MetricCard label="IVA" value={formatMoney(record.taxAmount, currency)} /><MetricCard label="Retención" value={formatMoney(record.retentionAmount, currency)} /><MetricCard label="Total" value={formatMoney(record.totalAmount, currency)} tone="success" /></section><PageSection title="Líneas" description="Conceptos e impuestos incluidos en la propuesta."><SalesDocumentLines currencyCode={currency} lines={lines} /></PageSection><section className="grid gap-4 lg:grid-cols-2"><PageSection title="Vigencia" description="Fechas y validez del presupuesto." contentClassName="space-y-2 text-sm"><p>Emisión: <strong>{formatDate(record.issueDate)}</strong></p><p>Válido hasta: <strong>{record.validUntil ? formatDate(record.validUntil) : "Sin fecha límite"}</strong></p>{!transition.allowed && transition.reason ? <p className="rounded-lg bg-muted p-3 text-muted-foreground">{transition.reason}</p> : null}</PageSection><PageSection title="Documentos relacionados" description="Continuidad del ciclo comercial." contentClassName="space-y-2">{relatedOrders.length === 0 ? <p className="text-sm text-muted-foreground">Todavía no se ha generado ningún pedido.</p> : relatedOrders.map((order) => <Link className="flex items-center justify-between rounded-lg border p-3 text-sm hover:bg-accent" href={`/sales/orders/${order.id}`} key={order.id}><span className="font-medium">Pedido {order.number}</span><StatusBadge tone={salesDocumentStatusTone(order.status)}>{statusLabel(salesDocumentStatusLabels, order.status)}</StatusBadge></Link>)}</PageSection></section></PageShell>;
}
