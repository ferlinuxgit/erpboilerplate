"use client";

import { Minus, Plus, Trash } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { formatMoney, parseDecimalInput } from "@/lib/format";
import { grossPrice, netFromGross, type CartLine } from "@/modules/pos/model";

import { AmountPad } from "./amount-pad";

/** Editar una línea del ticket con el dedo: unidades, precio con IVA y quitarla. */
export function LineEditorSheet({ currencyCode, line, onClose, onRemove, onSave }: {
  currencyCode: string;
  line: CartLine | null;
  onClose: () => void;
  onRemove: (key: string) => void;
  onSave: (key: string, patch: { quantity: number; unitPrice: number }, adjustedGross: number | null) => void;
}) {
  const [quantity, setQuantity] = useState(line?.quantity ?? 1);
  const [price, setPrice] = useState(line ? grossPrice(line.unitPrice, line.taxRate).toFixed(2).replace(".", ",") : "");
  if (!line) return null;
  const gross = parseDecimalInput(price, { maximumFractionDigits: 2 });
  const step = Number.isInteger(quantity) ? 1 : 0.5;

  function save() {
    if (!line || gross === null || gross < 0 || quantity <= 0) return;
    const result = netFromGross(gross, line.taxRate);
    onSave(line.key, { quantity, unitPrice: result.net }, result.exact ? null : result.gross);
  }

  return (
    <Dialog className="sm:max-w-2xl" description={`IVA ${line.taxRate} %`} onClose={onClose} open title={line.description}>
      <div className="grid gap-4 md:grid-cols-2" data-testid="pos-line-editor">
        <div className="space-y-3">
          <p className="font-mono text-xs font-bold uppercase text-muted-foreground">Unidades</p>
          <div className="flex items-center justify-between gap-2">
            <Button aria-label="Una unidad menos" className="size-16" disabled={quantity <= step} onClick={() => setQuantity((current) => Math.max(step, Math.round((current - step) * 1000) / 1000))} type="button" variant="outline"><Minus aria-hidden="true" className="size-7" /></Button>
            <span className="font-mono text-5xl font-black tabular-nums" data-testid="pos-line-quantity">{quantity.toLocaleString("es-ES")}</span>
            <Button aria-label="Una unidad más" className="size-16" onClick={() => setQuantity((current) => Math.round((current + step) * 1000) / 1000)} type="button" variant="outline"><Plus aria-hidden="true" className="size-7" /></Button>
          </div>
          <p className="border border-window-shadow bg-window-panel p-2 text-center font-mono text-lg">
            Total línea <strong>{formatMoney(gross === null ? 0 : Math.round(gross * quantity * 100) / 100, currencyCode)}</strong>
          </p>
          <Button className="h-12 w-full" data-testid="pos-line-remove" onClick={() => onRemove(line.key)} type="button" variant="outline"><Trash aria-hidden="true" /> Quitar del ticket</Button>
        </div>
        <AmountPad id="pos-line-price" label="Precio (IVA incluido)" onChange={setPrice} onEnter={save} value={price} />
      </div>
      <div className="sticky bottom-0 -mx-3 -mb-3 mt-3 border-t border-window-shadow bg-window-surface p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:static md:pb-3">
        <Button className="h-14 w-full text-lg" data-testid="pos-line-save" disabled={gross === null || gross < 0} onClick={save} type="button">Aplicar</Button>
      </div>
    </Dialog>
  );
}
