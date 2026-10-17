import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState, PageHeader, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireContext } from "@/lib/current-context";
import { formatDateTime, formatMoney } from "@/lib/format";
import { listSessions } from "@/server/pos/service";

export const metadata: Metadata = { title: "TPV · Cierres de caja" };

export default async function PosSessionsPage() {
  const ctx = await requireContext("pos.read");
  const sessions = await listSessions(ctx.company.id);
  const currency = ctx.company.baseCurrencyCode;
  return (
    <PageShell>
      <PageHeader description="Turnos de caja con su informe de cierre (Z) y el arqueo." title="Cierres de caja" />
      {sessions.length === 0 ? <EmptyState description="Cuando abras y cierres una caja, su informe aparecerá aquí." title="Sin turnos" /> : (
        <div className="overflow-x-auto border border-window-shadow">
          <table className="w-full text-sm" data-testid="pos-sessions-table">
            <thead className="bg-window-panel text-left font-mono text-xs uppercase"><tr><th className="p-2">Caja</th><th className="p-2">Apertura</th><th className="p-2">Cierre</th><th className="p-2 text-right">Ventas netas</th><th className="p-2 text-right">Diferencia</th><th className="p-2">Estado</th></tr></thead>
            <tbody>
              {sessions.map((session) => {
                const report = session.closingReport as { netTotal?: number } | null;
                const difference = session.difference === null ? null : Number(session.difference);
                return (
                  <tr className="border-t border-window-shadow" key={session.id}>
                    <td className="p-2"><Link className="font-semibold text-link hover:underline" href={`/pos/sessions/${session.id}`}>{session.registerName}</Link></td>
                    <td className="p-2 text-xs">{formatDateTime(session.openedAt)}<span className="block text-muted-foreground">{session.openedByName ?? ""}</span></td>
                    <td className="p-2 text-xs">{session.closedAt ? formatDateTime(session.closedAt) : "—"}</td>
                    <td className="p-2 text-right font-mono">{report?.netTotal !== undefined ? formatMoney(report.netTotal, currency) : "—"}</td>
                    <td className={`p-2 text-right font-mono ${difference ? "font-bold text-destructive" : ""}`}>{difference === null ? "—" : formatMoney(difference, currency)}</td>
                    <td className="p-2"><StatusBadge tone={session.status === "OPEN" ? "success" : "neutral"}>{session.status === "OPEN" ? "Abierta" : "Cerrada"}</StatusBadge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
