import type { Metadata } from "next";
import Link from "next/link";

import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { ReportingExportButton } from "@/components/reporting/reporting-export-button";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { EmptyState, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { requireContext } from "@/lib/current-context";
import { formatDate, formatMoney, formatPercent } from "@/lib/format";
import { loadReportingKpis, type ReportingPeriod } from "@/server/reporting/service";

const reportingSources = [
  { href: "/customers", label: "Clientes", description: "Segmenta ventas y riesgo por cartera." },
  { href: "/suppliers", label: "Proveedores", description: "Revisa compras, gastos y terceros acreedores." },
  { href: "/invoices", label: "Facturas", description: "Revisa facturación, vencimientos y cobros." },
  { href: "/treasury", label: "Tesorería", description: "Contrasta caja y bancos antes de exportar." },
  { href: "/dashboard", label: "Panel", description: "Vuelve al panel para decidir los siguientes pasos." },
] as const;

const periodOptions = [
  { value: "month", label: "Este mes" },
  { value: "quarter", label: "Trimestre actual" },
  { value: "year", label: "Año en curso" },
] as const;

export const metadata: Metadata = { title: "Informes" };

export default async function ReportingPage({ searchParams }: { searchParams?: Promise<{ period?: string | string[] }> }) {
  const ctx = await requireContext("reporting.read");
  const query = await searchParams;
  const requestedPeriod = Array.isArray(query?.period) ? query.period[0] : query?.period;
  const period: ReportingPeriod = requestedPeriod === "quarter" || requestedPeriod === "year" ? requestedPeriod : "month";
  // Same SQL aggregates and indicator definitions as the dashboard and the Excel export.
  const { finance, kpis } = await loadReportingKpis(ctx.company.id, period, { countryCode: ctx.company.countryCode });
  const currencyCode = ctx.company.baseCurrencyCode;
  const money = (value: number) => formatMoney(value, currencyCode);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operación"
        title="Informes"
        description="Indicadores de ventas, gastos y caja de la empresa activa, con enlace al módulo de origen de cada dato."
        backHref="/dashboard"
        backLabel="Volver al panel"
      />
      <section className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)]">
        <PageSection title="Indicadores del periodo" description="Comprueba cada indicador en su módulo de origen antes de compartir el informe." contentClassName="space-y-3">
            <form action="/reporting" className="grid gap-4 rounded-[2px] border border-window-dark-shadow bg-window-panel p-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.2fr)] md:items-end" data-ignore-dirty-guard="true" method="get">
              <div className="space-y-2">
                <Label htmlFor="reporting-period">Periodo del informe</Label>
                <Select
                  className="h-9"
                  defaultValue={period}
                  id="reporting-period"
                  name="period"
                >
                  {periodOptions.map((period) => (
                    <option key={period.value} value={period.value}>
                      {period.label}
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit" variant="secondary">Aplicar periodo</Button>
              <p className="text-sm text-muted-foreground" data-testid="reporting-kpi-explanation">
                Indicadores calculados del espacio activo. Corte del {formatDate(finance.ranges.current.start)} al {formatDate(new Date(finance.ranges.current.end.getTime() - 1))}; cada tarjeta abre el módulo que origina el dato.
              </p>
            </form>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="reporting-kpi-cards">
              {!finance.hasData ? (
                <EmptyState className="sm:col-span-2 xl:col-span-3" title="Sin métricas calculadas aún" description="Crea clientes, facturas y cobros para ver aquí tus indicadores reales." />
              ) : (
                kpis.map((kpi) => (
                  <MetricCard
                    key={kpi.key}
                    label={kpi.label}
                    value={money(kpi.value)}
                    helper={
                      kpi.previous !== null
                        ? `Periodo anterior: ${money(kpi.previous)}${kpi.change !== null ? ` (${kpi.change > 0 ? "+" : ""}${formatPercent(kpi.change)})` : ""}. ${kpi.description}`
                        : kpi.description
                    }
                    href={kpi.href}
                  />
                ))
              )}
            </div>
        </PageSection>

        <PageSection title="Exportación" description="Genera un Excel con los mismos indicadores, la serie de 12 meses y la antigüedad de cobros." contentClassName="space-y-3">
          <ReportingExportButton period={period} />
        </PageSection>
      </section>

      {finance.hasData ? (
        <PageSection title="Ventas frente a gastos" description="Últimos 12 meses, importes sin IVA.">
          <TimeSeriesChart
            categories={finance.months}
            currencyCode={currencyCode}
            kind="bars"
            series={[
              { key: "sales", label: "Ventas", color: "var(--chart-income)", values: finance.monthly.sales },
              { key: "expenses", label: "Compras y gastos", color: "var(--chart-expense)", values: finance.monthly.expenses },
            ]}
            testId="reporting-sales-expenses-chart"
            title="Ventas frente a compras y gastos por mes"
            valueLabel="Importes sin IVA"
          />
        </PageSection>
      ) : null}

      <PageSection title="Revisar el origen de los datos" description="Si un indicador no cuadra, revisa el módulo del que sale antes de compartir el informe." contentClassName="grid gap-3 md:grid-cols-4">
        <div className="contents" data-testid="reporting-source-links">
          {reportingSources.map((source) => (
            <Link className="rounded-[2px] border p-3 hover:border-primary hover:bg-muted/50" href={source.href} key={source.href}>
              <span className="font-semibold">{source.label}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{source.description}</span>
            </Link>
          ))}
        </div>
      </PageSection>
    </PageShell>
  );
}
