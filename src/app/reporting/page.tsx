import Link from "next/link";

import { ReportingExportButton } from "@/components/reporting/reporting-export-button";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { requireUserSession } from "@/lib/current-user";
import { ensureUserTenant } from "@/lib/tenant";
import { listKpis } from "@/server/reporting/service";

const reportingSources = [
  { href: "/customers", label: "Clientes", description: "Segmenta ventas y riesgo por cartera." },
  { href: "/invoices", label: "Facturas", description: "Revisa facturación, vencimientos y cobros." },
  { href: "/treasury", label: "Tesorería", description: "Contrasta caja y bancos antes de exportar." },
  { href: "/dashboard", label: "Dashboard", description: "Vuelve al cockpit para priorizar siguientes pasos." },
] as const;

const periodOptions = [
  { value: "month", label: "Este mes" },
  { value: "quarter", label: "Trimestre actual" },
  { value: "year", label: "Ejercicio activo" },
] as const;

export default async function ReportingPage() {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const kpis = await listKpis(ctx.company.id);

  return (
    <main className="container mx-auto space-y-6 px-4 py-10">
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)]">
        <Card>
          <CardHeader className="space-y-3">
            <div className="rounded-full border bg-muted px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground w-fit">
              Reporting operativo
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Reporting y BI</h1>
              <CardDescription>
                KPIs accionables del tenant activo para revisar salud comercial, caja y siguientes módulos de origen.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 rounded-lg border bg-muted/30 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <div className="space-y-2">
                <Label htmlFor="reporting-period">Periodo del informe</Label>
                <select
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  defaultValue="month"
                  id="reporting-period"
                  name="period"
                >
                  {periodOptions.map((period) => (
                    <option key={period.value} value={period.value}>
                      {period.label}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-sm text-muted-foreground" data-testid="reporting-kpi-explanation">
                KPIs calculados del tenant activo para el periodo seleccionado. Empieza por Este mes, valida la señal contra los módulos
                de origen y exporta el Excel cuando necesites compartir el corte.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="reporting-kpi-cards">
              {kpis.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 sm:col-span-2 xl:col-span-3">
                  <h2 className="font-semibold">Sin métricas calculadas aún</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Crea clientes, facturas y cobros para que el reporting sustituya esta guía por indicadores reales.
                  </p>
                </div>
              ) : (
                kpis.map((kpi) => (
                  <article className="rounded-lg border p-4" key={kpi.id}>
                    <p className="text-sm text-muted-foreground">{kpi.metricKey}</p>
                    <p className="mt-2 text-2xl font-semibold">{kpi.metricValue.toString()}</p>
                    <p className="mt-2 text-xs text-muted-foreground">Capturado: {kpi.capturedAt.toLocaleDateString("es-ES")}</p>
                  </article>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Exportación</CardTitle>
            <CardDescription>Genera un Excel con estado visible antes de volver al cockpit.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ReportingExportButton />
            <Link className={buttonVariants({ variant: "outline" })} href="/dashboard">
              Volver al dashboard
            </Link>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Drill-down recomendado</CardTitle>
          <CardDescription>Si un KPI no cuadra, vuelve al módulo fuente antes de compartir el informe.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4" data-testid="reporting-source-links">
          {reportingSources.map((source) => (
            <Link className="rounded-lg border p-4 hover:border-primary hover:bg-muted/50" href={source.href} key={source.href}>
              <span className="font-semibold">{source.label}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{source.description}</span>
            </Link>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
