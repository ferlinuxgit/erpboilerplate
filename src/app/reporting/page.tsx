import Link from "next/link";

import { ReportingExportButton } from "@/components/reporting/reporting-export-button";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { EmptyState, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { requireContext } from "@/lib/current-context";
import { getReportingPeriodRanges, listKpis, type ReportingPeriod } from "@/server/reporting/service";

const reportingSources = [
  { href: "/customers", label: "Clientes", description: "Segmenta ventas y riesgo por cartera." },
  { href: "/suppliers", label: "Proveedores", description: "Revisa compras, gastos y terceros acreedores." },
  { href: "/invoices", label: "Facturas", description: "Revisa facturación, vencimientos y cobros." },
  { href: "/treasury", label: "Tesorería", description: "Contrasta caja y bancos antes de exportar." },
  { href: "/dashboard", label: "Panel", description: "Vuelve al cockpit para priorizar siguientes pasos." },
] as const;

const periodOptions = [
  { value: "month", label: "Este mes" },
  { value: "quarter", label: "Trimestre actual" },
  { value: "year", label: "Ejercicio activo" },
] as const;

function latestByMetric(rows: Awaited<ReturnType<typeof listKpis>>) {
  const result = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!result.has(row.metricKey)) result.set(row.metricKey, row);
  return result;
}

function metricLabel(value: string) {
  const normalized = value.replaceAll("_", " ").replaceAll("-", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function metricHref(value: string) {
  const key = value.toLowerCase();
  if (key.includes("customer") || key.includes("cliente")) return "/customers";
  if (key.includes("supplier") || key.includes("proveedor") || key.includes("purchase")) return "/suppliers";
  if (key.includes("cash") || key.includes("bank") || key.includes("caja") || key.includes("cobro")) return "/treasury";
  if (key.includes("stock") || key.includes("inventory") || key.includes("inventario")) return "/inventory";
  return "/invoices";
}

export default async function ReportingPage({ searchParams }: { searchParams?: Promise<{ period?: string | string[] }> }) {
  const ctx = await requireContext("reporting.read");
  const query = await searchParams;
  const requestedPeriod = Array.isArray(query?.period) ? query.period[0] : query?.period;
  const period: ReportingPeriod = requestedPeriod === "quarter" || requestedPeriod === "year" ? requestedPeriod : "month";
  const ranges = getReportingPeriodRanges(period);
  const [currentRows, previousRows] = await Promise.all([listKpis(ctx.company.id, ranges.current), listKpis(ctx.company.id, ranges.previous)]);
  const kpis = [...latestByMetric(currentRows).values()];
  const previousByMetric = latestByMetric(previousRows);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operación"
        title="Informes y BI"
        description="Indicadores accionables del espacio activo para revisar salud comercial, caja y módulos de origen."
        backHref="/dashboard"
        backLabel="Volver al panel"
      />
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)]">
        <PageSection title="KPIs operativos" description="Valida las señales contra sus módulos de origen antes de exportar." contentClassName="space-y-5">
            <form action="/reporting" className="grid gap-4 rounded-lg border bg-muted/30 p-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.2fr)] md:items-end">
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
                Indicadores calculados del espacio activo. Corte del {ranges.current.start.toLocaleDateString("es-ES")} al {new Date(ranges.current.end.getTime() - 1).toLocaleDateString("es-ES")}; cada tarjeta abre el módulo que origina el dato.
              </p>
            </form>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="reporting-kpi-cards">
              {kpis.length === 0 ? (
                <EmptyState className="sm:col-span-2 xl:col-span-3" title="Sin métricas calculadas aún" description="Crea clientes, facturas y cobros para que el reporting sustituya esta guía por indicadores reales." />
              ) : (
                kpis.map((kpi) => (
                  <MetricCard
                    key={kpi.id}
                    label={metricLabel(kpi.metricKey)}
                    value={kpi.metricValue.toString()}
                    helper={previousByMetric.has(kpi.metricKey) ? `Periodo anterior: ${previousByMetric.get(kpi.metricKey)?.metricValue.toString()}` : `Capturado: ${kpi.capturedAt.toLocaleDateString("es-ES")}`}
                    href={metricHref(kpi.metricKey)}
                  />
                ))
              )}
            </div>
        </PageSection>

        <PageSection title="Exportación" description="Genera un Excel con estado visible antes de volver al panel." contentClassName="space-y-3">
          <ReportingExportButton period={period} />
        </PageSection>
      </section>

      <PageSection title="Drill-down recomendado" description="Si un KPI no cuadra, vuelve al módulo fuente antes de compartir el informe." contentClassName="grid gap-3 md:grid-cols-4">
        <div className="contents" data-testid="reporting-source-links">
          {reportingSources.map((source) => (
            <Link className="rounded-lg border p-4 hover:border-primary hover:bg-muted/50" href={source.href} key={source.href}>
              <span className="font-semibold">{source.label}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{source.description}</span>
            </Link>
          ))}
        </div>
      </PageSection>
    </PageShell>
  );
}
