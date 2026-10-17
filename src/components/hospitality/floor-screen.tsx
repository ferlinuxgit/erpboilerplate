"use client";

import { BellRinging, ChefHat, Clock, LockKey, Plus, Receipt, Users } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatElapsed, minutesSince } from "@/modules/hospitality/model";

import { KioskBar } from "../pos/kiosk-bar";
import { useWakeLock } from "../pos/use-touch-pos";
import { postJson, type FloorData, type FloorOrder } from "./types";
import { usePolling } from "./use-polling";
import { useWaiter, WaiterButton } from "./waiter";

/**
 * Plano de mesas del bar o restaurante: cada sala en una pestaña y cada mesa con su estado (libre,
 * ocupada o pidiendo la cuenta), importe, comensales, tiempo abierta y avisos de cocina. Se actualiza
 * solo cada pocos segundos para ver lo que hacen los demás camareros.
 */
export function FloorScreen({ canManage, currencyCode, initial, registerId, registerName }: { canManage: boolean; currencyCode: string; initial: FloorData; registerId: string; registerName: string }) {
  const router = useRouter();
  const { data } = usePolling<FloorData>(`/api/pos/hospitality/floor?registerId=${registerId}`, initial, 4000);
  const { waiter, setWaiter } = useWaiter();
  const [areaId, setAreaId] = useState<string | null>(initial.areas[0]?.id ?? null);
  const [opening, setOpening] = useState<{ tableId: string; name: string; seats: number } | null>(null);
  const [looseOpen, setLooseOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useWakeLock(true);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const area = data.areas.find((entry) => entry.id === areaId) ?? data.areas[0];
  const occupied = data.areas.flatMap((entry) => entry.tables).filter((table) => table.order).length + data.loose.length;

  async function open(input: { tableId?: string; label?: string; guests: number }) {
    try {
      const result = await postJson<{ id: string }>("/api/pos/hospitality/orders", { registerId, waiterUserId: waiter?.userId ?? null, ...input });
      router.push(`/pos/${registerId}/orders/${result.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo abrir la cuenta.");
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-background [touch-action:manipulation]" data-testid="pos-floor">
      <KioskBar backHref="/pos?choose=1" backLabel="Cajas" status={`${occupied} ${occupied === 1 ? "mesa abierta" : "mesas abiertas"}`} title={registerName}>
        <WaiterButton onChange={setWaiter} waiter={waiter} />
        <Link aria-label="Cocina y barra" className="flex h-11 min-w-11 items-center justify-center gap-1.5 border border-white/30 px-2.5 font-mono text-xs font-bold hover:bg-white/10" data-testid="pos-kitchen-link" href="/pos/kitchen">
          <ChefHat aria-hidden="true" className="size-5" /><span className="hidden md:inline">Cocina</span>
        </Link>
        <Link aria-label="Venta directa en mostrador" className="flex h-11 min-w-11 items-center justify-center gap-1.5 border border-white/30 px-2.5 font-mono text-xs font-bold hover:bg-white/10" data-testid="pos-counter-link" href={`/pos/${registerId}?counter=1`}>
          <Receipt aria-hidden="true" className="size-5" /><span className="hidden md:inline">Mostrador</span>
        </Link>
        <Link aria-label="Cerrar caja" className="flex h-11 min-w-11 items-center justify-center gap-1.5 border border-white/30 px-2.5 font-mono text-xs font-bold hover:bg-white/10" data-testid="pos-close-link" href={`/pos/${registerId}/close`}>
          <LockKey aria-hidden="true" className="size-5" /><span className="hidden lg:inline">Cerrar caja</span>
        </Link>
      </KioskBar>

      {data.areas.length === 0 ? (
        <div className="m-auto max-w-sm space-y-3 p-6 text-center">
          <p className="font-mono text-lg font-bold">Aún no hay mesas</p>
          <p className="text-sm text-muted-foreground">Crea las salas (Salón, Terraza…) y sus mesas en la configuración de las cajas.</p>
          {canManage ? <Link className="inline-flex h-12 items-center border-2 border-primary bg-primary px-4 font-mono font-bold text-primary-foreground" href="/pos/settings#mesas">Crear salas y mesas</Link> : null}
        </div>
      ) : (
        <>
          <div aria-label="Salas" className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-window-shadow p-2 [scrollbar-width:none]" role="tablist">
            {data.areas.map((entry) => {
              const busy = entry.tables.filter((table) => table.order).length;
              return (
                <button aria-selected={entry.id === area?.id} className={cn("h-11 shrink-0 border-2 px-4 font-mono text-sm font-bold", entry.id === area?.id ? "border-primary bg-primary text-primary-foreground" : "border-window-dark-shadow bg-window-panel")} key={entry.id} onClick={() => setAreaId(entry.id)} role="tab" type="button">
                  {entry.name}{busy > 0 ? ` · ${busy}` : ""}
                </button>
              );
            })}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2 md:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]" data-testid="pos-tables">
              {(area?.tables ?? []).map((table) => (
                <li key={table.id}>
                  <TableTile currencyCode={currencyCode} now={now} onOpen={() => (table.order ? router.push(`/pos/${registerId}/orders/${table.order.id}`) : setOpening({ tableId: table.id, name: table.name, seats: table.seats }))} order={table.order} seats={table.seats} title={table.name} />
                </li>
              ))}
            </ul>
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="font-mono text-xs font-bold uppercase text-muted-foreground">Barra y para llevar</h2>
                <Button className="h-11" data-testid="pos-new-loose" onClick={() => setLooseOpen(true)} type="button" variant="outline"><Plus aria-hidden="true" /> Cuenta sin mesa</Button>
              </div>
              {data.loose.length > 0 ? (
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2 md:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
                  {data.loose.map((order) => (
                    <li key={order.id}><TableTile currencyCode={currencyCode} now={now} onOpen={() => router.push(`/pos/${registerId}/orders/${order.id}`)} order={order} title={order.label ?? "Cuenta"} /></li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        </>
      )}

      {opening ? <GuestsDialog name={opening.name} onClose={() => setOpening(null)} onConfirm={(guests) => { const target = opening; setOpening(null); void open({ tableId: target.tableId, guests }); }} seats={opening.seats} /> : null}
      {looseOpen ? <LooseDialog onClose={() => setLooseOpen(false)} onConfirm={(label) => { setLooseOpen(false); void open({ label, guests: 1 }); }} /> : null}
    </div>
  );
}

function TableTile({ currencyCode, now, onOpen, order, seats, title }: { currencyCode: string; now: Date; onOpen: () => void; order: FloorOrder | null; seats?: number; title: string }) {
  const minutes = order ? minutesSince(order.openedAt, now) : 0;
  const tone = !order ? "border-window-dark-shadow bg-window-panel" : order.status === "BILL_REQUESTED" ? "border-warning bg-warning/20" : "border-primary bg-primary/10";
  return (
    <button aria-label={`${title}: ${!order ? "libre" : order.status === "BILL_REQUESTED" ? "pide la cuenta" : "ocupada"}`} className={cn("relative flex min-h-28 w-full select-none flex-col justify-between border-2 p-2 text-left shadow-raised active:translate-y-px", tone)} data-testid={`pos-table-${title}`} onClick={onOpen} type="button">
      <span className="flex items-start justify-between gap-1">
        <span className="font-mono text-lg font-black leading-tight">{title}</span>
        {order?.ready ? <span className="flex items-center gap-0.5 bg-success px-1 font-mono text-xs font-bold text-white" title="Hay platos listos para servir"><BellRinging aria-hidden="true" className="size-3.5" />{order.ready}</span> : null}
      </span>
      {order ? (
        <span className="space-y-0.5">
          <span className="block font-mono text-xl font-black tabular-nums">{formatMoney(order.pending, currencyCode)}</span>
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-0.5"><Users aria-hidden="true" className="size-3.5" />{order.guests}</span>
            <span className={cn("flex items-center gap-0.5", minutes >= 90 && "font-bold text-warning-text")}><Clock aria-hidden="true" className="size-3.5" />{formatElapsed(minutes)}</span>
            {order.unsent > 0 ? <span className="font-bold text-destructive">{order.unsent} sin enviar</span> : null}
          </span>
          {order.status === "BILL_REQUESTED" ? <span className="block font-mono text-xs font-bold uppercase text-warning-text">Pide la cuenta</span> : order.waiterName ? <span className="block truncate text-xs">{order.waiterName}</span> : null}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">Libre{seats ? ` · ${seats} pax` : ""}</span>
      )}
    </button>
  );
}

function GuestsDialog({ name, onClose, onConfirm, seats }: { name: string; onClose: () => void; onConfirm: (guests: number) => void; seats: number }) {
  const options = Array.from({ length: Math.max(8, seats) }, (_, index) => index + 1);
  return (
    <Dialog description="¿Cuántos comensales?" onClose={onClose} open title={`Abrir ${name}`}>
      <div className="grid grid-cols-4 gap-2" data-testid="pos-guests-dialog">
        {options.map((guests) => (
          <button className={cn("h-16 border-2 font-mono text-2xl font-black active:translate-y-px", guests === seats ? "border-primary bg-primary/10" : "border-window-dark-shadow bg-window-panel")} key={guests} onClick={() => onConfirm(guests)} type="button">{guests}</button>
        ))}
      </div>
    </Dialog>
  );
}

function LooseDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: (label: string) => void }) {
  const [label, setLabel] = useState("");
  return (
    <Dialog description="Para la barra o pedidos para llevar." onClose={onClose} open title="Cuenta sin mesa">
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (label.trim()) onConfirm(label.trim()); }}>
        <Input aria-label="Nombre de la cuenta" autoFocus className="h-12 text-base" maxLength={60} onChange={(event) => setLabel(event.target.value)} placeholder="Barra · Juan, Para llevar 12…" value={label} />
        <Button className="h-14 w-full text-lg" disabled={!label.trim()} type="submit">Abrir cuenta</Button>
      </form>
    </Dialog>
  );
}

