import Link from "next/link";

import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { MetricCard, PageSection } from "@/components/ui/page";
import { formatMoney, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { financePeriodOptions } from "@/server/reporting/dashboard-model";
import type { DashboardFinance } from "@/server/reporting/dashboard";

function signedPercent(value: number) {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatPercent(Math.abs(value))}`;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Financial KPIs and 12-month charts, computed with SQL aggregates ("Qué hacer hoy" lives in `today-panel.tsx`). */
export function FinancialOverview({ finance, currencyCode }: { finance: DashboardFinance; currencyCode: string }) {
  const money = (value: number) => formatMoney(value, currencyCode);
  const period = financePeriodOptions.find((option) => option.value === finance.period) ?? financePeriodOptions[0];
  const salesHelper =
    finance.sales.change === null
      ? `Sin ventas en el ${period.previousLabel} para comparar.`
      : `${signedPercent(finance.sales.change)} frente al ${period.previousLabel} (${money(finance.sales.previous)}).`;
  const periodInvoicesHref = `/invoices?from=${dateKey(finance.ranges.current.start)}&to=${dateKey(new Date(finance.ranges.current.end.getTime() - 1))}`;
  const aging = finance.receivables.aging;
  const maxBucket = Math.max(...aging.buckets.map((bucket) => bucket.amount), 0);
  const vatToPay = finance.vat.result >= 0;

  return (
    <section aria-labelledby="dashboard-finance-title" className="space-y-2" data-testid="dashboard-finance">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-mono text-sm font-bold" id="dashboard-finance-title">
            Situación financiera
          </h2>
          <p className="text-xs text-muted-foreground">Importes sin IVA salvo cobros, pagos y bancos. Cada tarjeta abre el detalle.</p>
        </div>
        <nav aria-label="Periodo de los indicadores">
          <ul className="flex gap-px border border-window-dark-shadow bg-window-dark-shadow">
            {financePeriodOptions.map((option) => (
              <li key={option.value}>
                <Link
                  aria-current={option.value === finance.period ? "page" : undefined}
                  className={cn(
                    "block px-2.5 py-1 font-mono text-xs font-bold focus-visible:relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                    option.value === finance.period ? "bg-primary text-primary-foreground" : "bg-window-surface text-window-text hover:bg-window-highlight",
                  )}
                  href={option.value === "month" ? "/dashboard" : `/dashboard?period=${option.value}`}
                  scroll={false}
                >
                  {option.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" data-testid="dashboard-finance-kpis">
        <MetricCard
          helper={salesHelper}
          href={periodInvoicesHref}
          label={`Ventas facturadas · ${period.label.toLocaleLowerCase()}`}
          tone={finance.sales.change !== null && finance.sales.change < 0 ? "warning" : "neutral"}
          value={money(finance.sales.current)}
        />
        <MetricCard
          helper={
            aging.overdue > 0
              ? `${money(aging.overdue)} ya vencido · ${aging.count} ${aging.count === 1 ? "factura" : "facturas"} abiertas.`
              : aging.count > 0
                ? `${aging.count} ${aging.count === 1 ? "factura" : "facturas"} abiertas, ninguna vencida.`
                : "No hay facturas pendientes de cobro."
          }
          href={aging.overdue > 0 ? "/invoices?due=overdue" : "/invoices"}
          label="Cobros pendientes"
          tone={aging.overdue > 0 ? "warning" : "neutral"}
          value={money(aging.total)}
        />
        <MetricCard
          helper={
            finance.payables.count === 0
              ? "No hay facturas de proveedor pendientes de pago."
              : `${finance.payables.count} ${finance.payables.count === 1 ? "factura" : "facturas"} · ${money(finance.payables.dueSoonAmount)} vencen en los próximos 7 días o ya han vencido.`
          }
          href="/expenses"
          label="Pagos pendientes a proveedores"
          tone={finance.payables.overdueAmount > 0 ? "warning" : "neutral"}
          value={money(finance.payables.amount)}
        />
        <MetricCard
          helper="Saldo contable de las cuentas de bancos (grupo 57), con todos los movimientos registrados."
          href="/treasury"
          label="Saldo en bancos"
          tone={finance.bank.balance < 0 ? "danger" : "neutral"}
          value={money(finance.bank.balance)}
        />
        <MetricCard
          helper={`IVA repercutido ${money(finance.vat.outputVat)} − soportado deducible ${money(finance.vat.inputVat)}. ${vatToPay ? "A ingresar" : "A compensar"} (estimación; el 303 definitivo está en Fiscalidad).`}
          href="/fiscal"
          label={`IVA estimado · ${finance.vat.label}`}
          tone={vatToPay && finance.vat.result > 0 ? "info" : "neutral"}
          value={money(finance.vat.result)}
        />
        <MetricCard
          helper={`Ventas ${money(finance.sales.current)} − compras y gastos ${money(finance.expenses.current)}${finance.grossMargin.pct !== null ? ` · ${formatPercent(finance.grossMargin.pct)} de las ventas` : ""}.`}
          label="Margen bruto aproximado"
          tone={finance.grossMargin.amount < 0 ? "danger" : "neutral"}
          value={money(finance.grossMargin.amount)}
        />
      </div>

      <div className="grid gap-2 xl:grid-cols-[minmax(0,1.6fr)_minmax(18rem,1fr)]">
        <PageSection
          contentClassName="space-y-4"
          description="Últimos 12 meses. Pasa el ratón o usa las flechas sobre el gráfico para ver cada mes."
          title="Ventas frente a gastos"
        >
          <TimeSeriesChart
            categories={finance.months}
            currencyCode={currencyCode}
            kind="bars"
            series={[
              { key: "sales", label: "Ventas", color: "var(--chart-income)", values: finance.monthly.sales },
              { key: "expenses", label: "Compras y gastos", color: "var(--chart-expense)", values: finance.monthly.expenses },
            ]}
            testId="dashboard-sales-expenses-chart"
            title="Ventas frente a compras y gastos por mes"
            valueLabel="Importes sin IVA"
          />
          {finance.bank.hasMovements ? (
            <TimeSeriesChart
              categories={finance.months}
              currencyCode={currencyCode}
              height={180}
              kind="line"
              series={[{ key: "cash", label: "Saldo en bancos", color: "var(--chart-cash)", values: finance.bank.series }]}
              testId="dashboard-cash-chart"
              title="Evolución del saldo en bancos a fin de mes"
              valueLabel="Saldo en bancos a fin de mes"
            />
          ) : (
            <p className="border border-dashed border-window-dark-shadow p-2.5 text-xs text-muted-foreground">
              La evolución del saldo en bancos aparecerá cuando registres cobros, pagos o movimientos bancarios.{" "}
              <Link className="font-semibold text-primary underline" href="/treasury">
                Ir a tesorería
              </Link>
            </p>
          )}
        </PageSection>

        <PageSection
          contentClassName="space-y-2"
          description="Importe pendiente según los días que llevan vencidas las facturas."
          title="Antigüedad de los cobros"
        >
          <dl className="space-y-1.5" data-testid="dashboard-receivables-aging">
            {aging.buckets.map((bucket) => (
              <div key={bucket.key}>
                <div className="flex items-baseline justify-between gap-2 font-mono text-xs">
                  <dt className={cn(bucket.key === "d90_plus" && bucket.amount > 0 && "font-bold")}>
                    {bucket.label}
                    <span className="text-muted-foreground"> · {bucket.count}</span>
                  </dt>
                  <dd className="font-bold tabular-nums">{money(bucket.amount)}</dd>
                </div>
                <div aria-hidden="true" className="mt-0.5 h-1.5 rounded-[2px] bg-window-panel">
                  <div
                    className="h-full rounded-[2px]"
                    style={{
                      width: maxBucket > 0 ? `${Math.max(bucket.amount > 0 ? 2 : 0, (bucket.amount / maxBucket) * 100)}%` : "0%",
                      background: bucket.key === "current" ? "var(--chart-income)" : "var(--chart-expense)",
                    }}
                  />
                </div>
              </div>
            ))}
          </dl>
          <p className="font-mono text-[0.7rem] text-muted-foreground">Total pendiente: {money(aging.total)}</p>
        </PageSection>
      </div>

    </section>
  );
}
