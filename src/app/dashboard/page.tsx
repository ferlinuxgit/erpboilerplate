import { eq } from "drizzle-orm";
import Link from "next/link";
import { ArrowRight, CheckCircle, Circle } from "@phosphor-icons/react/dist/ssr";

import { SignOutButton } from "@/components/sign-out-button";
import { buttonVariants } from "@/components/ui/button";
import { MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
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
      <PageHeader
        eyebrow="Vista general"
        title={`Buenos días, ${session.user.name.split(" ")[0]}`}
        description={`Actividad de ${tenantContext.company.name} en el ejercicio ${tenantContext.fiscalYear.code}.`}
        meta={<StatusBadge tone="success">{cockpit.stateLabel}</StatusBadge>}
        actions={<><Link className={buttonVariants({ variant: "outline" })} href="/customers/new">Nuevo cliente</Link><Link className={buttonVariants()} href="/invoices/new">Nueva factura</Link></>}
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="dashboard-metrics">
        {cockpit.metricCards.map((metric) => (
          <Link className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring" href={metric.href} key={metric.label}>
            <MetricCard label={metric.label} value={metric.value} helper={metric.helper} className="h-full group-hover:-translate-y-0.5 group-hover:border-primary/35" />
          </Link>
        ))}
      </section>

      <PageSection title="Acciones prioritarias" description="Atajos calculados según el estado actual de la empresa." contentClassName="grid gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-3" data-testid="dashboard-primary-actions">
        {cockpit.primaryActions.map((action) => (
          <Link className="group bg-card p-5 transition-colors hover:bg-accent" href={action.href} key={`${action.href}-${action.title}`}>
            <span className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{action.eyebrow}</span>
            <div className="mt-7 flex items-end justify-between gap-3">
              <div><h2 className="font-semibold">{action.title}</h2><p className="mt-1 text-sm text-muted-foreground">{action.description}</p></div>
              <ArrowRight aria-hidden="true" className="size-5 shrink-0 transition-transform group-hover:translate-x-1" />
            </div>
          </Link>
        ))}
      </PageSection>

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

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(20rem,0.7fr)]">
        <PageSection title="Ruta operativa" description="Primeros pasos conectados a datos reales del espacio activo." contentClassName="space-y-2" data-testid="dashboard-guided-demo">
            {cockpit.guidedDemoSteps.map((step) => (
              <div
                className={`rounded-xl border p-4 ${step.isNext ? "border-primary/40 bg-primary/5" : step.completed ? "bg-muted/40" : "border-dashed"}`}
                key={step.step}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground">
                      Paso {step.step} · {step.completed ? "Completado" : step.isNext ? "Siguiente" : "Pendiente"}
                    </p>
                    <h2 className="mt-1 font-semibold">{step.title}</h2>
                  </div>
                  {step.completed ? <CheckCircle aria-hidden="true" className="size-5 text-primary" weight="fill" /> : step.isNext ? <ArrowRight aria-hidden="true" className="size-5 text-primary" /> : <Circle aria-hidden="true" className="size-5 text-muted-foreground" />}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{step.description}</p>
                {!step.completed ? (
                  <Link className={buttonVariants({ className: "mt-3", variant: step.isNext ? "default" : "secondary" })} href={step.href}>
                    {step.actionLabel}
                  </Link>
                ) : null}
              </div>
            ))}
        </PageSection>

        <div className="space-y-4">
        <PageSection title="Siguientes pasos" description="Tareas que aún necesitan datos." contentClassName="space-y-3" data-testid="dashboard-empty-states">
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
        </PageSection>

        <PageSection title="Contexto activo" description="Empresa y permisos de esta sesión." contentClassName="space-y-3 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2"><dt className="text-muted-foreground">Usuario</dt><dd className="text-right font-medium">{session.user.name}</dd><dt className="text-muted-foreground">Empresa</dt><dd className="text-right font-medium">{tenantContext.company.name}</dd><dt className="text-muted-foreground">Ejercicio</dt><dd className="text-right font-medium">{tenantContext.fiscalYear.code}</dd><dt className="text-muted-foreground">Rol</dt><dd className="text-right font-medium">{tenantContext.membership.role}</dd></dl>
            <SignOutButton />
        </PageSection>
        </div>
      </section>

      <PageSection title="Todos los módulos" description="Acceso directo al resto de áreas." contentClassName="flex flex-wrap gap-2">
            {[{ href: "/customers", label: "Clientes" }, { href: "/suppliers", label: "Proveedores" }, { href: "/sales", label: "Ventas" }, { href: "/invoices", label: "Facturas" }, { href: "/purchases", label: "Compras" }, { href: "/inventory", label: "Inventario" }, ...moduleLinks].map((moduleLink) => (
              <Link className={buttonVariants({ variant: "outline" })} href={moduleLink.href} key={moduleLink.href}>{moduleLink.label}</Link>
            ))}
      </PageSection>
    </PageShell>
  );
}
