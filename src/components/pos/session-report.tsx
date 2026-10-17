import { formatMoney } from "@/lib/format";

export type SessionSummaryView = {
  sales: { count: number; total: number; cash: number; card: number };
  refunds: { count: number; total: number; cash: number; card: number };
  cashIn: number;
  cashOut: number;
  openingCash: number;
  expectedCash: number;
  taxBreakdown: Array<{ rate: number; base: number; tax: number }>;
  netTotal: number;
};

/** Informe de caja (X en curso, Z al cerrar): ventas, devoluciones, efectivo y desglose de IVA. */
export function SessionReport({ countedCash, currencyCode, difference, summary }: { countedCash?: number | null; currencyCode: string; difference?: number | null; summary: SessionSummaryView }) {
  const money = (value: number) => formatMoney(value, currencyCode);
  return (
    <div className="grid gap-3 md:grid-cols-2" data-testid="pos-session-report">
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border border-window-shadow p-2 text-sm">
        <dt className="col-span-2 font-mono text-xs font-bold uppercase">Ventas</dt>
        <dt>Tickets</dt><dd className="text-right font-mono">{summary.sales.count}</dd>
        <dt>Total vendido</dt><dd className="text-right font-mono font-bold">{money(summary.sales.total)}</dd>
        <dt className="pl-2 text-muted-foreground">En efectivo</dt><dd className="text-right font-mono">{money(summary.sales.cash)}</dd>
        <dt className="pl-2 text-muted-foreground">Con tarjeta</dt><dd className="text-right font-mono">{money(summary.sales.card)}</dd>
        <dt>Devoluciones ({summary.refunds.count})</dt><dd className="text-right font-mono">−{money(summary.refunds.total)}</dd>
        <dt className="font-bold">Ventas netas</dt><dd className="text-right font-mono font-bold" data-testid="pos-net-total">{money(summary.netTotal)}</dd>
      </dl>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border border-window-shadow p-2 text-sm">
        <dt className="col-span-2 font-mono text-xs font-bold uppercase">Efectivo en caja</dt>
        <dt>Fondo inicial</dt><dd className="text-right font-mono">{money(summary.openingCash)}</dd>
        <dt>+ Cobros en efectivo</dt><dd className="text-right font-mono">{money(summary.sales.cash)}</dd>
        <dt>− Devoluciones en efectivo</dt><dd className="text-right font-mono">{money(summary.refunds.cash)}</dd>
        <dt>+ Entradas / − salidas</dt><dd className="text-right font-mono">{money(summary.cashIn - summary.cashOut)}</dd>
        <dt className="font-bold">Debería haber</dt><dd className="text-right font-mono font-bold" data-testid="pos-expected-cash">{money(summary.expectedCash)}</dd>
        {countedCash !== undefined && countedCash !== null ? (
          <>
            <dt>Contado</dt><dd className="text-right font-mono">{money(countedCash)}</dd>
            <dt className="font-bold">Diferencia</dt><dd className={`text-right font-mono font-bold ${difference && difference !== 0 ? "text-destructive" : "text-success-text"}`} data-testid="pos-difference">{money(difference ?? 0)}</dd>
          </>
        ) : null}
      </dl>
      {summary.taxBreakdown.length > 0 ? (
        <table className="w-full border border-window-shadow text-sm md:col-span-2">
          <caption className="p-1 text-left font-mono text-xs font-bold uppercase">Desglose de IVA (ventas netas)</caption>
          <thead><tr className="bg-window-panel text-left font-mono text-xs"><th className="p-1">Tipo</th><th className="p-1 text-right">Base</th><th className="p-1 text-right">Cuota</th><th className="p-1 text-right">Total</th></tr></thead>
          <tbody>
            {summary.taxBreakdown.map((row) => (
              <tr className="border-t border-window-shadow" key={row.rate}><td className="p-1">{row.rate} %</td><td className="p-1 text-right font-mono">{money(row.base)}</td><td className="p-1 text-right font-mono">{money(row.tax)}</td><td className="p-1 text-right font-mono">{money(row.base + row.tax)}</td></tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
