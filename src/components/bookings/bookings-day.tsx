"use client";

import { ArrowCounterClockwise, CaretLeft, CaretRight, Chair, Check, Hourglass, NotePencil, Phone, Plus, Prohibit, Receipt, UserMinus, Users, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { KioskAction, KioskBar } from "@/components/pos/kiosk-bar";
import { postJson } from "@/components/hospitality/types";
import { usePolling } from "@/components/hospitality/use-polling";
import { useWaiter } from "@/components/hospitality/waiter";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { addDays, bookingSourceLabels, bookingStatusLabels, depositStatusLabels, type BookingSource, type BookingStatus } from "@/modules/hospitality/bookings";
import type { BookingDay } from "@/server/pos/bookings";

type DayData = Omit<BookingDay, "bookings"> & { bookings: Array<Omit<BookingDay["bookings"][number], "startsAt" | "endsAt"> & { startsAt: string; endsAt: string }> };
type Booking = DayData["bookings"][number];
type WaitlistEntry = DayData["waitlist"][number];
type Prefill = { name: string; partySize: number; phone: string | null; email: string | null; notes: string | null; source: BookingSource; time: string };

/** Hora actual redondeada a los 5 minutos siguientes (para dar mesa ya a quien espera). */
function nowRounded() {
  const now = new Date();
  const minutes = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 5) * 5;
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

const STATUS_TONE: Record<BookingStatus, string> = {
  AWAITING_PAYMENT: "border-dashed border-warning bg-window-surface",
  PENDING: "border-warning bg-warning/15",
  CONFIRMED: "border-window-dark-shadow bg-window-panel",
  SEATED: "border-primary bg-primary/10",
  COMPLETED: "border-window-shadow bg-window-surface opacity-70",
  NO_SHOW: "border-destructive/60 bg-destructive/5 opacity-70",
  CANCELLED: "border-dashed border-window-shadow bg-window-surface opacity-60",
};
const BADGE_TONE: Record<BookingStatus, string> = {
  AWAITING_PAYMENT: "bg-window-shadow text-white",
  PENDING: "bg-warning text-warning-foreground",
  CONFIRMED: "bg-success text-white",
  SEATED: "bg-primary text-primary-foreground",
  COMPLETED: "bg-window-shadow text-white",
  NO_SHOW: "bg-destructive text-destructive-foreground",
  CANCELLED: "bg-window-shadow text-white",
};
const longDay = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** Reservas de un día para la tablet del local: llegan solas, se confirman, se sientan y se marcan. */
export function BookingsDay({ initial, registerId, registers, today }: { initial: DayData; registerId: string | null; registers: Array<{ id: string; name: string }>; today: string }) {
  const router = useRouter();
  const { data, refresh } = usePolling<DayData>(`/api/pos/bookings?date=${initial.date}`, initial, 15_000);
  const { waiter } = useWaiter();
  const [editing, setEditing] = useState<Booking | "new" | null>(null);
  const [seating, setSeating] = useState<Booking | null>(null);
  const [cancelling, setCancelling] = useState<Booking | null>(null);
  const [busy, setBusy] = useState(false);
  const [fromWaitlist, setFromWaitlist] = useState<WaitlistEntry | null>(null);
  const [addingWalkIn, setAddingWalkIn] = useState(false);
  // Reloj para el tiempo que lleva esperando cada grupo en la puerta.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const query = (date: string) => `/pos/bookings?date=${date}${registerId ? `&register=${registerId}` : ""}`;
  const active = data.bookings.filter((booking) => !["CANCELLED", "NO_SHOW"].includes(booking.status));
  const guests = active.reduce((sum, booking) => sum + booking.partySize, 0);
  const pendingCount = data.bookings.filter((booking) => booking.status === "PENDING").length;
  const seatRegister = registerId ?? data.registerId;

  async function act(booking: Booking, action: "CONFIRM" | "NO_SHOW" | "COMPLETE" | "RESTORE", success: string) {
    setBusy(true);
    try {
      await postJson(`/api/pos/bookings/${booking.id}/status`, { action });
      toast.success(success);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cambiar la reserva.");
    } finally {
      setBusy(false);
    }
  }

  async function setWaitlist(entry: WaitlistEntry, status: "NOTIFIED" | "BOOKED" | "CANCELLED", success: string | null) {
    setBusy(true);
    try {
      await postJson(`/api/pos/bookings/waitlist/${entry.id}`, { status });
      if (success) toast.success(success);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar la lista de espera.");
    } finally {
      setBusy(false);
    }
  }

  async function seat(booking: Booking, register: string) {
    setBusy(true);
    try {
      const result = await postJson<{ orderId: string; registerId: string }>(`/api/pos/bookings/${booking.id}/seat`, { registerId: register, waiterUserId: waiter?.userId ?? null });
      router.push(`/pos/${result.registerId}/orders/${result.orderId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo sentar la reserva.");
      setBusy(false);
    }
  }

  // Agrupadas por hora para leer el servicio de un vistazo.
  const groups = data.bookings.reduce<Array<{ time: string; bookings: Booking[] }>>((list, booking) => {
    const last = list.at(-1);
    if (last && last.time === booking.time) last.bookings.push(booking);
    else list.push({ time: booking.time, bookings: [booking] });
    return list;
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-background [touch-action:manipulation]" data-testid="pos-bookings">
      <KioskBar backHref={registerId ? `/pos/${registerId}` : "/pos?choose=1"} backLabel={registerId ? "Mesas" : "Cajas"} status={`${active.length} ${active.length === 1 ? "reserva" : "reservas"} · ${guests} ${guests === 1 ? "persona" : "personas"}${pendingCount ? ` · ${pendingCount} por confirmar` : ""}`} title="Reservas">
        <KioskAction data-testid="pos-waitlist-walk-in" icon={<Hourglass aria-hidden="true" className="size-5" />} label="Esperando en la puerta" onClick={() => setAddingWalkIn(true)}>En la puerta</KioskAction>
        <KioskAction data-testid="pos-booking-new" icon={<Plus aria-hidden="true" className="size-5" />} label="Nueva reserva" onClick={() => setEditing("new")} />
      </KioskBar>

      <nav aria-label="Día" className="flex shrink-0 items-center gap-1.5 border-b border-window-shadow p-2">
        <Link aria-label="Día anterior" className="grid h-11 w-11 place-items-center border-2 border-window-dark-shadow bg-window-panel" href={query(addDays(data.date, -1))}><CaretLeft aria-hidden="true" className="size-5" /></Link>
        <Link className={cn("flex h-11 items-center border-2 px-3 font-mono text-sm font-bold", data.date === today ? "border-primary bg-primary text-primary-foreground" : "border-window-dark-shadow bg-window-panel")} href={query(today)}>Hoy</Link>
        <Link aria-label="Día siguiente" className="grid h-11 w-11 place-items-center border-2 border-window-dark-shadow bg-window-panel" href={query(addDays(data.date, 1))}><CaretRight aria-hidden="true" className="size-5" /></Link>
        <span className="min-w-0 flex-1 truncate px-1 font-mono text-sm font-bold first-letter:uppercase">{longDay.format(new Date(`${data.date}T00:00:00Z`))}</span>
        <Input aria-label="Ir a la fecha" className="h-11 w-40" onChange={(event) => event.target.value && router.push(query(event.target.value))} type="date" value={data.date} />
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {data.waitlist.length > 0 ? (
          <section aria-label="Lista de espera" className="mb-3 space-y-1.5 border-2 border-dashed border-warning bg-warning/10 p-2" data-testid="pos-waitlist">
            <h2 className="flex items-center gap-1.5 font-mono text-sm font-black"><Hourglass aria-hidden="true" className="size-4" />Lista de espera ({data.waitlist.length})</h2>
            <ul className="grid gap-1.5 md:grid-cols-2">
              {data.waitlist.map((entry) => {
                const waited = Math.max(0, Math.round((now - new Date(entry.createdAt).getTime()) / 60_000));
                return (
                  <li className="flex flex-wrap items-center gap-2 border border-window-dark-shadow bg-window-surface p-2" data-testid={`pos-waitlist-${entry.name}`} key={entry.id}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold"><span className="mr-1 font-mono">{entry.partySize}p</span>{entry.name}</p>
                      <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                        <span className="font-bold">{entry.source === "WALK_IN" ? "En la puerta" : "Web"}</span>
                        {entry.source === "WALK_IN" ? <span>{waited < 60 ? `${waited} min esperando` : `${Math.floor(waited / 60)} h ${waited % 60} min`}</span> : <span>{entry.preferredTime ? `Hacia las ${entry.preferredTime}` : "Cualquier hora"}</span>}
                        {entry.status === "NOTIFIED" ? <span className="font-bold text-success-text" data-testid="pos-waitlist-notified">Avisado</span> : null}
                        {entry.phone ? <a className="text-link underline" href={`tel:${entry.phone.replace(/\s/g, "")}`}>{entry.phone}</a> : null}
                      </p>
                    </div>
                    <span className="flex gap-1">
                      <Button className="h-10" data-testid="pos-waitlist-seat" disabled={busy} onClick={() => setFromWaitlist(entry)} size="sm" type="button">Dar mesa</Button>
                      {entry.status === "WAITING" ? <Button className="h-10" disabled={busy} onClick={() => void setWaitlist(entry, "NOTIFIED", `${entry.name}: avisado.`)} size="sm" type="button" variant="outline">Avisado</Button> : null}
                      <Button aria-label={`Quitar a ${entry.name} de la lista`} className="h-10" disabled={busy} onClick={() => void setWaitlist(entry, "CANCELLED", null)} size="sm" type="button" variant="ghost"><X aria-hidden="true" /></Button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        {!data.enabled ? <p className="mb-2 border border-window-shadow bg-window-panel p-2 text-sm text-muted-foreground">Las reservas online están desactivadas: puedes apuntar reservas por teléfono aquí y activarlas en TPV → Cajas → Reservas online.</p> : null}
        {groups.length === 0 ? (
          <div className="m-auto max-w-sm space-y-3 p-6 text-center">
            <p className="font-mono text-lg font-bold">Sin reservas este día</p>
            <Button className="h-12" onClick={() => setEditing("new")} type="button"><Plus aria-hidden="true" /> Apuntar una reserva</Button>
          </div>
        ) : (
          <ol className="space-y-3" data-testid="pos-bookings-list">
            {groups.map((group) => (
              <li key={group.time}>
                <h2 className="mb-1 font-mono text-sm font-black tabular-nums">{group.time}</h2>
                <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {group.bookings.map((booking) => (
                    <li className={cn("space-y-2 border-2 p-2 shadow-raised", STATUS_TONE[booking.status])} data-testid={`pos-booking-${booking.name}`} key={booking.id}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-mono text-base font-black">{booking.name}</p>
                          <p className="flex flex-wrap items-center gap-x-2 text-sm">
                            <span className="flex items-center gap-0.5 font-bold"><Users aria-hidden="true" className="size-4" />{booking.partySize}</span>
                            <span className="font-semibold">{booking.tableNames || "Sin mesa"}</span>
                            <span className="text-xs text-muted-foreground">{bookingSourceLabels[booking.source]} · {booking.code}</span>
                          </p>
                        </div>
                        <span className={cn("shrink-0 px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase", BADGE_TONE[booking.status])} data-testid="pos-booking-status">{bookingStatusLabels[booking.status]}</span>
                      </div>
                      {booking.depositStatus !== "NONE" && booking.depositAmount ? <p className={cn("inline-block px-1.5 py-0.5 font-mono text-xs font-bold", booking.depositStatus === "PAID" ? "bg-success text-white" : booking.depositStatus === "KEPT" ? "bg-destructive text-destructive-foreground" : "bg-window-panel")} data-testid="pos-booking-deposit">{depositStatusLabels[booking.depositStatus]} · {booking.depositAmount.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</p> : null}
                      {booking.notes ? <p className="border-l-4 border-warning bg-warning/10 px-2 py-1 text-sm">{booking.notes}</p> : null}
                      {booking.phone ? <a className="flex items-center gap-1 text-sm text-link underline" href={`tel:${booking.phone.replace(/\s/g, "")}`}><Phone aria-hidden="true" className="size-4" />{booking.phone}</a> : null}
                      <div className="flex flex-wrap gap-1.5">
                        {booking.status === "PENDING" ? <Button className="h-11" data-testid="pos-booking-confirm" disabled={busy} onClick={() => void act(booking, "CONFIRM", `Reserva de ${booking.name} confirmada.`)} type="button"><Check aria-hidden="true" /> Confirmar</Button> : null}
                        {booking.status === "PENDING" || booking.status === "CONFIRMED" ? (
                          <>
                            <Button className="h-11" data-testid="pos-booking-seat" disabled={busy} onClick={() => (seatRegister ? void seat(booking, seatRegister) : setSeating(booking))} type="button" variant={booking.status === "CONFIRMED" ? "default" : "outline"}><Chair aria-hidden="true" /> Sentar</Button>
                            <Button className="h-11" data-testid="pos-booking-edit" disabled={busy} onClick={() => setEditing(booking)} type="button" variant="outline"><NotePencil aria-hidden="true" /> Editar</Button>
                            <Button className="h-11" data-testid="pos-booking-no-show" disabled={busy} onClick={() => void act(booking, "NO_SHOW", `${booking.name}: no vino.`)} type="button" variant="ghost"><UserMinus aria-hidden="true" /> No vino</Button>
                            <Button className="h-11" data-testid="pos-booking-cancel" disabled={busy} onClick={() => setCancelling(booking)} type="button" variant="ghost"><Prohibit aria-hidden="true" /> Cancelar</Button>
                          </>
                        ) : null}
                        {booking.status === "SEATED" ? (
                          <>
                            {booking.orderId && seatRegister ? <Link className="inline-flex h-11 items-center gap-1.5 border-2 border-primary bg-primary px-3 font-mono text-sm font-bold text-primary-foreground" href={`/pos/${seatRegister}/orders/${booking.orderId}`}><Receipt aria-hidden="true" className="size-4" /> Ver cuenta</Link> : null}
                            <Button className="h-11" disabled={busy} onClick={() => void act(booking, "COMPLETE", "Reserva terminada.")} type="button" variant="outline">Terminada</Button>
                          </>
                        ) : null}
                        {booking.status === "CANCELLED" || booking.status === "NO_SHOW" ? <Button className="h-11" disabled={busy} onClick={() => void act(booking, "RESTORE", "Reserva recuperada.")} type="button" variant="ghost"><ArrowCounterClockwise aria-hidden="true" /> Recuperar</Button> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </div>

      {editing ? <BookingDialog booking={editing === "new" ? null : editing} date={data.date} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh(); }} tables={data.tables} /> : null}
      {fromWaitlist ? (
        <BookingDialog
          booking={null}
          date={data.date}
          onClose={() => setFromWaitlist(null)}
          onSaved={async () => { const entry = fromWaitlist; setFromWaitlist(null); await setWaitlist(entry, "BOOKED", `${entry.name} ya tiene mesa.`); }}
          prefill={{ name: fromWaitlist.name, partySize: fromWaitlist.partySize, phone: fromWaitlist.phone, email: fromWaitlist.email, notes: fromWaitlist.notes, source: fromWaitlist.source === "WALK_IN" ? "WALK_IN" : "PHONE", time: fromWaitlist.source === "WALK_IN" || !fromWaitlist.preferredTime ? (data.date === today ? nowRounded() : "") : fromWaitlist.preferredTime }}
          tables={data.tables}
        />
      ) : null}
      {addingWalkIn ? <WalkInDialog onClose={() => setAddingWalkIn(false)} onSaved={async () => { setAddingWalkIn(false); if (data.date !== today) router.push(query(today)); else await refresh(); }} /> : null}
      {seating ? (
        <Dialog description="¿En qué caja se abre su cuenta?" onClose={() => setSeating(null)} open title={`Sentar a ${seating.name}`}>
          <div className="grid gap-2">
            {registers.length === 0 ? <p className="text-sm text-muted-foreground">No hay cajas en modo «Mesas».</p> : registers.map((register) => <Button className="h-12" disabled={busy} key={register.id} onClick={() => void seat(seating, register.id)} type="button" variant="outline">{register.name}</Button>)}
          </div>
        </Dialog>
      ) : null}
      {cancelling ? <CancelDialog booking={cancelling} onClose={() => setCancelling(null)} onDone={async () => { setCancelling(null); await refresh(); }} /> : null}
    </div>
  );
}

function CancelDialog({ booking, onClose, onDone }: { booking: Booking; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(Boolean(booking.email));
  const [refund, setRefund] = useState(true);
  const [pending, setPending] = useState(false);
  return (
    <Dialog onClose={onClose} open title={`Cancelar la reserva de ${booking.name}`}>
      <div className="space-y-3">
        <label className="grid gap-1 text-sm font-medium">Motivo (opcional)<Input className="h-11" maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder="Lo pidió por teléfono, cierre…" value={reason} /></label>
        {booking.email ? <label className="flex items-center gap-2 text-sm"><input checked={notify} onChange={(event) => setNotify(event.target.checked)} type="checkbox" /> Avisar al cliente por email</label> : null}
        {booking.depositStatus === "PAID" ? <label className="flex items-center gap-2 text-sm"><input checked={refund} data-testid="pos-booking-refund" onChange={(event) => setRefund(event.target.checked)} type="checkbox" /> Devolver la fianza ({booking.depositAmount?.toLocaleString("es-ES", { style: "currency", currency: "EUR" })})</label> : null}
        <div className="grid grid-cols-2 gap-2">
          <Button className="h-12" onClick={onClose} type="button" variant="outline">Volver</Button>
          <Button className="h-12" data-testid="pos-booking-cancel-confirm" disabled={pending} onClick={async () => {
            setPending(true);
            try {
              const result = await postJson<{ refunded?: boolean; refundError?: string | null }>(`/api/pos/bookings/${booking.id}/status`, { action: "CANCEL", reason: reason || null, notifyCustomer: notify, refundDeposit: refund });
              if (result.refundError) toast.error(`Reserva cancelada, pero no se pudo devolver la fianza: ${result.refundError}`);
              else toast.success(result.refunded ? "Reserva cancelada y fianza devuelta." : "Reserva cancelada.");
              await onDone();
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "No se pudo cancelar.");
              setPending(false);
            }
          }} type="button" variant="destructive">Cancelar reserva</Button>
        </div>
      </div>
    </Dialog>
  );
}

type Slot = { time: string; available: boolean; tables: string | null };

/** Alta o cambio de una reserva por el personal: horas con la mesa que se asignaría, o mesas a mano. */
function BookingDialog({ booking, date: initialDate, onClose, onSaved, prefill, tables }: { booking: Booking | null; date: string; onClose: () => void; onSaved: () => Promise<void>; prefill?: Prefill; tables: DayData["tables"] }) {
  const [form, setForm] = useState({
    date: initialDate,
    time: booking?.time ?? prefill?.time ?? "",
    partySize: booking?.partySize ?? prefill?.partySize ?? 2,
    name: booking?.name ?? prefill?.name ?? "",
    phone: booking?.phone ?? prefill?.phone ?? "",
    email: booking?.email ?? prefill?.email ?? "",
    notes: booking?.notes ?? prefill?.notes ?? "",
    source: (booking?.source ?? prefill?.source ?? "PHONE") as BookingSource,
    tableIds: booking?.tableIds ?? ([] as string[]),
  });
  const [slots, setSlots] = useState<{ key: string; list: Slot[] } | null>(null);
  const [pending, setPending] = useState(false);
  const key = `${form.date}|${form.partySize}`;
  useEffect(() => {
    if (form.partySize < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(form.date)) return;
    let cancelled = false;
    fetch(`/api/pos/bookings/availability?date=${form.date}&party=${form.partySize}${booking ? `&ignore=${booking.id}` : ""}`, { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<Slot[]>) : []))
      .catch(() => [] as Slot[])
      .then((list) => {
        if (!cancelled) setSlots({ key: `${form.date}|${form.partySize}`, list });
      });
    return () => {
      cancelled = true;
    };
  }, [form.date, form.partySize, booking]);
  const slotList = slots?.key === key ? slots.list : [];
  const areas = [...new Map(tables.map((table) => [table.areaId, table.areaName])).entries()];

  async function save() {
    setPending(true);
    try {
      const body = { date: form.date, time: form.time, partySize: form.partySize, name: form.name, phone: form.phone || null, email: form.email || null, notes: form.notes || null, tableIds: form.tableIds.length > 0 ? form.tableIds : null };
      if (booking) await postJson(`/api/pos/bookings/${booking.id}`, body, "PATCH");
      else await postJson("/api/pos/bookings", { ...body, source: form.source });
      toast.success(booking ? "Reserva cambiada." : "Reserva apuntada.");
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar la reserva.");
      setPending(false);
    }
  }

  return (
    <Dialog onClose={onClose} open title={booking ? `Reserva de ${booking.name}` : "Nueva reserva"}>
      <div className="max-h-[75dvh] space-y-3 overflow-y-auto pr-1" data-testid="pos-booking-dialog">
        {!booking ? (
          <div aria-label="Origen" className="grid grid-cols-2 gap-1" role="radiogroup">
            {(["PHONE", "WALK_IN"] as const).map((source) => (
              <button aria-checked={form.source === source} className={cn("h-11 border-2 font-mono text-sm font-bold", form.source === source ? "border-primary bg-primary text-primary-foreground" : "border-window-dark-shadow bg-window-panel")} key={source} onClick={() => setForm({ ...form, source })} role="radio" type="button">{bookingSourceLabels[source]}</button>
            ))}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-sm font-medium">Día<Input className="h-11" onChange={(event) => setForm({ ...form, date: event.target.value, time: "" })} type="date" value={form.date} /></label>
          <label className="grid gap-1 text-sm font-medium">Personas
            <span className="flex items-center">
              <button aria-label="Una persona menos" className="h-11 w-11 border-2 border-window-dark-shadow bg-window-panel font-mono text-lg font-bold" disabled={form.partySize <= 1} onClick={() => setForm({ ...form, partySize: form.partySize - 1 })} type="button">−</button>
              <span className="w-12 text-center font-mono text-lg font-black tabular-nums" data-testid="pos-booking-party">{form.partySize}</span>
              <button aria-label="Una persona más" className="h-11 w-11 border-2 border-window-dark-shadow bg-window-panel font-mono text-lg font-bold" onClick={() => setForm({ ...form, partySize: form.partySize + 1 })} type="button">+</button>
            </span>
          </label>
        </div>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Hora</legend>
          <div className="grid grid-cols-4 gap-1">
            {slotList.map((slot) => (
              <button aria-pressed={form.time === slot.time} className={cn("h-11 border-2 font-mono text-sm font-bold tabular-nums", form.time === slot.time ? "border-primary bg-primary text-primary-foreground" : slot.available ? "border-window-dark-shadow bg-window-panel" : "border-dashed border-window-shadow text-muted-foreground")} data-testid={`pos-booking-slot-${slot.time}`} key={slot.time} onClick={() => setForm({ ...form, time: slot.time })} title={slot.available ? `Mesa: ${slot.tables}` : "Completo (puedes elegir mesas a mano)"} type="button">{slot.time}</button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">Otra hora<Input aria-label="Hora de la reserva" className="h-11 w-32" onChange={(event) => setForm({ ...form, time: event.target.value })} step={300} type="time" value={form.time} /></label>
          {form.time ? <p className="text-xs text-muted-foreground">{form.tableIds.length > 0 ? "Mesas elegidas a mano." : slotList.find((slot) => slot.time === form.time)?.tables ? `Se le asignará: ${slotList.find((slot) => slot.time === form.time)?.tables}` : "Se asigna la mejor mesa libre al guardar."}</p> : null}
        </fieldset>
        <label className="grid gap-1 text-sm font-medium">Nombre<Input className="h-11" maxLength={80} onChange={(event) => setForm({ ...form, name: event.target.value })} value={form.name} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-sm font-medium">Teléfono<Input className="h-11" inputMode="tel" maxLength={30} onChange={(event) => setForm({ ...form, phone: event.target.value })} type="tel" value={form.phone} /></label>
          <label className="grid gap-1 text-sm font-medium">Email<Input className="h-11" maxLength={200} onChange={(event) => setForm({ ...form, email: event.target.value })} type="email" value={form.email} /></label>
        </div>
        <label className="grid gap-1 text-sm font-medium">Comentarios<Textarea maxLength={500} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Alergias, trona, cumpleaños…" rows={2} value={form.notes} /></label>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Mesas <span className="font-normal text-muted-foreground">(vacío = automática)</span></legend>
          {areas.map(([areaId, areaName]) => (
            <div className="flex flex-wrap items-center gap-1" key={areaId}>
              <span className="w-full text-xs text-muted-foreground">{areaName}</span>
              {tables.filter((table) => table.areaId === areaId).map((table) => {
                const selected = form.tableIds.includes(table.id);
                return <button aria-pressed={selected} className={cn("h-10 border-2 px-2 font-mono text-xs font-bold", selected ? "border-primary bg-primary text-primary-foreground" : "border-window-dark-shadow bg-window-panel")} key={table.id} onClick={() => setForm({ ...form, tableIds: selected ? form.tableIds.filter((id) => id !== table.id) : [...form.tableIds, table.id] })} type="button">{table.name} · {table.seats}</button>;
              })}
            </div>
          ))}
        </fieldset>
        <Button className="h-12 w-full" data-testid="pos-booking-save" disabled={pending || !form.name.trim() || !form.time} onClick={() => void save()} type="button">{booking ? "Guardar cambios" : "Apuntar reserva"}</Button>
      </div>
    </Dialog>
  );
}

/** Grupo que llega sin reserva y espera mesa. */
function WalkInDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ name: "", partySize: 2, phone: "" });
  const [pending, setPending] = useState(false);
  return (
    <Dialog description="Se apunta en la lista de espera de hoy con la hora de llegada." onClose={onClose} open title="Esperando en la puerta">
      <div className="space-y-3" data-testid="pos-walk-in-dialog">
        <label className="grid gap-1 text-sm font-medium">Nombre<Input autoFocus className="h-12 text-base" maxLength={80} onChange={(event) => setForm({ ...form, name: event.target.value })} value={form.name} /></label>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Personas</span>
          <button aria-label="Una persona menos" className="h-12 w-12 border-2 border-window-dark-shadow bg-window-panel font-mono text-lg font-bold" disabled={form.partySize <= 1} onClick={() => setForm({ ...form, partySize: form.partySize - 1 })} type="button">−</button>
          <span className="w-10 text-center font-mono text-xl font-black">{form.partySize}</span>
          <button aria-label="Una persona más" className="h-12 w-12 border-2 border-window-dark-shadow bg-window-panel font-mono text-lg font-bold" onClick={() => setForm({ ...form, partySize: form.partySize + 1 })} type="button">+</button>
        </div>
        <label className="grid gap-1 text-sm font-medium">Teléfono (para avisarle)<Input className="h-12 text-base" inputMode="tel" maxLength={30} onChange={(event) => setForm({ ...form, phone: event.target.value })} type="tel" value={form.phone} /></label>
        <Button className="h-12 w-full" data-testid="pos-walk-in-save" disabled={pending || !form.name.trim()} onClick={async () => {
          setPending(true);
          try {
            await postJson("/api/pos/bookings/waitlist", { name: form.name, partySize: form.partySize, phone: form.phone || null });
            toast.success(`${form.name} apuntado en la lista de espera.`);
            await onSaved();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "No se pudo apuntar.");
            setPending(false);
          }
        }} type="button">Apuntar</Button>
      </div>
    </Dialog>
  );
}
