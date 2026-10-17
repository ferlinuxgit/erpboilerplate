import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PrintButton } from "@/components/pos/print-button";
import { SessionReport, type SessionSummaryView } from "@/components/pos/session-report";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireContext } from "@/lib/current-context";
import { formatDateTime, formatMoney } from "@/lib/format";
import { getSession } from "@/server/pos/service";

export const metadata: Metadata = { title: "TPV · Informe de caja" };

export default async function PosSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("pos.read");
  const detail = await getSession(ctx.company.id, (await params).id);
  if (!detail) notFound();
  const { session, tickets, movements } = detail;
  const summary = detail.summary as SessionSummaryView;
  const currency = ctx.company.baseCurrencyCode;
  const closed = session.status === "CLOSED";
  return (
    <PageShell>
      <PageHeader
        actions={<PrintButton />}
        breadcrumbs={[{ label: "TPV", href: "/pos?choose=1" }, { label: "Cierres", href: "/pos/sessions" }, { label: session.registerName }]}
        description={`Apertura ${formatDateTime(session.openedAt)}${session.closedAt ? ` · cierre ${formatDateTime(session.closedAt)}` : ""}`}
        meta={<StatusBadge tone={closed ? "neutral" : "success"}>{closed ? "Cerrada" : "Abierta"}</StatusBadge>}
        title={`${closed ? "Informe Z" : "Informe X"} · ${session.registerName}`}
      />
      <PageSection title="Resumen">
        <SessionReport countedCash={session.countedCash === null ? null : Number(session.countedCash)} currencyCode={currency} difference={session.difference === null ? null : Number(session.difference)} summary={summary} />
        {session.closingNotes ? <p className="mt-2 text-sm"><strong>Notas:</strong> {session.closingNotes}</p> : null}
        {(session.closingReport as { differencePosted?: boolean } | null)?.differencePosted ? <p className="mt-1 text-xs text-muted-foreground">La diferencia se contabilizó (678/778 contra caja 570).</p> : null}
      </PageSection>
      {movements.length > 0 ? (
        <PageSection title="Entradas y salidas de efectivo">
          <ul className="divide-y divide-window-shadow border border-window-shadow text-sm">
            {movements.map((movement) => <li className="flex justify-between p-2" key={movement.id}><span>{movement.type === "IN" ? "Entrada" : "Salida"} · {movement.reason}{movement.bankAccountId ? <span className="text-xs text-muted-foreground"> · traspaso con banco (contabilizado)</span> : null}</span><span className="font-mono">{movement.type === "OUT" ? "−" : ""}{formatMoney(movement.amount, currency)}</span></li>)}
          </ul>
        </PageSection>
      ) : null}
      <PageSection title={`Tickets (${tickets.length})`}>
        <ul className="divide-y divide-window-shadow border border-window-shadow text-sm">
          {tickets.map((ticket) => (
            <li className="flex flex-wrap justify-between gap-2 p-2" key={ticket.id}>
              <span><Link className="font-mono font-bold text-link hover:underline" href={`/invoices/${ticket.invoiceId}`}>{ticket.number}</Link> <span className="text-xs text-muted-foreground">{formatDateTime(ticket.createdAt)}{ticket.kind === "REFUND" ? " · devolución" : ""}</span></span>
              <span className="font-mono">{ticket.kind === "REFUND" ? "−" : ""}{formatMoney(ticket.totalAmount, currency)}</span>
            </li>
          ))}
        </ul>
      </PageSection>
    </PageShell>
  );
}
