import Link from "next/link";

import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { buttonVariants } from "@/components/ui/button";
import { InlineAlert, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/current-context";
import { formatDate, formatMoney } from "@/lib/format";
import type { RawSearchParams } from "@/lib/list-params";
import { getTreasuryForecast, type BalanceSource } from "@/server/treasury/forecast";
import { FORECAST_HORIZONS } from "@/server/treasury/forecast-model";

const sourceLabels: Record<BalanceSource, string> = {
  STATEMENT: "Según el último extracto",
  LEDGER: "Según la contabilidad",
  MOVEMENTS: "Suma de movimientos registrados",
};

const kindLabels = { receivable: "Cobro", payable: "Pago", recurring: "Periódico" } as const;

function shortDate(date: Date) {
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", timeZone: "UTC" }).format(date);
}

export default async function TreasuryForecastPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireContext("treasury.read");
  const params = await searchParams;
  const requested = Number(Array.isArray(params.h) ? params.h[0] : params.h);
  const horizon = (FORECAST_HORIZONS as readonly number[]).includes(requested) ? requested : 60;
  const { balances, forecast } = await getTreasuryForecast(ctx.company.id, { horizonDays: horizon });
  const currency = ctx.company.baseCurrencyCode;
  const lowestWeek = forecast.lowest.bucketIndex >= 0 ? forecast.buckets[forecast.lowest.bucketIndex] : null;
  const goesNegative = forecast.buckets.some((bucket) => bucket.closingBalance < 0);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Tesorería"
        title="Previsión de tesorería"
        description="¿Cuánto dinero tengo y tendré? Parte del saldo actual de tus bancos y suma los cobros y resta los pagos pendientes según su vencimiento."
        backHref="/treasury"
        backLabel="Volver al resumen"
        actions={
          <nav aria-label="Horizonte" className="flex gap-1">
            {FORECAST_HORIZONS.map((days) => (
              <Link
                aria-current={days === horizon ? "page" : undefined}
                className={buttonVariants({ size: "sm", variant: days === horizon ? "default" : "outline" })}
                href={`/treasury/forecast?h=${days}`}
                key={days}
              >
                {days} días
              </Link>
            ))}
          </nav>
        }
      />

      <section className="grid gap-3 md:grid-cols-5" data-testid="treasury-forecast-summary">
        <MetricCard label="Saldo hoy" value={formatMoney(forecast.openingBalance, currency)} helper={`${balances.length} ${balances.length === 1 ? "cuenta" : "cuentas"} activas`} />
        <MetricCard label="Cobros previstos" value={formatMoney(forecast.totals.inflow, currency)} helper={`Próximos ${horizon} días`} tone="success" />
        <MetricCard label="Pagos previstos" value={formatMoney(forecast.totals.outflow, currency)} helper={`Próximos ${horizon} días`} tone="warning" />
        <MetricCard label={`Saldo en ${horizon} días`} value={formatMoney(forecast.finalBalance, currency)} helper="Si todo se cobra y paga a su vencimiento" tone={forecast.finalBalance >= 0 ? "success" : "danger"} />
        <MetricCard
          label="Punto más bajo"
          value={formatMoney(forecast.lowest.balance, currency)}
          helper={lowestWeek ? `Semana del ${shortDate(lowestWeek.start)}` : "Hoy"}
          tone={forecast.lowest.balance >= 0 ? "neutral" : "danger"}
        />
      </section>

      {goesNegative ? (
        <InlineAlert tone="danger" title="Te puedes quedar en números rojos">
          Con lo previsto, el saldo baja de cero {lowestWeek ? `la semana del ${shortDate(lowestWeek.start)}` : "en el periodo"}. Adelanta cobros, aplaza algún pago o prevé financiación.
        </InlineAlert>
      ) : null}
      {forecast.overdue.count > 0 ? (
        <InlineAlert tone="warning">
          {forecast.overdue.count} {forecast.overdue.count === 1 ? "documento está vencido" : "documentos están vencidos"} y se cuentan en la primera semana
          ({formatMoney(forecast.overdue.inflow, currency)} por cobrar y {formatMoney(forecast.overdue.outflow, currency)} por pagar).
        </InlineAlert>
      ) : null}

      <PageSection title="Saldo previsto por semanas" description="Saldo al final de cada semana.">
        <TimeSeriesChart
          categories={forecast.buckets.map((bucket) => ({ label: shortDate(bucket.start), longLabel: `Semana del ${formatDate(bucket.start)} al ${formatDate(bucket.end)}` }))}
          currencyCode={currency}
          height={200}
          kind="line"
          series={[{ key: "balance", label: "Saldo previsto", color: "var(--chart-cash)", values: forecast.buckets.map((bucket) => bucket.closingBalance) }]}
          testId="treasury-forecast-chart"
          title="Saldo previsto al final de cada semana"
          valueLabel="Saldo previsto"
        />
      </PageSection>

      <PageSection title="Semana a semana" description="Abre una semana para ver qué documentos la componen.">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Semana</TableHead>
                <TableHead className="text-right">Entradas</TableHead>
                <TableHead className="text-right">Salidas</TableHead>
                <TableHead className="text-right">Saldo al final</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Hoy</TableCell>
                <TableCell />
                <TableCell />
                <TableCell className="text-right font-mono">{formatMoney(forecast.openingBalance, currency)}</TableCell>
              </TableRow>
              {forecast.buckets.map((bucket) => (
                <TableRow data-testid="treasury-forecast-week" key={bucket.index}>
                  <TableCell>
                    <details>
                      <summary className="cursor-pointer">
                        {formatDate(bucket.start)} – {formatDate(bucket.end)}
                        <span className="text-xs text-muted-foreground"> · {bucket.items.length} {bucket.items.length === 1 ? "documento" : "documentos"}</span>
                      </summary>
                      {bucket.items.length ? (
                        <ul className="mt-1 space-y-0.5 text-xs">
                          {bucket.items.map((item) => (
                            <li key={`${item.kind}-${item.id}`}>
                              {kindLabels[item.kind]}{" "}
                              {item.href ? <Link className="text-primary hover:underline" href={item.href}>{item.label}</Link> : item.label}
                              {" · "}{item.partnerName} · {item.dueDate ? formatDate(item.dueDate) : ""} · <span className="font-mono">{formatMoney(item.amount, currency)}</span>
                              {item.overdue ? <StatusBadge className="ml-1" tone="danger">Vencido</StatusBadge> : null}
                            </li>
                          ))}
                        </ul>
                      ) : <p className="mt-1 text-xs text-muted-foreground">Sin cobros ni pagos previstos.</p>}
                    </details>
                  </TableCell>
                  <TableCell className="text-right font-mono text-success">{bucket.inflow ? formatMoney(bucket.inflow, currency) : "—"}</TableCell>
                  <TableCell className="text-right font-mono">{bucket.outflow ? formatMoney(-bucket.outflow, currency) : "—"}</TableCell>
                  <TableCell className={bucket.closingBalance < 0 ? "text-right font-mono font-bold text-destructive" : "text-right font-mono font-bold"}>{formatMoney(bucket.closingBalance, currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {forecast.beyond.count > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">Además hay {forecast.beyond.count} documentos que vencen después ({formatMoney(forecast.beyond.net, currency)} netos).</p>
        ) : null}
      </PageSection>

      <PageSection title="Saldo de partida" description="De dónde sale el saldo de hoy de cada cuenta.">
        {balances.length ? (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {balances.map((account) => (
              <li className="border border-window-dark-shadow p-2" key={account.id}>
                <Link className="font-medium text-primary hover:underline" href={`/treasury/bank-accounts/${account.id}`}>{account.bankName}</Link>
                <p className="font-mono text-lg font-bold">{formatMoney(account.balance, currency)}</p>
                <p className="text-xs text-muted-foreground">{sourceLabels[account.source]}{account.asOf ? ` (${formatDate(account.asOf)})` : ""}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No hay cuentas bancarias activas: la previsión parte de 0. <Link className="text-primary underline" href="/treasury/bank-accounts/new">Crea tu cuenta</Link> e importa el extracto.</p>
        )}
      </PageSection>

      <PageSection title="Sin fecha de vencimiento" description="No se suman a la previsión hasta que tengan vencimiento. Añádelo para que la previsión sea fiable.">
        {forecast.undated.length ? (
          <ul className="space-y-1 text-sm" data-testid="treasury-forecast-undated">
            {forecast.undated.map((item) => (
              <li className="flex flex-wrap items-center gap-2" key={`${item.kind}-${item.id}`}>
                <StatusBadge tone={item.amount >= 0 ? "success" : "warning"}>{kindLabels[item.kind]}</StatusBadge>
                <span>{item.label} · {item.partnerName} · <span className="font-mono">{formatMoney(item.amount, currency)}</span></span>
                {item.href ? <Link className="text-primary underline" href={item.href}>Abrir para añadir el vencimiento</Link> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Todos los documentos pendientes tienen vencimiento.</p>
        )}
      </PageSection>
    </PageShell>
  );
}
