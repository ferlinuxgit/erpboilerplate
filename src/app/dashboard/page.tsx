import { eq } from "drizzle-orm";
import Link from "next/link";

import { SignOutButton } from "@/components/sign-out-button";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page";
import { customer, deliveryNote, invoice, invoicePayment, item, salesOrder, salesQuote, stockLocation } from "@/db/schema";
import { buildDashboardCockpit, type DashboardCockpitInput } from "@/lib/dashboard-cockpit";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { ensureUserTenant } from "@/lib/tenant";

const moduleLinks = [
  { href: "/accounting", label: "Contabilidad" },
  { href: "/treasury", label: "Tesorería" },
  { href: "/fiscal", label: "Fiscal" },
  { href: "/reporting", label: "Informes" },
  { href: "/billing", label: "Suscripción" },
  { href: "/settings/api-keys", label: "API" },
  { href: "/settings/security", label: "Seguridad" },
];

function toNumber(value: string | number) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

type DashboardDataResult = {
  input: DashboardCockpitInput;
  dashboardDataError: boolean;
};

const emptyDashboardInput: DashboardCockpitInput = {
  customers: [],
  salesQuotes: [],
  salesOrders: [],
  deliveryNotes: [],
  invoices: [],
  invoicePayments: [],
  lowStockAlerts: [],
  inventoryItemsCount: 0,
};

async function loadDashboardData(companyId: string): Promise<DashboardDataResult> {
  try {
    const [customers, salesQuotes, salesOrders, deliveryNotes, invoices, invoicePayments, items, stockLocations] = await Promise.all([
      db.select({ status: customer.status }).from(customer).where(eq(customer.companyId, companyId)),
      db.select({ status: salesQuote.status }).from(salesQuote).where(eq(salesQuote.companyId, companyId)),
      db.select({ status: salesOrder.status }).from(salesOrder).where(eq(salesOrder.companyId, companyId)),
      db.select({ status: deliveryNote.status }).from(deliveryNote).where(eq(deliveryNote.companyId, companyId)),
      db
        .select({ id: invoice.id, dueDate: invoice.dueDate, paymentStatus: invoice.paymentStatus, totalAmount: invoice.totalAmount })
        .from(invoice)
        .where(eq(invoice.companyId, companyId)),
      db
        .select({ invoiceId: invoicePayment.invoiceId, amountApplied: invoicePayment.amountApplied })
        .from(invoicePayment)
        .where(eq(invoicePayment.companyId, companyId)),
      db
        .select({ id: item.id, name: item.name, sku: item.sku, isService: item.isService, minimumStock: item.minimumStock })
        .from(item)
        .where(eq(item.companyId, companyId)),
      db
        .select({ itemId: stockLocation.itemId, currentQuantity: stockLocation.currentQuantity })
        .from(stockLocation)
        .where(eq(stockLocation.companyId, companyId)),
    ]);

    const stockByItemId = stockLocations.reduce<Record<string, number>>((totals, location) => {
      totals[location.itemId] = (totals[location.itemId] ?? 0) + toNumber(location.currentQuantity);
      return totals;
    }, {});
    const lowStockAlerts = items
      .filter((stockItem) => !stockItem.isService)
      .map((stockItem) => ({
        itemName: stockItem.name,
        itemSku: stockItem.sku,
        quantity: stockByItemId[stockItem.id] ?? 0,
        minimumStock: stockItem.minimumStock,
      }))
      .filter((stockItem) => toNumber(stockItem.minimumStock) > 0 && toNumber(stockItem.quantity) <= toNumber(stockItem.minimumStock));

    return {
      dashboardDataError: false,
      input: {
        customers,
        salesQuotes,
        salesOrders,
        deliveryNotes,
        invoices,
        invoicePayments,
        lowStockAlerts,
        inventoryItemsCount: items.length,
      },
    };
  } catch {
    return {
      dashboardDataError: true,
      input: emptyDashboardInput,
    };
  }
}

