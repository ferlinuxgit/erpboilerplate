"use client";

import { Minus, Plus } from "@phosphor-icons/react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormErrorMessage } from "@/components/ui/form";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { billPartLines, unpaidLines, type BillPart } from "@/modules/hospitality/model";
import { cartTotals, grossPrice } from "@/modules/pos/model";

import type { OrderData } from "./types";

type Mode = "all" | "equal" | "lines";

/**
 * Cómo se cobra la cuenta: entera, a partes iguales («entre 4») o por productos (cada uno lo suyo).
 * Calcula el importe exacto de la parte con el mismo modelo que el servidor.
 */
export function SplitDialog({ currencyCode, onClose, onContinue, order }: { currencyCode: string; onClose: () => void; onContinue: (part: BillPart, amount: number) => void; order: OrderData }) {
  const inProgress = order.equalSplit;
  const [mode, setMode] = useState<Mode>(inProgress ? "equal" : "all");
  const [parts, setParts] = useState(inProgress?.parts ?? Math.max(2, order.guests));
  const [selected, setSelected] = useState<Record<string, number>>({});
  const pending = unpaidLines(order.lines);

  const part: BillPart = mode === "lines"
    ? { mode: "lines", lines: Object.entries(selected).filter(([, quantity]) => quantity > 0).map(([lineId, quantity]) => ({ lineId, quantity })) }
    : mode === "equal" ? { mode: "equal", parts } : { mode: "all" };
  const plan = useMemo(() => billPartLines(order.lines, part, order.equalSplit, order.name), [order, part]); // eslint-disable-line react-hooks/exhaustive-deps
  const amount = "error" in plan ? 0 : cartTotals(plan.cart).total;
  const error = "error" in plan && !(mode === "lines" && Object.keys(selected).length === 0) ? plan.error : null;

  return (
    <Dialog className="sm:max-w-2xl" description={`Pendiente: ${formatMoney(order.amounts.pending, currencyCode)}`} onClose={onClose} open title={`Cobrar ${order.name}`}>
      <div className="space-y-3" data-testid="pos-split-dialog">
        {inProgress ? <p className="border-2 border-primary bg-primary/10 p-2 text-center font-mono text-sm font-bold">A partes iguales: parte {inProgress.paid + 1} de {inProgress.parts}</p> : null}
        <div aria-label="Cómo se cobra" className="grid grid-cols-3 gap-1.5" role="radiogroup">
          {([["all", inProgress ? "El resto" : "Todo"], ["equal", "A partes iguales"], ["lines", "Por productos"]] as const).map(([value, label]) => (
            <button aria-checked={mode === value} className={cn("h-14 border-2 font-mono text-sm font-bold disabled:opacity-40", mode === value ? "border-primary bg-primary/10" : "border-window-dark-shadow bg-window-panel")} data-testid={`pos-split-${value}`} disabled={value === "lines" && Boolean(inProgress)} key={value} onClick={() => setMode(value)} role="radio" type="button">{label}</button>
          ))}
        </div>

        {mode === "equal" ? (
          <div className="space-y-2">
            {inProgress ? null : (
              <div className="flex items-center justify-between gap-2">
                <Button aria-label="Una parte menos" className="size-14" disabled={parts <= 2} onClick={() => setParts((current) => current - 1)} type="button" variant="outline"><Minus aria-hidden="true" className="size-6" /></Button>
                <span className="text-center"><span className="block font-mono text-4xl font-black" data-testid="pos-split-parts">{parts}</span><span className="text-xs text-muted-foreground">partes</span></span>
                <Button aria-label="Una parte más" className="size-14" disabled={parts >= 50} onClick={() => setParts((current) => current + 1)} type="button" variant="outline"><Plus aria-hidden="true" className="size-6" /></Button>
              </div>
            )}
          </div>
        ) : null}

        {mode === "lines" ? (
          <ul className="max-h-[45vh] divide-y divide-window-shadow overflow-y-auto border border-window-shadow">
            {pending.map((line) => {
              const value = selected[line.id] ?? 0;
              return (
                <li className="flex items-center gap-2 p-2" key={line.id}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{line.description}</span>
                    <span className="font-mono text-xs text-muted-foreground">{formatMoney(grossPrice(line.unitPrice, line.taxRate), currencyCode)} · quedan {line.unpaid.toLocaleString("es-ES")}</span>
                  </span>
                  <button aria-label={`Una menos de ${line.description}`} className="flex size-11 items-center justify-center border border-window-dark-shadow bg-window-panel disabled:opacity-40" disabled={value <= 0} onClick={() => setSelected((current) => ({ ...current, [line.id]: Math.max(0, value - 1) }))} type="button"><Minus aria-hidden="true" className="size-5" /></button>
                  <span className="w-8 text-center font-mono text-lg font-bold">{value}</span>
                  <button aria-label={`Una más de ${line.description}`} className="flex size-11 items-center justify-center border border-window-dark-shadow bg-window-panel disabled:opacity-40" disabled={value >= line.unpaid} onClick={() => setSelected((current) => ({ ...current, [line.id]: Math.min(line.unpaid, value + 1) }))} type="button"><Plus aria-hidden="true" className="size-5" /></button>
                </li>
              );
            })}
          </ul>
        ) : null}

        {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
        <div className="flex items-center justify-between border-2 border-window-shadow bg-window-panel p-3">
          <span className="font-mono font-bold">{mode === "equal" ? "Esta parte" : mode === "lines" ? "Seleccionado" : "A cobrar"}</span>
          <span className="font-mono text-3xl font-black tabular-nums" data-testid="pos-split-amount">{formatMoney(amount, currencyCode)}</span>
        </div>
        <Button className="h-16 w-full text-xl" data-testid="pos-split-continue" disabled={"error" in plan || amount <= 0} onClick={() => onContinue(part, amount)} type="button">Cobrar {formatMoney(amount, currencyCode)}</Button>
      </div>
    </Dialog>
  );
}
