"use client";

import { CalendarBlank, CheckCircle, Clock, Users } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { addDays, weekdayOf } from "@/modules/hospitality/bookings";

export type PublicPage = {
  slug: string;
  name: string;
  phone: string | null;
  welcomeMessage: string | null;
  minPartySize: number;
  maxPartySize: number;
  autoConfirm: boolean;
  cancellationHours: number;
  today: string;
  lastDay: string;
  openWeekdays: number[];
  closures: string[];
};

type Slot = { time: string; available: boolean };

const dayFormat = new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const longDay = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const asDate = (value: string) => new Date(`${value}T00:00:00Z`);
const upperFirst = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

async function readError(response: Response) {
  try {
    const body = (await response.json()) as { message?: string; error?: string };
    return body.message ?? body.error ?? "No se pudo completar la reserva.";
  } catch {
    return "No se pudo completar la reserva.";
  }
}

/** Reserva en tres pasos en una sola pantalla: personas y día → hora → tus datos. */
export function BookingForm({ embed, page }: { embed: boolean; page: PublicPage }) {
  const router = useRouter();
  const isOpen = (date: string) => page.openWeekdays.includes(weekdayOf(date)) && !page.closures.includes(date) && date <= page.lastDay;
  const firstOpen = Array.from({ length: 60 }, (_, index) => addDays(page.today, index)).find(isOpen) ?? page.today;
  const [party, setParty] = useState(Math.min(Math.max(2, page.minPartySize), page.maxPartySize));
  const [date, setDate] = useState(firstOpen);
  const [time, setTime] = useState<string | null>(null);
  const [slots, setSlots] = useState<{ key: string; slots: Slot[]; reason: string | null } | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", notes: "", consent: false, website: "" });
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [reload, setReload] = useState(0);
  const days = Array.from({ length: 14 }, (_, index) => addDays(page.today, index)).filter((day) => day <= page.lastDay);
  const key = `${date}|${party}`;
  const loading = slots?.key !== `${key}|${reload}`;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/bookings/${page.slug}/availability?date=${date}&party=${party}`, { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as { slots: Slot[]; reason: string | null }) : { slots: [], reason: await readError(response) }))
      .catch(() => ({ slots: [], reason: "No se pudo consultar la disponibilidad. Revisa tu conexión." }))
      .then((result) => {
        if (!cancelled) setSlots({ key: `${date}|${party}|${reload}`, ...result });
      });
    return () => {
      cancelled = true;
    };
  }, [date, party, page.slug, reload]);

  function choose(next: { date?: string; party?: number }) {
    if (next.date) setDate(next.date);
    if (next.party) setParty(next.party);
    setTime(null);
    setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!time) return setError("Elige una hora.");
    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/public/bookings/${page.slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, time, partySize: party, name: form.name, phone: form.phone, email: form.email, notes: form.notes || null, consent: form.consent, website: form.website }),
      });
      if (!response.ok) {
        setError(await readError(response));
        if (response.status === 409) {
          setTime(null);
          setReload((current) => current + 1);
        }
        return;
      }
      const result = (await response.json()) as { token: string };
      router.push(`/reservar/gestion/${result.token}?nueva=1${embed ? "&embed=1" : ""}`);
    } finally {
      setSending(false);
    }
  }

  const partyOptions = Array.from({ length: page.maxPartySize - page.minPartySize + 1 }, (_, index) => page.minPartySize + index);
  const available = slots && !loading ? slots.slots.filter((slot) => slot.available) : [];

  return (
    <form className="space-y-5" data-testid="booking-form" onSubmit={submit}>
      <div>
        <h1 className="font-mono text-xl font-bold">Reserva tu mesa</h1>
        {page.welcomeMessage ? <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{page.welcomeMessage}</p> : null}
      </div>

      <fieldset className="space-y-2">
        <legend className="flex items-center gap-1.5 font-mono text-sm font-bold"><Users aria-hidden="true" className="size-4" /> ¿Cuántas personas?</legend>
        <div className="flex flex-wrap gap-1.5">
          {partyOptions.map((option) => (
            <button aria-pressed={party === option} className={cn("h-11 min-w-11 border-2 px-2 font-mono text-base font-bold", party === option ? "border-primary bg-primary text-primary-foreground" : "border-window-dark-shadow bg-window-panel hover:bg-window-highlight")} key={option} onClick={() => choose({ party: option })} type="button">{option}</button>
          ))}
        </div>
        {page.phone ? <p className="text-xs text-muted-foreground">¿Sois más de {page.maxPartySize}? Llámanos al <a className="underline" href={`tel:${page.phone.replace(/\s/g, "")}`}>{page.phone}</a>.</p> : null}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="flex items-center gap-1.5 font-mono text-sm font-bold"><CalendarBlank aria-hidden="true" className="size-4" /> ¿Qué día?</legend>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
          {days.map((day) => {
            const open = isOpen(day);
            return (
              <button aria-label={`${longDay.format(asDate(day))}${open ? "" : " (cerrado)"}`} aria-pressed={date === day} className={cn("flex h-14 w-16 shrink-0 flex-col items-center justify-center border-2 font-mono text-xs leading-tight", date === day ? "border-primary bg-primary text-primary-foreground" : open ? "border-window-dark-shadow bg-window-panel hover:bg-window-highlight" : "border-dashed border-window-shadow text-muted-foreground line-through")} data-testid={`booking-day-${day}`} disabled={!open} key={day} onClick={() => choose({ date: day })} type="button">
                {day === page.today ? <span className="font-bold">Hoy</span> : <span className="font-bold capitalize">{dayFormat.format(asDate(day)).split(" ")[0].replace(",", "")}</span>}
                <span>{dayFormat.format(asDate(day)).split(" ").slice(1).join(" ")}</span>
              </button>
            );
          })}
        </div>
        <label className="flex flex-wrap items-center gap-2 text-sm">Otra fecha:
          <Input aria-label="Fecha de la reserva" className="h-11 w-44" max={page.lastDay} min={page.today} onChange={(event) => event.target.value && choose({ date: event.target.value })} type="date" value={date} />
        </label>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="flex items-center gap-1.5 font-mono text-sm font-bold"><Clock aria-hidden="true" className="size-4" /> ¿A qué hora? <span className="font-normal text-muted-foreground">· {upperFirst(longDay.format(asDate(date)))}</span></legend>
        {loading ? (
          <p className="text-sm text-muted-foreground" role="status">Buscando mesas libres…</p>
        ) : slots && slots.slots.length > 0 ? (
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6" data-testid="booking-slots">
            {slots.slots.map((slot) => (
              <button aria-label={slot.available ? `A las ${slot.time}` : `A las ${slot.time}: completo`} aria-pressed={time === slot.time} className={cn("h-11 border-2 font-mono text-sm font-bold tabular-nums", time === slot.time ? "border-primary bg-primary text-primary-foreground" : slot.available ? "border-window-dark-shadow bg-window-panel hover:bg-window-highlight" : "border-dashed border-window-shadow text-muted-foreground line-through")} data-testid={`booking-slot-${slot.time}`} disabled={!slot.available} key={slot.time} onClick={() => { setTime(slot.time); setError(null); }} type="button">{slot.time}</button>
            ))}
          </div>
        ) : null}
        {!loading && slots?.reason ? <p className="text-sm text-warning-text" role="status">{slots.reason}</p> : null}
        {!loading && slots && available.length === 0 && !slots.reason ? <p className="text-sm text-warning-text" role="status">No quedan mesas ese día.</p> : null}
      </fieldset>

      {time ? (
        <fieldset className="space-y-3 border-t border-window-shadow pt-4" data-testid="booking-contact">
          <legend className="sr-only">Tus datos</legend>
          <p className="font-mono text-sm font-bold">Mesa para {party} · {upperFirst(longDay.format(asDate(date)))} a las {time}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium sm:col-span-2">Nombre<Input autoComplete="name" className="h-11 text-base" maxLength={80} onChange={(event) => setForm({ ...form, name: event.target.value })} required value={form.name} /></label>
            <label className="grid gap-1 text-sm font-medium">Teléfono<Input autoComplete="tel" className="h-11 text-base" inputMode="tel" maxLength={30} onChange={(event) => setForm({ ...form, phone: event.target.value })} required type="tel" value={form.phone} /></label>
            <label className="grid gap-1 text-sm font-medium">Email<Input autoComplete="email" className="h-11 text-base" maxLength={200} onChange={(event) => setForm({ ...form, email: event.target.value })} required type="email" value={form.email} /></label>
            <label className="grid gap-1 text-sm font-medium sm:col-span-2">Comentarios (opcional)<Textarea maxLength={500} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Alergias, trona, celebración, terraza…" rows={2} value={form.notes} /></label>
          </div>
          {/* Trampa para bots: oculto a las personas y a los lectores de pantalla. */}
          <div aria-hidden="true" className="absolute left-[-10000px] h-px w-px overflow-hidden">
            <label>Web<input autoComplete="off" name="website" onChange={(event) => setForm({ ...form, website: event.target.value })} tabIndex={-1} value={form.website} /></label>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input checked={form.consent} className="mt-1 size-4" onChange={(event) => setForm({ ...form, consent: event.target.checked })} required type="checkbox" />
            <span>Acepto que {page.name} use mis datos solo para gestionar esta reserva y avisarme de ella.</span>
          </label>
          <p className="text-xs text-muted-foreground">
            {page.autoConfirm ? "La confirmación es inmediata y te llegará por email." : "El restaurante revisará tu solicitud y te confirmará por email."}
            {page.cancellationHours > 0 ? ` Puedes cancelar gratis desde el enlace del email hasta ${page.cancellationHours} h antes.` : " Puedes cancelar desde el enlace del email."}
          </p>
        </fieldset>
      ) : null}

      {error ? <p className="border-2 border-destructive bg-destructive/10 p-2 text-sm font-semibold text-destructive" role="alert">{error}</p> : null}

      <Button className="h-14 w-full text-lg" data-testid="booking-submit" disabled={!time || sending} type="submit">
        <CheckCircle aria-hidden="true" /> {sending ? "Reservando…" : time ? (page.autoConfirm ? "Confirmar reserva" : "Solicitar reserva") : "Elige una hora"}
      </Button>
    </form>
  );
}
