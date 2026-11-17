import { formatMoney } from "@/lib/format";

export type SessionSummaryView = {
  sales: { count: number; total: number; cash: number; card: number };
  refunds: { count: number; total: number; cash: number; card: number };
  cashIn: number;
  cashOut: number;
  tips?: number;
  openingCash: number;
  expectedCash: number;
  taxBreakdown: Array<{ rate: number; base: number; tax: number }>;
  netTotal: number;
  byWaiter?: Array<{ name: string; tickets: number; total: number; tips: number }>;
  voids?: { count: number; total: number; lines: Array<{ description: string; quantity: number; amount: number; reason: string | null; table: string; waiterName: string | null; approvedByName: string | null; at: string }> };
};

/** Informe de caja (X en curso, Z al cerrar): ventas, devoluciones, efectivo y desglose de IVA. */
export function SessionReport({ compact = false, countedCash, currencyCode, difference, summary }: { compact?: boolean; countedCash?: number | null; currencyCode: string; difference?: number | null; summary: SessionSummaryView }) {
  const money = (value: number) => formatMoney(value, currencyCode);
  return (
    <div className={compact ? "grid gap-3" : "grid gap-3 md:grid-cols-2"} data-testid="pos-session-report">
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border border-window-shadow p-2 text-sm">
        <dt className="col-span-2 font-mono text-xs font-bold uppercase">Ventas</dt>
        <dt>Tickets</dt><dd className="text-right font-mono">{summary.sales.count}</dd>
        <dt>Total vendido</dt><dd className="text-right font-mono font-bold">{money(summary.sales.total)}</dd>
        <dt className="pl-2 text-muted-foreground">En efectivo</dt><dd className="text-right font-mono">{money(summary.sales.cash)}</dd>
        <dt className="pl-2 text-muted-foreground">Con tarjeta</dt><dd className="text-right font-mono">{money(summary.sales.card)}</dd>
        <dt>Devoluciones ({summary.refunds.count})</dt><dd className="text-right font-mono">−{money(summary.refunds.total)}</dd>
        <dt className="font-bold">Ventas netas</dt><dd className="text-right font-mono font-bold" data-testid="pos-net-total">{money(summary.netTotal)}</dd>
        {summary.tips ? <><dt className="text-muted-foreground">Propinas con tarjeta (aparte)</dt><dd className="text-right font-mono" data-testid="pos-tips">{money(summary.tips)}</dd></> : null}
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
        <table className={compact ? "w-full border border-window-shadow text-sm" : "w-full border border-window-shadow text-sm md:col-span-2"}>
          <caption className="p-1 text-left font-mono text-xs font-bold uppercase">Desglose de IVA (ventas netas)</caption>
          <thead><tr className="bg-window-panel text-left font-mono text-xs"><th className="p-1">Tipo</th><th className="p-1 text-right">Base</th><th className="p-1 text-right">Cuota</th><th className="p-1 text-right">Total</th></tr></thead>
          <tbody>
            {summary.taxBreakdown.map((row) => (
              <tr className="border-t border-window-shadow" key={row.rate}><td className="p-1">{row.rate} %</td><td className="p-1 text-right font-mono">{money(row.base)}</td><td className="p-1 text-right font-mono">{money(row.tax)}</td><td className="p-1 text-right font-mono">{money(row.base + row.tax)}</td></tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {summary.byWaiter && summary.byWaiter.length > 0 ? (
        <table className={compact ? "w-full border border-window-shadow text-sm" : "w-full border border-window-shadow text-sm md:col-span-2"} data-testid="pos-report-waiters">
          <caption className="p-1 text-left font-mono text-xs font-bold uppercase">Por camarero</caption>
          <thead><tr className="bg-window-panel text-left font-mono text-xs"><th className="p-1">Camarero</th><th className="p-1 text-right">Tickets</th><th className="p-1 text-right">Vendido</th><th className="p-1 text-right">Propinas</th></tr></thead>
          <tbody>
            {summary.byWaiter.map((row) => (
              <tr className="border-t border-window-shadow" key={row.name}><td className="p-1">{row.name}</td><td className="p-1 text-right font-mono">{row.tickets}</td><td className="p-1 text-right font-mono">{money(row.total)}</td><td className="p-1 text-right font-mono">{money(row.tips)}</td></tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {summary.voids && summary.voids.count > 0 ? (
        <div className={compact ? "border border-window-shadow p-2 text-sm" : "border border-window-shadow p-2 text-sm md:col-span-2"} data-testid="pos-report-voids">
          <p className="flex justify-between font-mono text-xs font-bold uppercase"><span>Anulado tras enviar a cocina o barra ({summary.voids.count})</span><span>{money(summary.voids.total)}</span></p>
          <ul className="mt-1 divide-y divide-window-shadow">
            {summary.voids.lines.map((line, index) => (
              <li className="py-1" key={index}>
                <span className="flex justify-between gap-2"><span><span className="font-mono font-bold">{line.quantity.toLocaleString("es-ES")}</span> {line.description} · {line.table}</span><span className="font-mono">{money(line.amount)}</span></span>
                <span className="block text-xs text-muted-foreground">{new Date(line.at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}{line.waiterName ? ` · ${line.waiterName}` : ""}{line.approvedByName ? ` · autorizó ${line.approvedByName}` : ""}{line.reason ? ` · «${line.reason}»` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
