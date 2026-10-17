"use client";

import { Minus, Plus, Trash } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { lineStatusLabels } from "@/modules/hospitality/model";
import { grossPrice } from "@/modules/pos/model";

import type { OrderLineView } from "./types";

const QUICK_NOTES = ["Sin hielo", "Con hielo", "Poco hecho", "Al punto", "Muy hecho", "Sin gluten", "Sin sal", "Para compartir", "De primero", "De segundo", "Para llevar"];

/**
 * Editar una línea de la cuenta. Sin enviar: unidades y nota libremente. Ya en cocina: nota y anular
 * unidades con su motivo (queda registrado y cocina lo ve).
 */
export function OrderLineSheet({ currencyCode, line, onClose, onSave }: {
  currencyCode: string;
  line: OrderLineView;
  onClose: () => void;
  onSave: (patch: { quantity?: number; note?: string | null; cancelReason?: string | null }) => void;
}) {
  const sent = line.status !== "PENDING";
  const minimum = line.paidQuantity;
  const [quantity, setQuantity] = useState(line.quantity);
  const [note, setNote] = useState(line.note ?? "");
  const [reason, setReason] = useState("");
  const reducing = sent && quantity < line.quantity;

  function save() {
    onSave({
      ...(quantity !== line.quantity ? { quantity } : {}),
      ...(note.trim() !== (line.note ?? "") ? { note: note.trim() || null } : {}),
      ...(reducing ? { cancelReason: reason.trim() } : {}),
    });
  }

  return (
    <Dialog description={`${formatMoney(grossPrice(line.unitPrice, line.taxRate), currencyCode)} · ${lineStatusLabels[line.status]}`} onClose={onClose} open title={line.description}>
      <div className="space-y-4" data-testid="pos-order-line-sheet">
        <div className="flex items-center justify-between gap-2">
          <Button aria-label="Una unidad menos" className="size-16" disabled={quantity <= Math.max(minimum, sent ? 0 : 1)} onClick={() => setQuantity((current) => Math.max(minimum, current - 1))} type="button" variant="outline"><Minus aria-hidden="true" className="size-7" /></Button>
          <span className="font-mono text-5xl font-black tabular-nums" data-testid="pos-order-line-quantity">{quantity.toLocaleString("es-ES")}</span>
          <Button aria-label="Una unidad más" className="size-16" disabled={sent} onClick={() => setQuantity((current) => current + 1)} type="button" variant="outline"><Plus aria-hidden="true" className="size-7" /></Button>
        </div>
        {sent ? <p className="text-center text-xs text-muted-foreground">Ya está en cocina: para más unidades añádelas como un pedido nuevo.</p> : null}
        <div className="space-y-1.5">
          <label className="block font-mono text-xs font-bold uppercase text-muted-foreground" htmlFor="pos-line-note">Nota para cocina / barra</label>
          <Input className="h-12 text-base" id="pos-line-note" maxLength={200} onChange={(event) => setNote(event.target.value)} placeholder="Sin cebolla, poco hecho…" value={note} />
          <div className="flex flex-wrap gap-1.5">
            {QUICK_NOTES.map((entry) => (
              <button className={cn("h-10 border px-3 text-sm", note.includes(entry) ? "border-primary bg-primary/10 font-bold" : "border-window-dark-shadow bg-window-panel")} key={entry} onClick={() => setNote((current) => (current.includes(entry) ? current.replace(entry, "").replace(/\s*·\s*$|^\s*·\s*/g, "").trim() : current ? `${current} · ${entry}` : entry))} type="button">{entry}</button>
            ))}
          </div>
        </div>
        {reducing ? (
          <div className="space-y-1">
            <label className="block font-mono text-xs font-bold uppercase text-destructive" htmlFor="pos-line-cancel-reason">Motivo de la anulación</label>
            <Input className="h-12 text-base" id="pos-line-cancel-reason" maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder="Error al pedir, cliente lo cambia…" value={reason} />
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          {!sent ? <Button className="h-14" data-testid="pos-order-line-remove" onClick={() => onSave({ quantity: 0 })} type="button" variant="outline"><Trash aria-hidden="true" /> Quitar</Button> : <span />}
          <Button className="h-14 text-lg" data-testid="pos-order-line-save" disabled={reducing && !reason.trim()} onClick={save} type="button">Aplicar</Button>
        </div>
      </div>
    </Dialog>
  );
}
