import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { MetricCard, PageSection } from "@/components/ui/page";
import { formatMoney } from "@/lib/format";
import type { getPosReport } from "@/server/pos/service";

/** Informes → TPV: ventas netas por día de los últimos 30 días, ticket medio, cobro y cajas. */
export function PosReportSection({ currencyCode, report }: { currencyCode: string; report: Awaited<ReturnType<typeof getPosReport>> }) {
  const money = (value: number) => formatMoney(value, currencyCode);
  return (
    <PageSection description="Ventas netas (ventas − devoluciones, IVA incluido) de los últimos 30 días." title="TPV: ventas en mostrador">
      <div className="space-y-3" data-testid="reporting-pos">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard helper={`${report.ticketCount} tickets y ${report.refundCount} devoluciones.`} href="/pos/sessions" label="Ventas netas (30 días)" value={money(report.netTotal)} />
          <MetricCard helper="Importe medio de un ticket de venta." label="Ticket medio" value={money(report.averageTicket)} />
          <MetricCard helper="Neto cobrado en efectivo (caja 570)." label="Efectivo" value={money(report.cash)} />
          <MetricCard helper="Neto cobrado con tarjeta (banco)." label="Tarjeta" value={money(report.card)} />
        </div>
        <TimeSeriesChart
          categories={report.categories}
          currencyCode={currencyCode}
          kind="bars"
          series={[{ key: "net", label: "Ventas netas", color: "var(--chart-income)", values: report.net }]}
          testId="reporting-pos-daily"
          title="Ventas netas del TPV por día"
          valueLabel="Importe con IVA"
        />
        {report.byRegister.length > 1 ? (
          <ul className="divide-y divide-window-shadow border border-window-shadow text-sm">
            {report.byRegister.map((register) => <li className="flex justify-between p-2" key={register.name}><span>{register.name}</span><span className="font-mono">{money(register.net)}</span></li>)}
          </ul>
        ) : null}
      </div>
    </PageSection>
  );
}
