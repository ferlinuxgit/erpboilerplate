"use client";

import { CreditCard, Money, Stack } from "@phosphor-icons/react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormErrorMessage } from "@/components/ui/form";
import { formatMoney, parseDecimalInput } from "@/lib/format";
import { cn } from "@/lib/utils";
import { validatePayment } from "@/modules/pos/model";

import { AmountPad } from "./amount-pad";

type Method = "cash" | "card" | "mixed";

export type PaymentChoice = { cash: number; card: number; cashReceived: number | null };

const QUICK_NOTES = [5, 10, 20, 50, 100];

const parse = (value: string) => (value.trim() ? parseDecimalInput(value, { maximumFractionDigits: 2 }) : null);
const asText = (value: number) => value.toFixed(2).replace(".", ",");

/**
 * Cobro táctil: forma de pago con botones grandes, teclado numérico para lo entregado (o la parte con
 * tarjeta) y el cambio bien visible.
 */
export function PaymentDialog({ cardEnabled, currencyCode, onClose, onConfirm, open, pending, total }: {
  cardEnabled: boolean;
  currencyCode: string;
  onClose: () => void;
  onConfirm: (choice: PaymentChoice) => void;
  open: boolean;
  pending: boolean;
  total: number;
}) {
  const [method, setMethod] = useState<Method>("cash");
  const [received, setReceived] = useState("");
  const [cardPart, setCardPart] = useState("");
  const [editing, setEditing] = useState<"received" | "card">("received");

  const choice = useMemo<PaymentChoice | { error: string }>(() => {
    if (method === "card") return { cash: 0, card: total, cashReceived: null };
    const card = method === "mixed" ? parse(cardPart) ?? 0 : 0;
    const cash = Math.round((total - card) * 100) / 100;
    if (cash < 0) return { error: "La parte con tarjeta supera el total." };
    return { cash, card, cashReceived: parse(received) ?? cash };
  }, [cardPart, method, received, total]);

  const check = "error" in choice ? null : validatePayment(total, choice);
  const error = "error" in choice ? choice.error : check && !check.ok ? check.message : null;
  const change = check && check.ok ? check.change : 0;
  const cashDue = "error" in choice ? 0 : choice.cash;

  function confirm() {
    if ("error" in choice || !check?.ok || pending) return;
    onConfirm(choice);
  }

  const methods: Array<{ id: Method; label: string; icon: typeof Money; disabled?: boolean }> = [
    { id: "cash", label: "Efectivo", icon: Money },
    { id: "card", label: "Tarjeta", icon: CreditCard, disabled: !cardEnabled },
    { id: "mixed", label: "Mixto", icon: Stack, disabled: !cardEnabled },
  ];

  return (
    <Dialog className="sm:max-w-3xl" description={`Total: ${formatMoney(total, currencyCode)}`} onClose={onClose} open={open} title="Cobrar">
      <div className="grid gap-3 md:grid-cols-2" data-testid="pos-payment-dialog">
        <div className="space-y-3">
          <p className="text-center font-mono text-4xl font-black tabular-nums" data-testid="pos-pay-total">{formatMoney(total, currencyCode)}</p>
          <div aria-label="Forma de pago" className="grid grid-cols-3 gap-1.5" role="radiogroup">
            {methods.map((entry) => (
              <button
                aria-checked={method === entry.id}
                className={cn("flex h-16 flex-col items-center justify-center gap-1 border-2 font-mono text-sm font-bold [touch-action:manipulation] disabled:opacity-40", method === entry.id ? "border-primary bg-primary/10" : "border-window-dark-shadow bg-window-panel")}
                data-testid={`pos-method-${entry.id}`}
                disabled={entry.disabled}
                key={entry.id}
                onClick={() => {
                  setMethod(entry.id);
                  setEditing(entry.id === "mixed" ? "card" : "received");
                }}
                role="radio"
                title={entry.disabled ? "Configura el banco de la tarjeta en las cajas del TPV" : undefined}
                type="button"
              >
                <entry.icon aria-hidden="true" className="size-6" />{entry.label}
              </button>
            ))}
          </div>
          {method !== "card" ? (
            <div className="flex items-center justify-between border-2 border-window-shadow bg-window-panel p-3">
              <span className="font-mono text-base font-bold">Cambio</span>
              <span className="font-mono text-4xl font-black tabular-nums" data-testid="pos-change">{formatMoney(change, currencyCode)}</span>
            </div>
          ) : (
            <p className="border-2 border-window-shadow bg-window-panel p-3 text-center text-sm">Cobra {formatMoney(total, currencyCode)} en el datáfono y confirma.</p>
          )}
          {method === "mixed" ? (
            <div className="grid grid-cols-2 gap-1.5">
              <Button onClick={() => setEditing("card")} type="button" variant={editing === "card" ? "default" : "outline"}>Con tarjeta: {cardPart || "0"}</Button>
              <Button onClick={() => setEditing("received")} type="button" variant={editing === "received" ? "default" : "outline"}>Efectivo: {formatMoney(cashDue, currencyCode)}</Button>
            </div>
          ) : null}
          {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
        </div>
        <div>
          {method === "card" ? null : method === "mixed" && editing === "card" ? (
            <AmountPad id="pos-card-part" label="Con tarjeta" onChange={setCardPart} onEnter={() => setEditing("received")} value={cardPart} />
          ) : (
            <AmountPad autoFocus id="pos-cash-received" label="Entregado" onChange={setReceived} onEnter={confirm} placeholder={asText(cashDue)} value={received}>
              <div className="flex flex-wrap gap-1.5">
                <Button className="h-11 flex-1" onClick={() => setReceived(asText(cashDue))} type="button" variant="outline">Exacto</Button>
                {QUICK_NOTES.filter((note) => note >= cashDue).slice(0, 3).map((note) => (
                  <Button className="h-11 flex-1" key={note} onClick={() => setReceived(String(note))} type="button" variant="outline">{note} €</Button>
                ))}
              </div>
            </AmountPad>
          )}
        </div>
      </div>
      <div className="sticky bottom-0 -mx-3 -mb-3 mt-3 border-t border-window-shadow bg-window-surface p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:static md:pb-3">
        <Button className="h-16 w-full text-xl" data-testid="pos-pay-confirm" disabled={pending || Boolean(error)} onClick={confirm} type="button">{pending ? "Cobrando…" : `Cobrar ${formatMoney(total, currencyCode)}`}</Button>
      </div>
    </Dialog>
  );
}
