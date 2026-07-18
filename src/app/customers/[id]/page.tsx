import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActivityTimeline, type ActivityTimelineItem } from "@/components/ui/activity-timeline";
import { buttonVariants } from "@/components/ui/button";
import { MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { customer, deliveryNote, invoice, partner, salesOrder, salesQuote } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { canManageCustomers } from "@/lib/rbac";
import { invoicePaymentStatusLabels, invoicePaymentStatusTone, salesDocumentStatusLabels, statusLabel } from "@/lib/status-labels";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("customer.read");
  const { id } = await params;
  const [record] = await db.select({ id: customer.id, name: customer.name, email: customer.email, phone: customer.phone, status: customer.status, createdAt: customer.createdAt, updatedAt: customer.updatedAt, taxId: partner.taxId, address: partner.address, addressLine2: partner.addressLine2, postalCode: partner.postalCode, city: partner.city, province: partner.province, countryCode: partner.countryCode, currencyCode: partner.currencyCode, paymentTermsDays: partner.paymentTermsDays }).from(customer).leftJoin(partner, eq(partner.id, customer.partnerId)).where(and(eq(customer.id, id), eq(customer.companyId, ctx.company.id))).limit(1);
  if (!record) notFound();

  const [invoices, quotes, orders, deliveries] = await Promise.all([
    db.select({ id: invoice.id, number: invoice.number, totalAmount: invoice.totalAmount, paymentStatus: invoice.paymentStatus, issueDate: invoice.issueDate, createdAt: invoice.createdAt }).from(invoice).where(and(eq(invoice.companyId, ctx.company.id), eq(invoice.customerId, id))).orderBy(desc(invoice.createdAt)),
    db.select({ id: salesQuote.id, number: salesQuote.number, totalAmount: salesQuote.totalAmount, status: salesQuote.status, createdAt: salesQuote.createdAt }).from(salesQuote).where(and(eq(salesQuote.companyId, ctx.company.id), eq(salesQuote.customerId, id))).orderBy(desc(salesQuote.createdAt)),
    db.select({ id: salesOrder.id, number: salesOrder.number, totalAmount: salesOrder.totalAmount, status: salesOrder.status, createdAt: salesOrder.createdAt }).from(salesOrder).where(and(eq(salesOrder.companyId, ctx.company.id), eq(salesOrder.customerId, id))).orderBy(desc(salesOrder.createdAt)),
    db.select({ id: deliveryNote.id, number: deliveryNote.number, status: deliveryNote.status, createdAt: deliveryNote.createdAt }).from(deliveryNote).where(and(eq(deliveryNote.companyId, ctx.company.id), eq(deliveryNote.customerId, id))).orderBy(desc(deliveryNote.createdAt)),
  ]);
  const currencyCode = record.currencyCode ?? ctx.company.baseCurrencyCode;
  const totalInvoiced = invoices.reduce((total, row) => total + Number(row.totalAmount), 0);
  const openAmount = invoices.filter((row) => row.paymentStatus !== "PAID" && row.paymentStatus !== "VOID").reduce((total, row) => total + Number(row.totalAmount), 0);
  const timeline: ActivityTimelineItem[] = [
    ...invoices.map((row) => ({ id: `invoice-${row.id}`, title: `Factura ${row.number}`, description: `${formatMoney(row.totalAmount, currencyCode)} · ${statusLabel(invoicePaymentStatusLabels, row.paymentStatus)}`, date: row.createdAt, href: `/invoices/${row.id}`, tone: row.paymentStatus === "PAID" ? "success" as const : "warning" as const })),
    ...quotes.map((row) => ({ id: `quote-${row.id}`, title: `Presupuesto ${row.number}`, description: `${formatMoney(row.totalAmount, currencyCode)} · ${statusLabel(salesDocumentStatusLabels, row.status)}`, date: row.createdAt, href: `/sales/quotes/${row.id}` })),
    ...orders.map((row) => ({ id: `order-${row.id}`, title: `Pedido ${row.number}`, description: `${formatMoney(row.totalAmount, currencyCode)} · ${statusLabel(salesDocumentStatusLabels, row.status)}`, date: row.createdAt, href: `/sales/orders/${row.id}` })),
    ...deliveries.map((row) => ({ id: `delivery-${row.id}`, title: `Albarán ${row.number}`, description: statusLabel(salesDocumentStatusLabels, row.status), date: row.createdAt, href: `/sales/delivery-notes/${row.id}`, tone: "success" as const })),
    { id: `customer-${record.id}`, title: "Cliente creado", description: "Inicio de la relación comercial", date: record.createdAt },
  ].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
  const canManage = canManageCustomers(ctx.membership.role);

  return (
    <PageShell>
      <PageHeader eyebrow="Clientes" title={record.name} description={[record.taxId, record.city, record.province, record.countryCode].filter(Boolean).join(" · ") || "Ficha comercial y fiscal"} backHref="/customers" backLabel="Volver a clientes" meta={<StatusBadge tone={record.status === "ACTIVE" ? "success" : "neutral"}>{record.status === "ACTIVE" ? "Activo" : "Inactivo"}</StatusBadge>} actions={<>{canManage ? <Link className={buttonVariants({ variant: "outline" })} href={`/customers/${record.id}/edit`}>Editar</Link> : null}<Link className={buttonVariants({ variant: "outline" })} href={`/sales/new?customerId=${record.id}`}>Nuevo presupuesto</Link><Link className={buttonVariants()} href={`/invoices/new?customerId=${record.id}`}>Nueva factura</Link></>} />

      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Facturado" value={formatMoney(totalInvoiced, currencyCode)} helper={`${invoices.length} facturas`} />
        <MetricCard label="Pendiente" value={formatMoney(openAmount, currencyCode)} helper="Importe sin cobrar" tone={openAmount > 0 ? "warning" : "success"} />
        <MetricCard label="Presupuestos" value={quotes.length} helper="Propuestas comerciales" />
        <MetricCard label="Pedidos" value={orders.length} helper={`${deliveries.length} albaranes`} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="space-y-4">
          <PageSection title="Identidad y contacto" description="Información comercial y domicilio fiscal." contentClassName="space-y-4 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3"><dt className="text-muted-foreground">CIF/NIF</dt><dd className="text-right font-medium">{record.taxId ?? "Sin informar"}</dd><dt className="text-muted-foreground">Email</dt><dd className="truncate text-right font-medium">{record.email ?? "Sin informar"}</dd><dt className="text-muted-foreground">Teléfono</dt><dd className="text-right font-medium">{record.phone ?? "Sin informar"}</dd><dt className="text-muted-foreground">Dirección</dt><dd className="text-right font-medium">{[record.address, record.addressLine2, record.postalCode, record.city, record.province, record.countryCode].filter(Boolean).join(", ") || "Sin informar"}</dd><dt className="text-muted-foreground">Condiciones</dt><dd className="text-right font-medium">{record.paymentTermsDays ?? 30} días · {currencyCode}</dd></dl>
          </PageSection>
          <PageSection title="Facturas recientes" description="Últimos documentos emitidos." contentClassName="space-y-2">
            {invoices.length === 0 ? <p className="text-sm text-muted-foreground">Todavía no hay facturas.</p> : invoices.slice(0, 6).map((row) => <Link className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-accent" href={`/invoices/${row.id}`} key={row.id}><span><span className="font-medium">{row.number}</span><span className="block text-xs text-muted-foreground">{formatDate(row.issueDate)}</span></span><span className="text-right"><span className="block font-mono font-semibold">{formatMoney(row.totalAmount, currencyCode)}</span><StatusBadge tone={invoicePaymentStatusTone(row.paymentStatus)}>{statusLabel(invoicePaymentStatusLabels, row.paymentStatus)}</StatusBadge></span></Link>)}
          </PageSection>
        </div>
        <PageSection title="Actividad" description="Cronología comercial completa del cliente."><ActivityTimeline items={timeline} /></PageSection>
      </section>
    </PageShell>
  );
}
