"use client";

import { Minus, Plus } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { unpaidLines } from "@/modules/hospitality/model";

import type { FloorData, OrderData } from "./types";

export type MoveAction = { kind: "move"; tableId: string } | { kind: "merge"; targetOrderId: string } | { kind: "transfer"; tableId: string; lines: Array<{ lineId: string; quantity: number }> };

/** Mover la cuenta a otra mesa libre, juntarla con una ocupada o pasar algunos productos a otra mesa. */
export function MoveDialog({ onClose, onConfirm, order, registerId }: { onClose: () => void; onConfirm: (action: MoveAction) => void; order: OrderData; registerId: string }) {
  const [floor, setFloor] = useState<FloorData | null>(null);
  const [mode, setMode] = useState<"table" | "transfer">("table");
  const [selected, setSelected] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/pos/hospitality/floor?registerId=${registerId}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() as Promise<FloorData> : null))
      .then((data) => { if (!cancelled) setFloor(data); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [registerId]);

  const lines = unpaidLines(order.lines);
  const transferLines = Object.entries(selected).filter(([, quantity]) => quantity > 0).map(([lineId, quantity]) => ({ lineId, quantity }));

  return (
    <Dialog className="sm:max-w-3xl" description="Mueve la cuenta, júntala con otra mesa o pasa algunos productos." onClose={onClose} open title={`Mover ${order.name}`}>
      <div className="space-y-3" data-testid="pos-move-dialog">
        <div className="grid grid-cols-2 gap-1.5">
          <button className={cn("h-12 border-2 font-mono text-sm font-bold", mode === "table" ? "border-primary bg-primary/10" : "border-window-dark-shadow bg-window-panel")} onClick={() => setMode("table")} type="button">Toda la cuenta</button>
          <button className={cn("h-12 border-2 font-mono text-sm font-bold", mode === "transfer" ? "border-primary bg-primary/10" : "border-window-dark-shadow bg-window-panel")} data-testid="pos-move-transfer-mode" onClick={() => setMode("transfer")} type="button">Algunos productos</button>
        </div>
        {mode === "transfer" ? (
          <ul className="max-h-56 divide-y divide-window-shadow overflow-y-auto border border-window-shadow">
            {lines.map((line) => {
              const value = selected[line.id] ?? 0;
              return (
                <li className="flex items-center gap-2 p-2" key={line.id}>
                  <span className="min-w-0 flex-1 truncate text-sm">{line.description} <span className="text-xs text-muted-foreground">({line.unpaid.toLocaleString("es-ES")})</span></span>
                  <button aria-label={`Una menos de ${line.description}`} className="flex size-11 items-center justify-center border border-window-dark-shadow bg-window-panel" onClick={() => setSelected((current) => ({ ...current, [line.id]: Math.max(0, value - 1) }))} type="button"><Minus aria-hidden="true" className="size-5" /></button>
                  <span className="w-8 text-center font-mono text-lg font-bold">{value}</span>
                  <button aria-label={`Una más de ${line.description}`} className="flex size-11 items-center justify-center border border-window-dark-shadow bg-window-panel" onClick={() => setSelected((current) => ({ ...current, [line.id]: Math.min(line.unpaid, value + 1) }))} type="button"><Plus aria-hidden="true" className="size-5" /></button>
                </li>
              );
            })}
          </ul>
        ) : null}
        <p className="font-mono text-xs font-bold uppercase text-muted-foreground">{mode === "table" ? "Elige la mesa (libre: se mueve; ocupada: se juntan)" : "¿A qué mesa?"}</p>
        {!floor ? <p className="text-sm text-muted-foreground">Cargando mesas…</p> : (
          <div className="max-h-[40vh] space-y-3 overflow-y-auto">
            {floor.areas.map((area) => (
              <div key={area.id}>
                <p className="mb-1 text-xs font-bold">{area.name}</p>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-1.5">
                  {area.tables.filter((table) => table.id !== order.tableId).map((table) => (
                    <Button
                      className={cn("h-14 flex-col gap-0", table.order ? "border-primary" : "")}
                      data-testid={`pos-move-target-${table.name}`}
                      disabled={mode === "transfer" && transferLines.length === 0}
                      key={table.id}
                      onClick={() => {
                        if (mode === "transfer") onConfirm({ kind: "transfer", tableId: table.id, lines: transferLines });
                        else if (table.order) onConfirm({ kind: "merge", targetOrderId: table.order.id });
                        else onConfirm({ kind: "move", tableId: table.id });
                      }}
                      type="button"
                      variant="outline"
                    >
                      <span className="font-mono font-bold">{table.name}</span>
                      <span className="text-[11px] text-muted-foreground">{table.order ? "ocupada · juntar" : "libre"}</span>
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
