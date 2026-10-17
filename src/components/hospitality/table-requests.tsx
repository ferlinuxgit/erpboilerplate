"use client";

import { BellRinging, HandWaving, Receipt } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { formatMoney } from "@/lib/format";

import { postJson, type FloorTable, type TableRequest } from "./types";

const LABEL: Record<TableRequest["kind"], string> = { ORDER: "Pedido", CALL: "Llama", BILL: "Cuenta" };

/** Dos notas cortas: alguien pide algo desde su mesa. */
export function playChime() {
  try {
    const context = new AudioContext();
    for (const [index, frequency] of [660, 990].entries()) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.value = 0.12;
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(context.currentTime + index * 0.18);
      oscillator.stop(context.currentTime + index * 0.18 + 0.15);
    }
  } catch {
    // Sin audio: queda el aviso visual.
  }
}

/** Aviso en la mesa: pedido, llamada o cuenta pedidos desde el QR. */
export function RequestBadge({ requests }: { requests: TableRequest[] }) {
  if (requests.length === 0) return null;
  const kinds = [...new Set(requests.map((request) => request.kind))];
  return (
    <span className="absolute -top-3 left-1 z-10 flex items-center gap-0.5 bg-destructive px-1.5 py-0.5 font-mono text-xs font-black uppercase text-destructive-foreground shadow" data-testid="pos-table-request">
      <BellRinging aria-hidden="true" className="size-3.5" weight="fill" />{kinds.map((kind) => LABEL[kind]).join(" · ")}
    </span>
  );
}

/** Atender lo que pide una mesa: aceptar o rechazar su pedido, o marcar atendida la llamada. */
export function RequestsDialog({ currencyCode, onClose, onGoToTable, onHandled, registerId, table, waiterUserId }: { currencyCode: string; onClose: () => void; onGoToTable: () => void; onHandled: (orderId: string | null) => void; registerId: string; table: FloorTable; waiterUserId: string | null }) {
  const [pending, setPending] = useState(false);
  async function handle(request: TableRequest, action: "ACCEPT" | "REJECT" | "DONE") {
    setPending(true);
    try {
      const result = await postJson<{ orderId: string | null }>(`/api/pos/hospitality/requests/${request.id}`, { action, registerId, waiterUserId });
      toast.success(action === "ACCEPT" ? "Pedido añadido a la cuenta: revísalo y envíalo a cocina." : action === "REJECT" ? "Pedido rechazado." : "Atendido.");
      onHandled(action === "ACCEPT" ? result.orderId : null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo atender.");
      setPending(false);
    }
  }
  return (
    <Dialog description="Desde el código QR de la mesa." onClose={onClose} open title={`${table.name}: te necesitan`}>
      <div className="space-y-3" data-testid="pos-requests-dialog">
        {table.requests.map((request) => (
          <section className="space-y-2 border-2 border-destructive p-2" key={request.id}>
            <p className="flex items-center gap-1.5 font-mono text-sm font-black">
              {request.kind === "ORDER" ? <Receipt aria-hidden="true" className="size-5" /> : request.kind === "BILL" ? <Receipt aria-hidden="true" className="size-5" /> : <HandWaving aria-hidden="true" className="size-5" />}
              {request.kind === "ORDER" ? "Quieren pedir" : request.kind === "BILL" ? "Piden la cuenta" : "Llaman al camarero"}
              <span className="font-normal text-muted-foreground">· {new Date(request.createdAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</span>
            </p>
            {request.kind === "ORDER" ? (
              <>
                <ul className="divide-y divide-window-shadow text-sm">
                  {request.items.map((item, index) => <li className="flex justify-between gap-2 py-1" key={index}><span><strong className="font-mono">{item.quantity}×</strong> {item.name}{item.note ? <span className="block text-xs italic text-link">{item.note}</span> : null}</span><span className="font-mono tabular-nums">{formatMoney(item.price * item.quantity, currencyCode)}</span></li>)}
                </ul>
                <div className="grid grid-cols-2 gap-2">
                  <Button className="h-12" data-testid="pos-request-reject" disabled={pending} onClick={() => void handle(request, "REJECT")} type="button" variant="outline">Rechazar</Button>
                  <Button className="h-12" data-testid="pos-request-accept" disabled={pending} onClick={() => void handle(request, "ACCEPT")} type="button">Aceptar pedido</Button>
                </div>
              </>
            ) : (
              <Button className="h-12 w-full" data-testid="pos-request-done" disabled={pending} onClick={() => void handle(request, "DONE")} type="button">Atendido</Button>
            )}
          </section>
        ))}
        <Button className="h-12 w-full" onClick={onGoToTable} type="button" variant="ghost">Ir a la mesa</Button>
      </div>
    </Dialog>
  );
}
