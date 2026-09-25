import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle, Circle } from "@phosphor-icons/react/dist/ssr";

import { FinancialOverview } from "@/app/dashboard/financial-overview";
import { TodayPanel } from "@/app/dashboard/today-panel";
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
import { getCompanySetupState, type CompanySetupState } from "@/server/onboarding/service";
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
  setup: CompanySetupState | null;
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
  options: { period: FinancePeriod; countryCode: string; fiscalYearId: string; includeFinance: boolean },
): Promise<DashboardDataResult> {
  try {
    const [summary, finance, setup] = await Promise.all([
      loadCockpitSummary(companyId),
      options.includeFinance ? loadDashboardFinance(companyId, { period: options.period, countryCode: options.countryCode }) : Promise.resolve(null),
      getCompanySetupState(companyId, options.fiscalYearId),
    ]);
    return { dashboardDataError: false, summary, finance, setup };
  } catch (error) {
    logger.error({ err: error, companyId }, "dashboard.load_failed");
    return { dashboardDataError: true, summary: emptyCockpitSummary, finance: null, setup: null };
  }
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ period?: string | string[] }> }) {
  const session = await requireUserSession();

  const tenantContext = await ensureUserTenant({
    id: session.user.id,
    name: session.user.name,
  });
  const role = tenantContext.membership.role;
  const companyId = tenantContext.company.id;
  const currencyCode = tenantContext.company.baseCurrencyCode;
  const period = parseFinancePeriod((await searchParams).period);
  const { dashboardDataError, summary, finance, setup } = await loadDashboardData(companyId, {
    period,
    countryCode: tenantContext.company.countryCode,
    fiscalYearId: tenantContext.fiscalYear.id,
    includeFinance: can(role, "reporting.read"),
  });
  const cockpit = buildDashboardCockpitFromSummary(summary, {
    currencyCode,
    businessType: setup?.businessType,
    setup: setup
      ? { missingCompanyFields: setup.readiness.missing, hasInvoiceSeries: Boolean(setup.invoiceSeries), hasBankAccount: setup.bankAccountCount > 0 }
      : undefined,
  });
  const canConfigure = can(role, "settings.manage");
  const checklist = cockpit.setupChecklist;
  const companyReady = setup ? setup.readiness.ready : true;
  const showChecklist = canConfigure && Boolean(setup) && !checklist.complete;
  const firstName = session.user.name.trim().split(/\s+/)[0] || session.user.name;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Vista general"
        title={`${greetingFor(new Date())}, ${firstName}`}
        description={`Actividad de ${tenantContext.company.name} en el ejercicio ${tenantContext.fiscalYear.code}.`}
        meta={<StatusBadge tone={cockpit.stateLabel === "Operación real" ? "success" : "info"}>{cockpit.stateLabel}</StatusBadge>}
        actions={
          can(role, "invoice.create") ? (
            <>
              <Link className={buttonVariants({ variant: "outline" })} href="/customers/new">Nuevo cliente</Link>
              <Link className={buttonVariants()} href="/invoices/new">Nueva factura</Link>
            </>
          ) : null
        }
      />

      {dashboardDataError ? (
        <InlineAlert title="Indicadores incompletos" tone="warning">
          No se pudieron cargar todos los indicadores del panel. Recarga la página en unos segundos; mientras tanto puedes seguir trabajando desde el menú.
        </InlineAlert>
      ) : null}

      {!companyReady && setup ? (
        <InlineAlert data-testid="dashboard-fiscal-banner" title="Completa tus datos fiscales" tone="warning">
          <p>Para que tus facturas sean válidas faltan: {setup.readiness.missing.join(", ")}.</p>
          {canConfigure ? (
            <Link className={buttonVariants({ className: "mt-2", size: "sm" })} href={setup.onboardingCompletedAt ? "/settings/company" : "/onboarding"}>
              Completar ahora
            </Link>
          ) : (
            <p className="mt-1">Avisa al propietario de la empresa para que los complete.</p>
          )}
        </InlineAlert>
      ) : null}

      {/* Una única guía: la puesta en marcha va primero hasta completarla; después, las acciones del día a día. */}
      {showChecklist ? (
        <PageSection
          actions={
            !setup?.onboardingCompletedAt ? (
              <Link className={buttonVariants({ size: "sm", variant: "outline" })} href="/onboarding">Asistente de configuración</Link>
            ) : null
          }
          contentClassName="space-y-2"
          data-testid="dashboard-setup-checklist"
          description={`${checklist.completedCount} de ${checklist.total} pasos completados. Cada paso abre la pantalla que lo resuelve.`}
          title="Puesta en marcha"
        >
          <div aria-hidden="true" className="h-1.5 border border-window-dark-shadow bg-window-panel">
            <div className="h-full bg-success" style={{ width: `${(checklist.completedCount / checklist.total) * 100}%` }} />
          </div>
          <ol className="space-y-1.5">
            {checklist.steps.map((step, index) => (
              <li
                className={`flex flex-wrap items-center justify-between gap-2 border p-2.5 ${step.isNext ? "border-primary bg-primary/10" : step.completed ? "border-window-shadow bg-window-panel" : "border-dashed border-window-dark-shadow"}`}
                key={step.key}
              >
                <div className="flex min-w-0 items-start gap-2">
                  {step.completed ? <CheckCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" weight="fill" /> : step.isNext ? <ArrowRight aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" /> : <Circle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />}
                  <div className="min-w-0">
                    <h3 className="font-mono text-xs font-bold">
                      {index + 1}. {step.title}
                      <span className="sr-only">{step.completed ? " (hecho)" : step.isNext ? " (siguiente paso)" : " (pendiente)"}</span>
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{step.description}</p>
                  </div>
                </div>
                {!step.completed ? (
                  <Link className={buttonVariants({ size: "sm", variant: step.isNext ? "default" : "secondary" })} href={step.href}>
                    {step.actionLabel}
                  </Link>
                ) : null}
              </li>
            ))}
          </ol>
        </PageSection>
      ) : null}

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

      <section aria-label="Indicadores clave" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" data-testid="dashboard-metrics">
        {cockpit.metricCards.map((metric) => (
          <MetricCard className="h-full" helper={metric.helper} href={metric.href} key={metric.label} label={metric.label} tone={metric.tone} value={metric.value} />
        ))}
      </section>

      {/* Plazos fiscales y tareas del día: para todos los roles y desde el primer día. */}
      {finance ? <TodayPanel currencyCode={currencyCode} finance={finance} /> : null}

      {!showChecklist && can(role, "invoice.create") ? (
        <PageSection title="Acciones frecuentes" description="Atajos a lo que más se hace en el día a día." contentClassName="grid gap-px overflow-hidden bg-window-dark-shadow p-0 md:grid-cols-2 xl:grid-cols-4" data-testid="dashboard-primary-actions">
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
      ) : null}

      {/* La sección financiera aparece con la primera factura, gasto o movimiento bancario. */}
      {finance?.hasData ? <FinancialOverview currencyCode={currencyCode} finance={finance} /> : null}

      <PageSection title="Tu sesión" description="Empresa, ejercicio y permisos con los que trabajas ahora." contentClassName="flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 sm:grid-cols-[auto_auto_auto_auto_auto_auto_auto_auto]">
          <dt className="text-muted-foreground">Usuario</dt><dd className="font-bold">{session.user.name}</dd>
          <dt className="text-muted-foreground">Empresa</dt><dd className="font-bold">{tenantContext.company.name}</dd>
          <dt className="text-muted-foreground">Ejercicio</dt><dd className="font-bold">{tenantContext.fiscalYear.code}</dd>
          <dt className="text-muted-foreground">Rol</dt><dd className="font-bold">{statusLabel(roleLabels, role)}</dd>
        </dl>
        <SignOutButton />
      </PageSection>
    </PageShell>
  );
}
