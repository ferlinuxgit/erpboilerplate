"use client";

import { Minus, Plus } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { AccessibleField, FormErrorMessage, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { splitRefund, type RefundMethod } from "@/modules/pos/model";
import { centsToNumber, computeEngineDocument, legacyLineTaxes } from "@/server/taxation/engine";

type RefundableLine = { id: string; description: string; quantity: number; unitPrice: number; taxRate: number; remaining: number };
type Refundable = { ticket: { id: string; number: string; totalAmount: number }; lines: RefundableLine[]; paid: { cash: number; card: number } };

const step = (line: RefundableLine) => (Number.isInteger(line.remaining) ? 1 : line.remaining);

/** Devolver un ticket entero o algunas unidades de sus líneas, en efectivo o en la tarjeta. */
export function RefundDialog({ currencyCode, onClose, registerId, ticketId }: { currencyCode: string; onClose: () => void; registerId: string; ticketId: string | null }) {
  const router = useRouter();
  const [data, setData] = useState<Refundable | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<RefundMethod>("cash");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!ticketId) return;
    let cancelled = false;
    fetch(`/api/pos/tickets/${ticketId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await readApiError(response, "No se pudo cargar el ticket."));
        return response.json() as Promise<Refundable>;
      })
      .then((loaded) => {
        if (cancelled) return;
        setData(loaded);
        setQuantities(Object.fromEntries(loaded.lines.map((line) => [line.id, line.remaining])));
        setMethod(loaded.paid.cash > 0 ? "cash" : "card");
      })
      .catch((reasonError: unknown) => { if (!cancelled) setError(errorMessage(reasonError, "No se pudo cargar el ticket.")); });
    return () => { cancelled = true; };
  }, [ticketId]);

  const selected = useMemo(() => (data?.lines ?? []).filter((line) => (quantities[line.id] ?? 0) > 0), [data, quantities]);
  // Importe estimado (el definitivo es el de la rectificativa: IVA por tipo sobre las bases devueltas).
  const amount = useMemo(() => centsToNumber(computeEngineDocument(selected.map((line) => ({ quantity: quantities[line.id], unitPrice: line.unitPrice, taxes: legacyLineTaxes({ taxRate: line.taxRate }) }))).totalCents), [quantities, selected]);
  const split = data && amount > 0 ? splitRefund(amount, data.paid, method) : null;
  const nothingLeft = data !== null && data.lines.every((line) => line.remaining <= 0);

  async function submit() {
    if (!data || selected.length === 0) return setError("Elige qué se devuelve.");
    setPending(true);
    setError(null);
    try {
      const everything = data.lines.every((line) => (quantities[line.id] ?? 0) === line.remaining);
      const response = await fetch(`/api/pos/tickets/${data.ticket.id}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          registerId,
          clientRequestId: requestId,
          method,
          reason: reason || null,
          ...(everything ? {} : { lines: selected.map((line) => ({ lineId: line.id, quantity: quantities[line.id] })) }),
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo hacer la devolución."));
      const result = await response.json() as { number: string; cash: number; card: number };
      const parts = [result.cash > 0 ? `${formatMoney(result.cash, currencyCode)} en efectivo` : null, result.card > 0 ? `${formatMoney(result.card, currencyCode)} en la tarjeta` : null].filter(Boolean).join(" y ");
      toast.success(`Devolución ${result.number}: devuelve ${parts}.`);
      onClose();
      router.refresh();
    } catch (reasonError) {
      setError(errorMessage(reasonError, "No se pudo hacer la devolución."));
      setPending(false);
    }
  }

  return (
    <Dialog description={data ? `Ticket ${data.ticket.number} · ${formatMoney(data.ticket.totalAmount, currencyCode)}` : "Cargando…"} onClose={onClose} open={ticketId !== null} size="lg" title="Devolución">
      <div className="space-y-3" data-testid="pos-refund-dialog">
        {nothingLeft ? <p className="text-sm">Este ticket ya está devuelto entero.</p> : null}
        {data && !nothingLeft ? (
          <>
            <div className="flex justify-end gap-1">
              <Button onClick={() => setQuantities(Object.fromEntries(data.lines.map((line) => [line.id, line.remaining])))} size="sm" type="button" variant="outline">Devolver todo</Button>
              <Button onClick={() => setQuantities({})} size="sm" type="button" variant="ghost">Nada</Button>
            </div>
            <ul className="divide-y divide-window-shadow border border-window-shadow">
              {data.lines.map((line) => {
                const value = quantities[line.id] ?? 0;
                return (
                  <li className={cn("flex items-center justify-between gap-2 p-2 text-sm", line.remaining <= 0 && "opacity-50")} data-testid="pos-refund-line" key={line.id}>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{line.description}</span>
                      <span className="text-xs text-muted-foreground">Vendidas {line.quantity.toLocaleString("es-ES")} · quedan {line.remaining.toLocaleString("es-ES")}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <Button aria-label={`Devolver una unidad menos de ${line.description}`} disabled={value <= 0} onClick={() => setQuantities((current) => ({ ...current, [line.id]: Math.max(0, value - step(line)) }))} size="icon-xs" type="button" variant="outline"><Minus aria-hidden="true" /></Button>
                      <span aria-label={`Unidades a devolver de ${line.description}`} className="w-10 text-center font-mono">{value.toLocaleString("es-ES")}</span>
                      <Button aria-label={`Devolver una unidad más de ${line.description}`} disabled={value >= line.remaining} onClick={() => setQuantities((current) => ({ ...current, [line.id]: Math.min(line.remaining, value + step(line)) }))} size="icon-xs" type="button" variant="outline"><Plus aria-hidden="true" /></Button>
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label="Cómo se devuelve el dinero">
              {(["cash", "card"] as const).map((entry) => (
                <button aria-checked={method === entry} className={cn("border p-2 font-mono text-xs font-bold disabled:opacity-40", method === entry ? "border-primary bg-primary/10" : "border-window-dark-shadow bg-window-panel")} disabled={data.paid[entry] <= 0} key={entry} onClick={() => setMethod(entry)} role="radio" type="button">
                  {entry === "cash" ? "En efectivo" : "En la tarjeta"}
                </button>
              ))}
            </div>
            <AccessibleField id="pos-refund-reason" label="Motivo (opcional)"><Input maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder="Defectuoso, cambio de talla…" value={reason} /></AccessibleField>
            <div className="flex items-center justify-between border border-window-shadow bg-window-panel p-2">
              <span className="font-mono text-sm font-bold">A devolver</span>
              <span className="text-right">
                <span className="block font-mono text-2xl font-black" data-testid="pos-refund-amount">{formatMoney(amount, currencyCode)}</span>
                {split && split.cash > 0 && split.card > 0 ? <span className="text-xs text-muted-foreground">{formatMoney(split.cash, currencyCode)} efectivo + {formatMoney(split.card, currencyCode)} tarjeta</span> : null}
              </span>
            </div>
          </>
        ) : null}
        {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      </div>
      <DialogFooter>
        <Button onClick={onClose} type="button" variant="ghost">Cancelar</Button>
        <Button data-testid="pos-refund-confirm" disabled={pending || !data || selected.length === 0 || nothingLeft} onClick={() => void submit()} type="button">{pending ? "Devolviendo…" : "Hacer devolución"}</Button>
      </DialogFooter>
    </Dialog>
  );
}
