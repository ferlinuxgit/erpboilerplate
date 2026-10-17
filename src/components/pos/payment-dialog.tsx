"use client";

import { CreditCard, Money, Stack } from "@phosphor-icons/react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { AccessibleField, FormErrorMessage } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/number-input";
import { formatMoney, parseDecimalInput } from "@/lib/format";
import { cn } from "@/lib/utils";
import { validatePayment } from "@/modules/pos/model";

type Method = "cash" | "card" | "mixed";

export type PaymentChoice = { cash: number; card: number; cashReceived: number | null };

const QUICK_NOTES = [5, 10, 20, 50, 100];

const input = (value: string) => (value.trim() ? parseDecimalInput(value, { maximumFractionDigits: 2 }) : null);

/** Cobro del ticket: efectivo (con cambio), tarjeta o mixto. */
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

  const choice = useMemo<PaymentChoice | { error: string }>(() => {
    if (method === "card") return { cash: 0, card: total, cashReceived: null };
    const card = method === "mixed" ? input(cardPart) ?? 0 : 0;
    const cash = Math.round((total - card) * 100) / 100;
    if (cash < 0) return { error: "La parte con tarjeta supera el total." };
    const receivedValue = input(received);
    return { cash, card, cashReceived: receivedValue ?? cash };
  }, [cardPart, method, received, total]);

  const check = "error" in choice ? null : validatePayment(total, choice);
  const error = "error" in choice ? choice.error : check && !check.ok ? check.message : null;
  const change = check && check.ok ? check.change : 0;
  const cashDue = "error" in choice ? 0 : choice.cash;

  function confirm() {
    if ("error" in choice || !check?.ok) return;
    onConfirm(choice);
  }

  const methods: Array<{ id: Method; label: string; icon: typeof Money; disabled?: boolean }> = [
    { id: "cash", label: "Efectivo", icon: Money },
    { id: "card", label: "Tarjeta", icon: CreditCard, disabled: !cardEnabled },
    { id: "mixed", label: "Mixto", icon: Stack, disabled: !cardEnabled },
  ];

  return (
    <Dialog description={`Total a cobrar: ${formatMoney(total, currencyCode)}`} initialFocusId={method === "card" ? "pos-pay-confirm" : "pos-cash-received"} onClose={onClose} open={open} size="md" title="Cobrar">
      <div className="space-y-3" data-testid="pos-payment-dialog">
        <p className="text-center font-mono text-3xl font-black tabular-nums" data-testid="pos-pay-total">{formatMoney(total, currencyCode)}</p>
        <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="Forma de pago">
          {methods.map((entry) => (
            <button
              aria-checked={method === entry.id}
              className={cn("flex flex-col items-center gap-1 border p-2 font-mono text-xs font-bold disabled:opacity-40", method === entry.id ? "border-primary bg-primary/10" : "border-window-dark-shadow bg-window-panel")}
              data-testid={`pos-method-${entry.id}`}
              disabled={entry.disabled}
              key={entry.id}
              onClick={() => setMethod(entry.id)}
              role="radio"
              title={entry.disabled ? "Configura el banco de la tarjeta en Configuración → TPV" : undefined}
              type="button"
            >
              <entry.icon aria-hidden="true" className="size-5" />{entry.label}
            </button>
          ))}
        </div>
        {method === "mixed" ? (
          <AccessibleField id="pos-card-part" label="Con tarjeta">
            <MoneyInput onChange={(event) => setCardPart(event.target.value)} value={cardPart} />
          </AccessibleField>
        ) : null}
        {method !== "card" ? (
          <>
            <AccessibleField helperText={method === "mixed" ? `En efectivo: ${formatMoney(cashDue, currencyCode)}` : undefined} id="pos-cash-received" label="Entregado">
              <MoneyInput onChange={(event) => setReceived(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); confirm(); } }} placeholder={cashDue.toFixed(2).replace(".", ",")} value={received} />
            </AccessibleField>
            <div className="flex flex-wrap gap-1">
              <Button onClick={() => setReceived(cashDue.toFixed(2).replace(".", ","))} size="sm" type="button" variant="outline">Exacto</Button>
              {QUICK_NOTES.filter((note) => note >= cashDue).slice(0, 4).map((note) => (
                <Button key={note} onClick={() => setReceived(String(note))} size="sm" type="button" variant="outline">{formatMoney(note, currencyCode)}</Button>
              ))}
            </div>
            <div className="flex items-center justify-between border border-window-shadow bg-window-panel p-2">
              <span className="font-mono text-sm font-bold">Cambio</span>
              <span className="font-mono text-2xl font-black tabular-nums" data-testid="pos-change">{formatMoney(change, currencyCode)}</span>
            </div>
          </>
        ) : null}
        {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      </div>
      <DialogFooter>
        <Button onClick={onClose} type="button" variant="ghost">Volver</Button>
        <Button data-testid="pos-pay-confirm" disabled={pending || Boolean(error)} id="pos-pay-confirm" onClick={confirm} size="lg" type="button">{pending ? "Cobrando…" : "Cobrar"}</Button>
      </DialogFooter>
    </Dialog>
  );
}
