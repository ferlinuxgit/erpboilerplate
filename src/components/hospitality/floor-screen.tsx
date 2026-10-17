"use client";

import { BellRinging, CalendarCheck, ChefHat, Clock, ListBullets, LockKey, MapTrifold, Plus, Receipt, Users } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PLAN_COLS, PLAN_ROWS } from "@/modules/hospitality/floor-plan";
import { formatElapsed, minutesSince } from "@/modules/hospitality/model";

import { KioskBar } from "../pos/kiosk-bar";
import { tapFeedback, useWakeLock } from "../pos/use-touch-pos";
import { ConnectionBanner } from "./connection-banner";
import { isConnectionError } from "./offline-queue";
import { postJson, type FloorBooking, type FloorData, type FloorOrder, type FloorTable, type TableRequest } from "./types";
import { playChime, RequestBadge, RequestsDialog } from "./table-requests";
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
  const [opening, setOpening] = useState<{ tableId: string; name: string; seats: number; booking: FloorBooking | null } | null>(null);
  const [looseOpen, setLooseOpen] = useState(false);
  const [attending, setAttending] = useState<FloorTable | null>(null);
  const knownRequests = useRef<Set<string> | null>(null);
  const [now, setNow] = useState(() => new Date());
  const view = useSyncExternalStore(subscribeFloorView, readFloorView, () => "list" as const);
  useWakeLock(true);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const area = data.areas.find((entry) => entry.id === areaId) ?? data.areas[0];
  // Sin preferencia guardada: plano si la sala está dibujada y la pantalla da para verlo; si no, lista.
  const showPlan = Boolean(area?.planned) && view === "plan";
  function chooseView(next: "plan" | "list") {
    window.localStorage.setItem(FLOOR_VIEW_KEY, next);
    window.dispatchEvent(new Event(FLOOR_VIEW_KEY));
  }
  // Aviso sonoro cuando una mesa pide, llama o quiere la cuenta desde su QR.
  const requestIds = data.areas.flatMap((entry) => entry.tables.flatMap((table) => table.requests.map((request) => request.id))).join(",");
  useEffect(() => {
    const ids = new Set(requestIds ? requestIds.split(",") : []);
    if (knownRequests.current && [...ids].some((id) => !knownRequests.current!.has(id))) {
      tapFeedback();
      playChime();
    }
    knownRequests.current = ids;
  }, [requestIds]);
  const occupied = data.areas.flatMap((entry) => entry.tables).filter((table) => table.order).length + data.loose.length;

  async function open(input: { tableId?: string; label?: string; guests: number }) {
    try {
      const result = await postJson<{ id: string }>("/api/pos/hospitality/orders", { registerId, waiterUserId: waiter?.userId ?? null, ...input });
      router.push(`/pos/${registerId}/orders/${result.id}`);
    } catch (error) {
      toast.error(isConnectionError(error) ? "Sin conexión: para abrir una mesa nueva hace falta conexión. Las mesas ya abiertas se pueden seguir usando." : error instanceof Error ? error.message : "No se pudo abrir la cuenta.");
    }
  }

  async function seatBooking(bookingId: string) {
    try {
      const result = await postJson<{ orderId: string; registerId: string }>(`/api/pos/bookings/${bookingId}/seat`, { registerId, waiterUserId: waiter?.userId ?? null });
      router.push(`/pos/${result.registerId}/orders/${result.orderId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo sentar la reserva.");
    }
  }

  function openTable(table: FloorTable) {
    if (table.requests.length > 0) {
      setAttending(table);
      return;
    }
    if (table.order) router.push(`/pos/${registerId}/orders/${table.order.id}`);
    else setOpening({ tableId: table.id, name: table.name, seats: table.seats, booking: table.booking });
  }

  return (
    <div className="flex h-dvh flex-col bg-background [touch-action:manipulation]" data-testid="pos-floor">
      <KioskBar backHref="/pos?choose=1" backLabel="Cajas" status={`${occupied} ${occupied === 1 ? "mesa abierta" : "mesas abiertas"}`} title={registerName}>
        <WaiterButton onChange={setWaiter} waiter={waiter} />
        <Link aria-label={`Reservas${data.pendingBookings ? ` (${data.pendingBookings} por confirmar)` : ""}`} className="relative flex h-11 min-w-11 items-center justify-center gap-1.5 border border-white/30 px-2.5 font-mono text-xs font-bold hover:bg-white/10" data-testid="pos-bookings-link" href={`/pos/bookings?register=${registerId}`}>
          <CalendarCheck aria-hidden="true" className="size-5" /><span className="hidden md:inline">Reservas</span>
          {data.pendingBookings ? <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center bg-warning px-1 font-mono text-[11px] font-black text-warning-foreground">{data.pendingBookings}</span> : null}
        </Link>
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
      <ConnectionBanner />

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
            {area?.planned ? (
              <button aria-label={showPlan ? "Ver como lista" : "Ver el plano"} className="ml-auto flex h-11 shrink-0 items-center gap-1.5 border-2 border-window-dark-shadow bg-window-panel px-3 font-mono text-xs font-bold" data-testid="pos-floor-view" onClick={() => chooseView(showPlan ? "list" : "plan")} type="button">
                {showPlan ? <ListBullets aria-hidden="true" className="size-5" /> : <MapTrifold aria-hidden="true" className="size-5" />}<span className="hidden sm:inline">{showPlan ? "Lista" : "Plano"}</span>
              </button>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            {showPlan && area ? (
              <FloorPlanView currencyCode={currencyCode} now={now} onOpen={openTable} tables={area.tables} />
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2 md:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]" data-testid="pos-tables">
                {(area?.tables ?? []).map((table) => (
                  <li key={table.id}>
                    <TableTile booking={table.booking} currencyCode={currencyCode} now={now} onOpen={() => openTable(table)} order={table.order} requests={table.requests} seats={table.seats} title={table.name} />
                  </li>
                ))}
              </ul>
            )}
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

      {attending ? (
        <RequestsDialog
          onClose={() => setAttending(null)}
          onGoToTable={() => { const table = attending; setAttending(null); if (table.order) router.push(`/pos/${registerId}/orders/${table.order.id}`); else setOpening({ tableId: table.id, name: table.name, seats: table.seats, booking: table.booking }); }}
          onHandled={(orderId) => { setAttending(null); if (orderId) router.push(`/pos/${registerId}/orders/${orderId}`); }}
          registerId={registerId}
          table={data.areas.flatMap((entry) => entry.tables).find((table) => table.id === attending.id) ?? attending}
          currencyCode={currencyCode}
          waiterUserId={waiter?.userId ?? null}
        />
      ) : null}
      {opening ? <GuestsDialog booking={opening.booking} name={opening.name} onClose={() => setOpening(null)} onConfirm={(guests) => { const target = opening; setOpening(null); void open({ tableId: target.tableId, guests }); }} onSeatBooking={(bookingId) => { setOpening(null); void seatBooking(bookingId); }} seats={opening.seats} /> : null}
      {looseOpen ? <LooseDialog onClose={() => setLooseOpen(false)} onConfirm={(label) => { setLooseOpen(false); void open({ label, guests: 1 }); }} /> : null}
    </div>
  );
}

const FLOOR_VIEW_KEY = "pos-floor-view";

function subscribeFloorView(onChange: () => void) {
  window.addEventListener(FLOOR_VIEW_KEY, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(FLOOR_VIEW_KEY, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Lo que eligió el camarero en este dispositivo; si no eligió, plano en tablet y ordenador y lista en el móvil. */
function readFloorView(): "plan" | "list" {
  const saved = window.localStorage.getItem(FLOOR_VIEW_KEY);
  if (saved === "plan" || saved === "list") return saved;
  return window.matchMedia("(min-width: 768px)").matches ? "plan" : "list";
}

/** La sala tal como está dibujada en la configuración; en pantallas estrechas se desplaza en horizontal. */
function FloorPlanView({ currencyCode, now, onOpen, tables }: { currencyCode: string; now: Date; onOpen: (table: FloorTable) => void; tables: FloorTable[] }) {
  return (
    <div className="overflow-x-auto overscroll-x-contain">
      {/* Ancho limitado por el alto disponible: la sala entera cabe en la tablet sin desplazarse. */}
      <div className="relative mx-auto min-w-[40rem] max-w-[max(40rem,calc((100dvh-9rem)*1.5))] border-2 border-window-shadow bg-window-surface" data-testid="pos-tables" style={{ aspectRatio: `${PLAN_COLS} / ${PLAN_ROWS}` }}>
        {tables.map((table) => {
          const order = table.order;
          const minutes = order ? minutesSince(order.openedAt, now) : 0;
          const tone = table.requests.length > 0 ? "border-destructive bg-destructive/20 ring-2 ring-destructive" : !order ? (table.booking ? "border-dashed border-link bg-window-panel" : "border-window-dark-shadow bg-window-panel") : order.status === "BILL_REQUESTED" ? "border-warning bg-warning/30" : "border-primary bg-primary/15";
          return (
            <button
              aria-label={`${table.name}: ${!order ? (table.booking ? `reservada a las ${table.booking.time}` : "libre") : order.status === "BILL_REQUESTED" ? "pide la cuenta" : "ocupada"}`}
              className={cn("absolute flex select-none flex-col items-center justify-center gap-0.5 border-2 p-0.5 text-center shadow-raised active:translate-y-px", table.shape === "ROUND" && "rounded-full", tone)}
              data-testid={`pos-table-${table.name}`}
              key={table.id}
              onClick={() => onOpen(table)}
              style={{ left: `${(table.posX / PLAN_COLS) * 100}%`, top: `${(table.posY / PLAN_ROWS) * 100}%`, width: `${(table.width / PLAN_COLS) * 100}%`, height: `${(table.height / PLAN_ROWS) * 100}%` }}
              type="button"
            >
              <span className="max-w-full truncate font-mono text-sm font-black leading-none">{table.name}</span>
              {order ? (
                <>
                  <span className="font-mono text-xs font-bold tabular-nums leading-none">{formatMoney(order.pending, currencyCode)}</span>
                  <span className={cn("flex items-center gap-1 text-xs leading-none text-muted-foreground", minutes >= 90 && "font-bold text-warning-text")}><Users aria-hidden="true" className="size-3" />{order.guests} · {formatElapsed(minutes)}</span>
                </>
              ) : table.booking ? (
                <span className={cn("max-w-full truncate px-0.5 font-mono text-xs font-bold leading-none", table.booking.late ? "text-destructive" : "text-link")}>{table.booking.time} · {table.booking.partySize}p</span>
              ) : (
                <span className="text-xs leading-none text-muted-foreground">{table.seats} pax</span>
              )}
              {order?.ready ? <span className="absolute right-0.5 top-0.5 flex items-center bg-success px-0.5 font-mono text-xs font-bold text-white" title="Hay platos listos para servir"><BellRinging aria-hidden="true" className="size-3" />{order.ready}</span> : null}
              <RequestBadge requests={table.requests} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TableTile({ booking, currencyCode, now, onOpen, order, requests = [], seats, title }: { booking?: FloorBooking | null; currencyCode: string; now: Date; onOpen: () => void; order: FloorOrder | null; requests?: TableRequest[]; seats?: number; title: string }) {
  const minutes = order ? minutesSince(order.openedAt, now) : 0;
  const tone = requests.length > 0 ? "border-destructive bg-destructive/20 ring-2 ring-destructive" : !order ? "border-window-dark-shadow bg-window-panel" : order.status === "BILL_REQUESTED" ? "border-warning bg-warning/20" : "border-primary bg-primary/10";
  return (
    <button aria-label={`${title}: ${!order ? (booking ? `reservada a las ${booking.time}` : "libre") : order.status === "BILL_REQUESTED" ? "pide la cuenta" : "ocupada"}`} className={cn("relative flex min-h-28 w-full select-none flex-col justify-between border-2 p-2 text-left shadow-raised active:translate-y-px", tone)} data-testid={`pos-table-${title}`} onClick={onOpen} type="button">
      <span className="flex items-start justify-between gap-1">
        <span className="font-mono text-lg font-black leading-tight">{title}</span>
        {order?.ready ? <span className="flex items-center gap-0.5 bg-success px-1 font-mono text-xs font-bold text-white" title="Hay platos listos para servir"><BellRinging aria-hidden="true" className="size-3.5" />{order.ready}</span> : null}
        <RequestBadge requests={requests} />
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
      ) : booking ? (
        <span className="space-y-0.5">
          <span className={cn("block font-mono text-sm font-black", booking.late ? "text-destructive" : "text-link")}>{booking.late ? "Llega tarde · " : "Reserva "}{booking.time}</span>
          <span className="block truncate text-xs">{booking.name} · {booking.partySize} pax</span>
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">Libre{seats ? ` · ${seats} pax` : ""}</span>
      )}
    </button>
  );
}

function GuestsDialog({ booking, name, onClose, onConfirm, onSeatBooking, seats }: { booking: FloorBooking | null; name: string; onClose: () => void; onConfirm: (guests: number) => void; onSeatBooking: (bookingId: string) => void; seats: number }) {
  const options = Array.from({ length: Math.max(8, seats) }, (_, index) => index + 1);
  return (
    <Dialog description={booking ? "Reservada: sienta a la reserva o ábrela para otros clientes." : "¿Cuántos comensales?"} onClose={onClose} open title={`Abrir ${name}`}>
      {booking ? (
        <Button className="mb-3 h-16 w-full flex-col gap-0 text-base" data-testid="pos-seat-booking" onClick={() => onSeatBooking(booking.id)} type="button">
          <span className="font-black">Sentar a {booking.name}</span>
          <span className="text-xs font-normal">Reserva de las {booking.time} · {booking.partySize} personas</span>
        </Button>
      ) : null}
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