export default async function DashboardPage() {
  const session = await requireUserSession();

  const tenantContext = await ensureUserTenant({
    id: session.user.id,
    name: session.user.name,
  });
  const companyId = tenantContext.company.id;
  const { dashboardDataError, input } = await loadDashboardData(companyId);
  const cockpit = buildDashboardCockpit(input);

  return (
    <PageShell>
      <section className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border bg-muted px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {cockpit.stateLabel}
              </span>
              <span className="text-sm text-muted-foreground">Tenant activo: {tenantContext.tenant.name}</span>
            </div>
            <div>
              <CardTitle>Panel ERP SaaS</CardTitle>
              <CardDescription>Tu cockpit operativo para pasar de demo a datos reales: clientes, ventas, facturas y stock.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="dashboard-metrics">
              {cockpit.metricCards.map((metric) => (
                <Link
                  className="rounded-lg border p-4 transition-colors hover:border-primary hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  href={metric.href}
                  key={metric.label}
                >
                  <p className="text-sm text-muted-foreground">{metric.label}</p>
                  <p className="mt-2 text-3xl font-semibold">{metric.value}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{metric.helper}</p>
                </Link>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-3" data-testid="dashboard-primary-actions">
              {cockpit.primaryActions.map((action) => (
                <Link className="rounded-lg border p-4 hover:border-primary hover:bg-muted/50" href={action.href} key={`${action.href}-${action.title}`}>
                  <span className="text-xs font-semibold uppercase text-muted-foreground">{action.eyebrow}</span>
                  <h2 className="mt-2 text-base font-semibold">{action.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{action.description}</p>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contexto activo</CardTitle>
            <CardDescription>Sesión y empresa usada para todos los indicadores.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Usuario: {session.user.name}</p>
            <p>Email: {session.user.email}</p>
            <p>Empresa activa: {tenantContext.company.name}</p>
            <p>Ejercicio activo: {tenantContext.fiscalYear.code}</p>
            <p>Rol: {tenantContext.membership.role}</p>
            <SignOutButton />
          </CardContent>
        </Card>
      </section>

      {dashboardDataError ? (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="status">
          No se pudieron cargar todos los indicadores del cockpit. Mostramos una ruta segura de primeros pasos para mantener el panel operativo.
        </section>
      ) : null}

      {cockpit.alerts.length > 0 ? (
        <section className="grid gap-3 md:grid-cols-2" aria-label="Alertas operativas">
          {cockpit.alerts.map((alert) => (
            <Link
              className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950 hover:bg-amber-100"
              href={alert.href}
              key={alert.title}
            >
              <p className="text-sm font-semibold">{alert.title}</p>
              <p className="mt-1 text-sm">{alert.description}</p>
            </Link>
          ))}
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Demo guiada</CardTitle>
            <CardDescription>Ruta de primeros pasos conectada a datos reales del tenant.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3" data-testid="dashboard-guided-demo">
            {cockpit.guidedDemoSteps.map((step) => (
              <div
                className={`rounded-lg border p-4 ${step.isNext ? "border-primary bg-primary/5" : step.completed ? "bg-muted/50" : "border-dashed"}`}
                key={step.step}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground">
                      Paso {step.step} · {step.completed ? "Completado" : step.isNext ? "Siguiente" : "Pendiente"}
                    </p>
                    <h2 className="mt-1 font-semibold">{step.title}</h2>
                  </div>
                  <span aria-hidden="true" className="text-lg">
                    {step.completed ? "✓" : step.isNext ? "→" : "○"}
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{step.description}</p>
                {!step.completed ? (
                  <Link className={buttonVariants({ className: "mt-3", variant: step.isNext ? "default" : "secondary" })} href={step.href}>
                    {step.actionLabel}
                  </Link>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Estados vacíos y siguientes pasos</CardTitle>
            <CardDescription>Acciones concretas para sustituir la demo por operación diaria.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3" data-testid="dashboard-empty-states">
            {cockpit.emptyStates.map((state) => (
              <div className="rounded-lg border border-dashed p-4" key={state.title}>
                <h2 className="font-semibold">{state.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{state.description}</p>
                <Link className={buttonVariants({ className: "mt-3", variant: "secondary" })} href={state.href}>
                  {state.actionLabel}
                </Link>
              </div>
            ))}
            {cockpit.emptyStates.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Los módulos principales ya tienen señales operativas. Revisa alertas, cobros y reporting para priorizar.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Módulos disponibles</CardTitle>
            <CardDescription>Acceso rápido al resto del ERP.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Link className={buttonVariants({ variant: "secondary" })} href="/customers">
              Ir a clientes
            </Link>
            <Link className={buttonVariants({ variant: "secondary" })} href="/suppliers">
              Ir a proveedores
            </Link>
            <Link className={buttonVariants({ variant: "secondary" })} href="/sales">
              Ir a ciclo de ventas
            </Link>
            <Link className={buttonVariants({ variant: "secondary" })} href="/invoices">
              Ir a facturas
            </Link>
            <Link className={buttonVariants({ variant: "secondary" })} href="/purchases">
              Ir a compras
            </Link>
            <Link className={buttonVariants({ variant: "secondary" })} href="/inventory">
              Ir a inventario
            </Link>
            {moduleLinks.map((moduleLink) => (
              <Link className={buttonVariants({ variant: "secondary" })} href={moduleLink.href} key={moduleLink.href}>
                Ir a {moduleLink.label.toLowerCase()}
              </Link>
            ))}
          </CardContent>
        </Card>
      </section>
    </PageShell>
  );
}
