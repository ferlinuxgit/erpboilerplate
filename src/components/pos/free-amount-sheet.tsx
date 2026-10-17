"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { parseDecimalInput } from "@/lib/format";
import { cn } from "@/lib/utils";

import { AmountPad } from "./amount-pad";

const VAT_RATES = [21, 10, 4, 0];

/** Venta sin artículo del catálogo: importe (IVA incluido), tipo de IVA y, si se quiere, el concepto. */
export function FreeAmountSheet({ onAdd, onClose, open }: { onAdd: (input: { description: string; gross: number; taxRate: number }) => void; onClose: () => void; open: boolean }) {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [taxRate, setTaxRate] = useState(21);
  const gross = parseDecimalInput(amount, { maximumFractionDigits: 2 });

  function add() {
    if (gross === null || gross <= 0) return;
    onAdd({ description: description.trim() || "Varios", gross, taxRate });
    setAmount("");
    setDescription("");
  }

  return (
    <Dialog className="sm:max-w-2xl" onClose={onClose} open={open} title="Importe libre">
      <div className="grid gap-4 md:grid-cols-2" data-testid="pos-free-amount">
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="font-mono text-xs font-bold uppercase text-muted-foreground">Concepto</span>
            <Input className="h-12 text-base" maxLength={120} onChange={(event) => setDescription(event.target.value)} placeholder="Varios" value={description} />
          </label>
          <div className="space-y-1">
            <span className="font-mono text-xs font-bold uppercase text-muted-foreground">IVA</span>
            <div aria-label="Tipo de IVA" className="grid grid-cols-4 gap-1.5" role="radiogroup">
              {VAT_RATES.map((rate) => (
                <button aria-checked={taxRate === rate} className={cn("h-12 border-2 font-mono text-base font-bold", taxRate === rate ? "border-primary bg-primary/10" : "border-window-dark-shadow bg-window-panel")} key={rate} onClick={() => setTaxRate(rate)} role="radio" type="button">{rate} %</button>
              ))}
            </div>
          </div>
        </div>
        <AmountPad autoFocus id="pos-free-amount-value" label="Importe (IVA incluido)" onChange={setAmount} onEnter={add} value={amount} />
      </div>
      <div className="sticky bottom-0 -mx-3 -mb-3 mt-3 border-t border-window-shadow bg-window-surface p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:static md:pb-3">
        <Button className="h-14 w-full text-lg" data-testid="pos-free-amount-add" disabled={gross === null || gross <= 0} onClick={add} type="button">Añadir al ticket</Button>
      </div>
    </Dialog>
  );
}
