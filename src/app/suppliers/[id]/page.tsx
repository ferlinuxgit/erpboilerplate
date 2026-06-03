import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { accountChart, paymentMethod } from "@/db/schema";
import { formatDate, formatMoney } from "@/lib/format";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { ensureUserTenant } from "@/lib/tenant";
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
        description={[supplier.taxId, supplier.city, supplier.province, supplier.countryCode].filter(Boolean).join(" · ") || "Ficha de proveedor"}
        backHref="/suppliers"
        backLabel="Volver a proveedores"
        meta={<StatusBadge tone={supplier.isActive ? "success" : "neutral"}>{supplier.isActive ? "Activo" : "Inactivo"}</StatusBadge>}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link className={buttonVariants({ variant: "outline" })} href={`/suppliers/${supplier.id}/edit`}>
              Editar
            </Link>
            <Link className={buttonVariants()} href={`/expenses?supplierId=${supplier.id}`}>
              Registrar gasto
            </Link>
          </div>
        }
      />

      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Facturas recibidas" value={activity.metrics.invoiceCount} helper={`Total ${formatMoney(activity.metrics.totalInvoiced, supplier.currencyCode)}`} />
        <MetricCard label="Pendiente" value={formatMoney(activity.metrics.outstandingAmount, supplier.currencyCode)} helper="Saldo acreedor abierto" tone={activity.metrics.outstandingAmount > 0 ? "warning" : "success"} />
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

      <PageSection title="Facturas recientes" description="Últimas facturas de gasto o compra recibidas de este proveedor.">
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-3">Número</th>
                <th className="p-3">Origen</th>
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
                  <td className="p-3">{invoice.supplierDocumentNumber ?? invoice.number}</td>
                  <td className="p-3">{invoice.origin === "EXPENSE" ? "Gasto" : "Compra"}</td>
                  <td className="p-3">{formatDate(invoice.issueDate)}</td>
                  <td className="p-3">{invoice.paymentStatus}</td>
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
              <div className="flex items-center justify-between rounded-md border p-3" key={order.id}>
                <span>{order.number}</span>
                <span className="text-muted-foreground">{order.status} · {formatDate(order.createdAt)}</span>
              </div>
            ))}
          </div>
        </PageSection>
        <PageSection title="Pagos recientes" description="Últimos pagos aplicados a facturas del proveedor.">
          <div className="space-y-2 text-sm">
            {activity.payments.length === 0 ? <p className="text-muted-foreground">Sin pagos registrados.</p> : activity.payments.map((payment) => (
              <div className="flex items-center justify-between rounded-md border p-3" key={payment.id}>
                <span>{formatDate(payment.postedAt)}</span>
                <span className="font-medium">{formatMoney(payment.amount, supplier.currencyCode)}</span>
              </div>
            ))}
          </div>
        </PageSection>
      </section>
    </PageShell>
  );
}
