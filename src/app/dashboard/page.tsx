import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle, Circle } from "@phosphor-icons/react/dist/ssr";

import { FinancialOverview } from "@/app/dashboard/financial-overview";
import { SignOutButton } from "@/components/sign-out-button";
import { buttonVariants } from "@/components/ui/button";
import { InlineAlert, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { buildDashboardCockpitFromSummary, type DashboardCockpitSummary } from "@/lib/dashboard-cockpit";
import { requireUserSession } from "@/lib/current-user";
import { logger } from "@/lib/logger";
import { can } from "@/lib/rbac";
import { roleLabels, statusLabel } from "@/lib/status-labels";
import { ensureUserTenant } from "@/lib/tenant";
import { loadCockpitSummary, loadDashboardFinance, type DashboardFinance } from "@/server/reporting/dashboard";
import { parseFinancePeriod, type FinancePeriod } from "@/server/reporting/dashboard-model";

export const metadata: Metadata = {
  title: "Panel",
};

function greetingFor(now: Date, timeZone = "Europe/Madrid") {
  const hour = Number(new Intl.DateTimeFormat("es-ES", { hour: "numeric", hourCycle: "h23", timeZone }).format(now));
  if (hour >= 6 && hour < 14) return "Buenos días";
  if (hour >= 14 && hour < 21) return "Buenas tardes";
  return "Buenas noches";
}

type DashboardDataResult = {
  summary: DashboardCockpitSummary;
  finance: DashboardFinance | null;
  dashboardDataError: boolean;
};

const emptyCockpitSummary: DashboardCockpitSummary = {
  activeCustomers: 0,
  salesInProgress: 0,
  invoiceCount: 0,
  unpaidInvoices: 0,
  overdueInvoices: 0,
  receivablesAmount: 0,
  lowStockAlerts: 0,
  hasRecordedPayment: false,
  inventoryItemsCount: 0,
};

/**
 * Every indicator is a SQL aggregate (counts, sums, group by month): the panel never loads a
 * company's invoices, payments, items or ledger lines into memory.
 */
async function loadDashboardData(
  companyId: string,
  options: { period: FinancePeriod; countryCode: string; includeFinance: boolean },
): Promise<DashboardDataResult> {
  try {
    const [summary, finance] = await Promise.all([
      loadCockpitSummary(companyId),
      options.includeFinance ? loadDashboardFinance(companyId, { period: options.period, countryCode: options.countryCode }) : Promise.resolve(null),
    ]);
    return { dashboardDataError: false, summary, finance };
  } catch (error) {
    logger.error({ err: error, companyId }, "dashboard.load_failed");
    return { dashboardDataError: true, summary: emptyCockpitSummary, finance: null };
  }
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ period?: string | string[] }> }) {
  const session = await requireUserSession();

  const tenantContext = await ensureUserTenant({
    id: session.user.id,
    name: session.user.name,
  });
  const companyId = tenantContext.company.id;
  const currencyCode = tenantContext.company.baseCurrencyCode;
  const period = parseFinancePeriod((await searchParams).period);
  const { dashboardDataError, summary, finance } = await loadDashboardData(companyId, {
    period,
    countryCode: tenantContext.company.countryCode,
    includeFinance: can(tenantContext.membership.role, "reporting.read"),
  });
  const cockpit = buildDashboardCockpitFromSummary(summary, currencyCode);
  const firstName = session.user.name.trim().split(/\s+/)[0] || session.user.name;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Vista general"
        title={`${greetingFor(new Date())}, ${firstName}`}
        description={`Actividad de ${tenantContext.company.name} en el ejercicio ${tenantContext.fiscalYear.code}.`}
        meta={<StatusBadge tone={cockpit.stateLabel === "Operación real" ? "success" : "info"}>{cockpit.stateLabel}</StatusBadge>}
        actions={<><Link className={buttonVariants({ variant: "outline" })} href="/customers/new">Nuevo cliente</Link><Link className={buttonVariants()} href="/invoices/new">Nueva factura</Link></>}
      />

      {dashboardDataError ? (
        <InlineAlert title="Indicadores incompletos" tone="warning">
          No se pudieron cargar todos los indicadores del cockpit. Mostramos una ruta segura de primeros pasos para mantener el panel operativo.
        </InlineAlert>
      ) : null}

      <section aria-label="Indicadores clave" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" data-testid="dashboard-metrics">
        {cockpit.metricCards.map((metric) => (
          <MetricCard className="h-full" helper={metric.helper} href={metric.href} key={metric.label} label={metric.label} tone={metric.tone} value={metric.value} />
        ))}
      </section>

      {/* Empty companies keep the guided path first; the financial section appears with the first invoice, expense or bank movement. */}
      {finance?.hasData ? <FinancialOverview currencyCode={currencyCode} finance={finance} /> : null}

      {cockpit.alerts.length > 0 ? (
        <section className="grid gap-2 md:grid-cols-2" aria-label="Alertas operativas">
          {cockpit.alerts.map((alert) => (
            <Link
              className={
                alert.tone === "critical"
                  ? "flex items-start justify-between gap-2 border border-destructive bg-destructive/10 p-2.5 text-destructive hover:bg-destructive/20"
                  : "flex items-start justify-between gap-2 border border-warning bg-warning/10 p-2.5 text-warning hover:bg-warning/20"
              }
              href={alert.href}
              key={alert.title}
            >
              <span>
                <span className="block font-mono text-xs font-bold">{alert.title}</span>
                <span className="mt-1 block text-xs text-foreground">{alert.description}</span>
              </span>
              <ArrowRight aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            </Link>
          ))}
        </section>
      ) : null}

      <PageSection title="Acciones prioritarias" description="Atajos calculados según el estado actual de la empresa." contentClassName="grid gap-px overflow-hidden bg-window-dark-shadow p-0 md:grid-cols-3" data-testid="dashboard-primary-actions">
        {cockpit.primaryActions.map((action) => (
          <Link className="group bg-card p-3 hover:bg-window-highlight focus-visible:relative focus-visible:z-10" href={action.href} key={`${action.href}-${action.title}`}>
            <span className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.06em] text-muted-foreground">{action.eyebrow}</span>
            <div className="mt-3 flex items-end justify-between gap-2">
              <div><h3 className="font-mono text-xs font-bold">{action.title}</h3><p className="mt-0.5 text-xs text-muted-foreground">{action.description}</p></div>
              <ArrowRight aria-hidden="true" className="size-4 shrink-0 transition-transform motion-safe:group-hover:translate-x-0.5" />
            </div>
          </Link>
        ))}
      </PageSection>

      <section className="grid gap-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
        <PageSection title="Ruta operativa" description="Primeros pasos conectados a datos reales del espacio activo." contentClassName="space-y-2" data-testid="dashboard-guided-demo">
            {cockpit.guidedDemoSteps.map((step) => (
              <div
                className={`border p-2.5 ${step.isNext ? "border-primary bg-primary/10" : step.completed ? "border-window-shadow bg-window-panel" : "border-dashed border-window-dark-shadow"}`}
                key={step.step}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-[0.65rem] font-bold uppercase text-muted-foreground">
                      Paso {step.step} · {step.completed ? "Completado" : step.isNext ? "Siguiente" : "Pendiente"}
                    </p>
                    <h3 className="mt-0.5 font-mono text-xs font-bold">{step.title}</h3>
                  </div>
                  {step.completed ? <CheckCircle aria-hidden="true" className="size-5 text-success" weight="fill" /> : step.isNext ? <ArrowRight aria-hidden="true" className="size-5 text-primary" /> : <Circle aria-hidden="true" className="size-5 text-muted-foreground" />}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{step.description}</p>
                {!step.completed ? (
                  <Link className={buttonVariants({ className: "mt-2", variant: step.isNext ? "default" : "secondary" })} href={step.href}>
                    {step.actionLabel}
                  </Link>
                ) : null}
              </div>
            ))}
        </PageSection>

        <div className="space-y-2">
        <PageSection title="Siguientes pasos" description="Tareas que aún necesitan datos." contentClassName="space-y-3" data-testid="dashboard-empty-states">
            {cockpit.emptyStates.map((state) => (
              <div className="border border-dashed border-window-dark-shadow p-2.5" key={state.title}>
                <h3 className="font-mono text-xs font-bold">{state.title}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{state.description}</p>
                <Link className={buttonVariants({ className: "mt-2", variant: "secondary" })} href={state.href}>
                  {state.actionLabel}
                </Link>
              </div>
            ))}
            {cockpit.emptyStates.length === 0 ? (
              <p className="border border-dashed border-window-dark-shadow p-2.5 text-xs text-muted-foreground">
                Los módulos principales ya tienen señales operativas. Revisa alertas, cobros y reporting para priorizar.
              </p>
            ) : null}
        </PageSection>

        <PageSection title="Contexto activo" description="Empresa y permisos de esta sesión." contentClassName="space-y-2 font-mono text-xs">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1"><dt className="text-muted-foreground">Usuario</dt><dd className="text-right font-bold">{session.user.name}</dd><dt className="text-muted-foreground">Empresa</dt><dd className="text-right font-bold">{tenantContext.company.name}</dd><dt className="text-muted-foreground">Ejercicio</dt><dd className="text-right font-bold">{tenantContext.fiscalYear.code}</dd><dt className="text-muted-foreground">Rol</dt><dd className="text-right font-bold">{statusLabel(roleLabels, tenantContext.membership.role)}</dd></dl>
            <SignOutButton />
        </PageSection>
        </div>
      </section>
    </PageShell>
  );
}
