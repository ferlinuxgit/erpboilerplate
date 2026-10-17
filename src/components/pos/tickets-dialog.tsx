"use client";

import { ArrowUUpLeft, MagnifyingGlass, Printer } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDateTime, formatMoney } from "@/lib/format";

import { openTicketPrint, type PosTicketView } from "./types";

type FoundTicket = { id: string; invoiceId: string; number: string; totalAmount: string; createdAt: string };

/** Tickets del turno (reimprimir, devolver) y búsqueda de tickets de otros días para devolverlos. */
export function TicketsDialog({ currencyCode, onClose, open, registerId, tickets }: { currencyCode: string; onClose: () => void; open: boolean; registerId: string; tickets: PosTicketView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<FoundTicket[] | null>(null);

  async function refund(ticketId: string, number: string) {
    const reason = window.prompt(`Devolver el ticket ${number} completo. Motivo (opcional):`, "");
    if (reason === null) return;
    setBusy(ticketId);
    try {
      const response = await fetch(`/api/pos/tickets/${ticketId}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ registerId, reason: reason || null }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo hacer la devolución."));
      const result = await response.json() as { number: string; cash: number; card: number };
      const parts = [result.cash > 0 ? `${formatMoney(result.cash, currencyCode)} en efectivo` : null, result.card > 0 ? `${formatMoney(result.card, currencyCode)} en la tarjeta` : null].filter(Boolean).join(" y ");
      toast.success(`Devolución ${result.number}: devuelve ${parts}.`);
      setFound(null);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error, "No se pudo hacer la devolución."));
    } finally {
      setBusy(null);
    }
  }

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    const response = await fetch(`/api/pos/tickets?q=${encodeURIComponent(query.trim())}`);
    setFound(response.ok ? await response.json() as FoundTicket[] : []);
  }

  return (
    <Dialog description="Reimprime o devuelve tickets. Una devolución hace la factura rectificativa y devuelve el dinero por donde se cobró." onClose={onClose} open={open} size="lg" title="Tickets">
      <div className="space-y-3" data-testid="pos-tickets-dialog">
        <form className="flex gap-2" onSubmit={search}>
          <Input aria-label="Buscar ticket por número" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar ticket de otro día (número)" value={query} />
          <Button type="submit" variant="outline"><MagnifyingGlass aria-hidden="true" /> Buscar</Button>
        </form>
        {found ? (
          <ul className="divide-y divide-window-shadow border border-window-shadow">
            {found.length === 0 ? <li className="p-2 text-xs text-muted-foreground">Sin resultados.</li> : null}
            {found.map((ticket) => (
              <li className="flex items-center justify-between gap-2 p-2 text-sm" key={ticket.id}>
                <span><span className="font-mono font-bold">{ticket.number}</span> <span className="text-xs text-muted-foreground">{formatDateTime(ticket.createdAt)}</span></span>
                <span className="flex items-center gap-1">
                  <span className="font-mono">{formatMoney(ticket.totalAmount, currencyCode)}</span>
                  <Button disabled={busy === ticket.id} onClick={() => void refund(ticket.id, ticket.number)} size="sm" type="button" variant="outline"><ArrowUUpLeft aria-hidden="true" /> Devolver</Button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <h3 className="font-mono text-xs font-bold uppercase">Este turno ({tickets.length})</h3>
        <ul className="max-h-[50vh] divide-y divide-window-shadow overflow-y-auto border border-window-shadow">
          {tickets.length === 0 ? <li className="p-2 text-xs text-muted-foreground">Aún no hay tickets en este turno.</li> : null}
          {tickets.map((ticket) => (
            <li className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm" data-testid={`pos-ticket-${ticket.number}`} key={ticket.id}>
              <span className="flex items-center gap-2">
                <span className="font-mono font-bold">{ticket.number}</span>
                {ticket.kind === "REFUND" ? <StatusBadge tone="warning">Devolución</StatusBadge> : ticket.refunded ? <StatusBadge tone="neutral">Devuelto</StatusBadge> : null}
                <span className="text-xs text-muted-foreground">{formatDateTime(ticket.createdAt)} · {ticket.cardAmount > 0 && ticket.cashAmount > 0 ? "Mixto" : ticket.cardAmount > 0 ? "Tarjeta" : "Efectivo"}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="font-mono font-bold">{ticket.kind === "REFUND" ? "−" : ""}{formatMoney(ticket.totalAmount, currencyCode)}</span>
                <Button aria-label={`Imprimir ${ticket.number}`} onClick={() => openTicketPrint(ticket.invoiceId)} size="icon-sm" type="button" variant="ghost"><Printer aria-hidden="true" /></Button>
                {ticket.kind === "SALE" && !ticket.refunded ? (
                  <Button data-testid={`pos-refund-${ticket.number}`} disabled={busy === ticket.id} onClick={() => void refund(ticket.id, ticket.number)} size="sm" type="button" variant="outline"><ArrowUUpLeft aria-hidden="true" /> Devolver</Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
