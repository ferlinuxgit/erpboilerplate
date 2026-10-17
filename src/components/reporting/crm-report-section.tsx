import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { MetricCard, PageSection } from "@/components/ui/page";
import { formatMoney } from "@/lib/format";
import { crmSourceLabels, type CrmSource } from "@/modules/crm/model";
import type { getCrmReport } from "@/server/crm/service";

/** Informes → CRM: previsión de cierre por mes, embudo abierto y lo cerrado en los últimos 90 días. */
export function CrmReportSection({ currencyCode, report }: { currencyCode: string; report: Awaited<ReturnType<typeof getCrmReport>> }) {
  const money = (value: number) => formatMoney(value, currencyCode);
  const { forecast, closed } = report;
  const hasOpen = report.stages.some((stage) => stage.count > 0);
  return (
    <PageSection description="Oportunidades abiertas por mes de cierre previsto (total y ponderado por la probabilidad de su etapa) y resultados de los últimos 90 días." title="CRM: previsión de ventas">
      <div className="space-y-3" data-testid="reporting-crm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard helper="Suma de oportunidades abiertas × probabilidad." href="/crm" label="Previsión ponderada" value={money(report.stages.reduce((sum, stage) => sum + stage.weighted, 0))} />
          <MetricCard helper={`${closed.wonCount} oportunidades en 90 días.`} href="/crm/opportunities?status=WON" label="Ganado (90 días)" tone={closed.wonCount > 0 ? "success" : "neutral"} value={money(closed.wonAmount)} />
          <MetricCard helper={`${closed.lostCount} perdidas en 90 días.`} href="/crm/opportunities?status=LOST" label="Perdido (90 días)" value={money(closed.lostAmount)} />
          <MetricCard helper="De las cerradas en 90 días, cuántas se ganaron." label="Ratio de cierre" value={closed.winRate === null ? "—" : `${closed.winRate} %`} />
        </div>
        {hasOpen ? (
          <TimeSeriesChart
            categories={forecast.months}
            currencyCode={currencyCode}
            kind="bars"
            series={[
              { key: "total", label: "Importe abierto", color: "var(--chart-2)", values: forecast.total },
              { key: "weighted", label: "Ponderado", color: "var(--chart-income)", values: forecast.weighted },
            ]}
            testId="reporting-crm-forecast"
            title="Previsión de cierre por mes"
            valueLabel="Importe sin IVA"
          />
        ) : <p className="text-sm text-muted-foreground">No hay oportunidades abiertas.</p>}
        {forecast.noDate.total > 0 || forecast.later > 0 ? (
          <p className="text-xs text-muted-foreground">
            {forecast.noDate.total > 0 ? `Sin fecha de cierre: ${money(forecast.noDate.total)} (ponderado ${money(forecast.noDate.weighted)}). ` : ""}
            {forecast.later > 0 ? `Más adelante: ${money(forecast.later)}.` : ""}
          </p>
        ) : null}
        <div className="grid gap-3 lg:grid-cols-3">
          <table className="w-full border border-window-shadow text-sm">
            <caption className="p-1 text-left font-mono text-xs font-bold uppercase">Embudo abierto</caption>
            <thead><tr className="bg-window-panel text-left font-mono text-xs"><th className="p-1">Etapa</th><th className="p-1 text-right">Nº</th><th className="p-1 text-right">Importe</th></tr></thead>
            <tbody>{report.stages.map((stage) => <tr className="border-t border-window-shadow" key={stage.id}><td className="p-1">{stage.name} <span className="text-xs text-muted-foreground">{stage.probability} %</span></td><td className="p-1 text-right font-mono">{stage.count}</td><td className="p-1 text-right font-mono">{money(stage.amount)}</td></tr>)}</tbody>
          </table>
          <table className="w-full border border-window-shadow text-sm">
            <caption className="p-1 text-left font-mono text-xs font-bold uppercase">Por qué se pierden (90 días)</caption>
            <tbody>
              {closed.lostReasons.length === 0 ? <tr><td className="p-1 text-xs text-muted-foreground">Ninguna perdida.</td></tr> : closed.lostReasons.map((row) => <tr className="border-t border-window-shadow" key={row.reason}><td className="p-1">{row.reason}</td><td className="p-1 text-right font-mono">{row.count}</td><td className="p-1 text-right font-mono">{money(row.amount)}</td></tr>)}
            </tbody>
          </table>
          <table className="w-full border border-window-shadow text-sm">
            <caption className="p-1 text-left font-mono text-xs font-bold uppercase">Ganado por origen (90 días)</caption>
            <tbody>
              {closed.wonBySource.length === 0 ? <tr><td className="p-1 text-xs text-muted-foreground">Aún nada ganado.</td></tr> : closed.wonBySource.map((row) => <tr className="border-t border-window-shadow" key={row.source || "none"}><td className="p-1">{row.source ? crmSourceLabels[row.source as CrmSource] ?? row.source : "Sin indicar"}</td><td className="p-1 text-right font-mono">{row.count}</td><td className="p-1 text-right font-mono">{money(row.amount)}</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
    </PageSection>
  );
}
