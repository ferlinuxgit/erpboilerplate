import Link from "next/link";

import { ReportingExportButton } from "@/components/reporting/reporting-export-button";
import { Label } from "@/components/ui/label";
import { EmptyState, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { requireContext } from "@/lib/current-context";
import { listKpis } from "@/server/reporting/service";

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

export default async function ReportingPage() {
  const ctx = await requireContext("reporting.read");
  const kpis = await listKpis(ctx.company.id);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operación"
        title="Informes y BI"
        description="KPIs accionables del tenant activo para revisar salud comercial, caja y siguientes módulos de origen."
        backHref="/dashboard"
        backLabel="Volver al panel"
      />
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)]">
        <PageSection title="KPIs operativos" description="Valida las señales contra sus módulos de origen antes de exportar." contentClassName="space-y-5">
            <div className="grid gap-4 rounded-lg border bg-muted/30 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <div className="space-y-2">
                <Label htmlFor="reporting-period">Periodo del informe</Label>
                <Select
                  className="h-9"
                  defaultValue="month"
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
              <p className="text-sm text-muted-foreground" data-testid="reporting-kpi-explanation">
                KPIs calculados del tenant activo para el periodo seleccionado. Empieza por Este mes, valida la señal contra los módulos
                de origen y exporta el Excel cuando necesites compartir el corte.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="reporting-kpi-cards">
              {kpis.length === 0 ? (
                <EmptyState className="sm:col-span-2 xl:col-span-3" title="Sin métricas calculadas aún" description="Crea clientes, facturas y cobros para que el reporting sustituya esta guía por indicadores reales." />
              ) : (
                kpis.map((kpi) => (
                  <MetricCard key={kpi.id} label={kpi.metricKey} value={kpi.metricValue.toString()} helper={`Capturado: ${kpi.capturedAt.toLocaleDateString("es-ES")}`} />
                ))
              )}
            </div>
        </PageSection>

        <PageSection title="Exportación" description="Genera un Excel con estado visible antes de volver al panel." contentClassName="space-y-3">
          <ReportingExportButton />
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
