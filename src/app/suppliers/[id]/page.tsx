import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { RegisterSupplierPaymentButton } from "@/components/purchases/register-supplier-payment-button";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { accountChart, paymentMethod } from "@/db/schema";
import { formatDate, formatMoney } from "@/lib/format";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { ensureUserTenant } from "@/lib/tenant";
import { invoicePaymentStatusLabels, invoicePaymentStatusTone, purchaseOrderStatusLabels, statusLabel } from "@/lib/status-labels";
import { getSupplier, getSupplierActivity } from "@/server/suppliers/service";

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const { id } = await params;
  const [supplier, activity] = await Promise.all([
    getSupplier(db, ctx.company.id, id),
    getSupplierActivity(db, ctx.company.id, id),
  ]);
  if (!supplier) notFound();

  const [method] = supplier.paymentMethodId
    ? await db.select({ name: paymentMethod.name }).from(paymentMethod).where(eq(paymentMethod.id, supplier.paymentMethodId)).limit(1)
    : [];
  const [account] = supplier.defaultAccountId
    ? await db.select({ code: accountChart.code, name: accountChart.name }).from(accountChart).where(eq(accountChart.id, supplier.defaultAccountId)).limit(1)
    : [];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Proveedores"
        title={supplier.name}
        description={[`N.º proveedor ${supplier.number}`, supplier.taxId, supplier.city, supplier.province, supplier.countryCode].filter(Boolean).join(" · ") || "Ficha de proveedor"}
        backHref="/suppliers"
        backLabel="Volver a proveedores"
        meta={<StatusBadge tone={supplier.isActive ? "success" : "neutral"}>{supplier.isActive ? "Activo" : "Inactivo"}</StatusBadge>}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link className={buttonVariants({ variant: "outline" })} href={`/suppliers/${supplier.id}/edit`}>
              Editar
            </Link>
            <RegisterSupplierPaymentButton
              currencyCode={supplier.currencyCode}
              outstandingAmount={activity.metrics.outstandingAmount}
              supplierId={supplier.id}
            />
            <Link className={buttonVariants()} href={`/expenses/new?supplierId=${supplier.id}`}>
              Registrar factura
            </Link>
          </div>
        }
      />

      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Facturas recibidas" value={activity.metrics.invoiceCount} helper={`Total ${formatMoney(activity.metrics.totalInvoiced, supplier.currencyCode)}`} />
        <MetricCard label="Pendiente" value={formatMoney(activity.metrics.outstandingAmount, supplier.currencyCode)} helper={activity.metrics.creditBalance > 0 ? `A favor: ${formatMoney(activity.metrics.creditBalance, supplier.currencyCode)}` : `Pagado: ${formatMoney(activity.metrics.totalPaid, supplier.currencyCode)}`} tone={activity.metrics.outstandingAmount > 0 ? "warning" : "success"} />
        <MetricCard label="Vencido" value={formatMoney(activity.metrics.overdueAmount, supplier.currencyCode)} helper="Importe pendiente vencido" tone={activity.metrics.overdueAmount > 0 ? "warning" : "success"} />
        <MetricCard label="Pedidos" value={activity.metrics.purchaseOrderCount} helper="Pedidos de compra asociados" />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Datos fiscales</CardTitle>
            <CardDescription>Identidad y domicilio del tercero.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p>N.º proveedor: <span className="font-mono">{supplier.number}</span></p>
            <p>CIF/NIF: {supplier.taxId ?? "Sin informar"}</p>
            <p>Dirección: {[supplier.address, supplier.addressLine2].filter(Boolean).join(", ") || "Sin informar"}</p>
            <p>Población: {[supplier.postalCode, supplier.city, supplier.province, supplier.countryCode].filter(Boolean).join(", ") || "Sin informar"}</p>
            <p>Tipo: {supplier.type === "BOTH" ? "Cliente y proveedor" : "Proveedor"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Contacto</CardTitle>
            <CardDescription>Canales operativos para facturación.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p>Email: {supplier.email ?? "Sin email"}</p>
            <p>Teléfono: {supplier.phone ?? "Sin teléfono"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Condiciones</CardTitle>
            <CardDescription>Valores por defecto para facturas recibidas.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p>Días de pago: {supplier.paymentTermsDays ?? 30}</p>
            <p>Método: {method?.name ?? "Sin método por defecto"}</p>
            <p>Cuenta: {account ? `${account.code} - ${account.name}` : "Cuenta por defecto de empresa"}</p>
            <p>Moneda: {supplier.currencyCode}</p>
          </CardContent>
        </Card>
      </section>

      <PageSection title="Facturas recientes" description="Últimas facturas recibidas de este proveedor, con o sin pedido asociado.">
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-3">Número</th>
                <th className="p-3">Pedido</th>
                <th className="p-3">Fecha</th>
                <th className="p-3">Estado pago</th>
                <th className="p-3 text-right">Total</th>
                <th className="p-3 text-right">Pendiente</th>
              </tr>
            </thead>
            <tbody>
              {activity.invoices.length === 0 ? (
                <tr><td className="p-3 text-muted-foreground" colSpan={6}>Sin facturas registradas.</td></tr>
              ) : activity.invoices.map((invoice) => (
                <tr className="border-t" key={invoice.id}>
                  <td className="p-3"><Link className="font-medium text-primary hover:underline" href={`/expenses/${invoice.id}`}>{invoice.supplierDocumentNumber ?? invoice.number}</Link></td>
                  <td className="p-3">{invoice.purchaseOrderId ? <Link className="text-primary hover:underline" href={`/purchases/orders/${invoice.purchaseOrderId}`}>{invoice.purchaseOrderNumber}</Link> : "Sin pedido"}</td>
                  <td className="p-3">{formatDate(invoice.issueDate)}</td>
                  <td className="p-3"><StatusBadge tone={invoicePaymentStatusTone(invoice.paymentStatus)}>{statusLabel(invoicePaymentStatusLabels, invoice.paymentStatus)}</StatusBadge></td>
                  <td className="p-3 text-right">{formatMoney(invoice.totalAmount, supplier.currencyCode)}</td>
                  <td className="p-3 text-right">{formatMoney(invoice.outstandingAmount, supplier.currencyCode)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PageSection>

      <section className="grid gap-4 lg:grid-cols-2">
        <PageSection title="Pedidos recientes" description="Últimos pedidos de compra asociados.">
          <div className="space-y-2 text-sm">
            {activity.purchaseOrders.length === 0 ? <p className="text-muted-foreground">Sin pedidos registrados.</p> : activity.purchaseOrders.map((order) => (
              <Link className="flex items-center justify-between rounded-md border p-3 hover:bg-accent" href={`/purchases/orders/${order.id}`} key={order.id}>
                <span className="font-medium">{order.number}</span>
                <span className="text-muted-foreground">{statusLabel(purchaseOrderStatusLabels, order.status)} · {formatDate(order.createdAt)}</span>
              </Link>
            ))}
          </div>
        </PageSection>
        <PageSection title="Pagos recientes" description="Últimos pagos aplicados a facturas del proveedor.">
          <div className="space-y-2 text-sm">
            {activity.payments.length === 0 ? <p className="text-muted-foreground">Sin pagos registrados.</p> : activity.payments.map((payment) => (
              <div className="flex items-center justify-between rounded-md border p-3" key={payment.id}>
                <span><span className="block font-mono font-semibold">{payment.number}</span><span className="text-xs text-muted-foreground">{formatDate(payment.postedAt)} · {payment.supplierInvoiceId ? "Aplicado a factura" : "Pago a cuenta"}</span></span>
                <span className="font-medium">{formatMoney(payment.amount, supplier.currencyCode)}</span>
              </div>
            ))}
          </div>
        </PageSection>
      </section>
    </PageShell>
  );
}
