"use client";

import { Copy, Plus, Trash } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { postJson } from "@/components/hospitality/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { slugify, WEEKDAY_LABELS } from "@/modules/hospitality/bookings";

type Shift = { weekday: number; opensAt: string; lastStart: string };
export type BookingSettingsData = {
  enabled: boolean;
  slug: string;
  registerId: string | null;
  slotMinutes: number;
  durationMinutes: number;
  minPartySize: number;
  maxPartySize: number;
  leadMinutes: number;
  maxDaysAhead: number;
  autoConfirm: boolean;
  cancellationHours: number;
  allowCombining: boolean;
  welcomeMessage: string | null;
  notifyEmail: string | null;
  sendReminders: boolean;
  depositEnabled: boolean;
  depositProvider: "STRIPE" | "REDSYS" | null;
  depositPerPerson: number;
  depositMinParty: number;
  depositRefundable: boolean;
  hours: Shift[];
  closures: Array<{ id: string; date: string; reason: string | null }>;
};

// De lunes a domingo, como en un calendario español.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DEFAULT_SHIFTS: Shift[] = [
  { weekday: -1, opensAt: "13:00", lastStart: "15:30" },
  { weekday: -1, opensAt: "20:00", lastStart: "22:30" },
];

function NumberField({ label, hint, value, onChange, min, max, disabled, testId }: { label: string; hint?: string; value: number; onChange: (value: number) => void; min: number; max: number; disabled: boolean; testId?: string }) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <Input className="h-11 w-28" data-testid={testId} disabled={disabled} inputMode="numeric" max={max} min={min} onChange={(event) => onChange(Number(event.target.value.replace(/\D/g, "")) || 0)} value={String(value)} />
      {hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function Toggle({ checked, disabled, label, hint, onChange, testId }: { checked: boolean; disabled: boolean; label: string; hint?: string; onChange: (value: boolean) => void; testId?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input checked={checked} className="mt-0.5 size-4" data-testid={testId} disabled={disabled} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      <span><span className="font-medium">{label}</span>{hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}</span>
    </label>
  );
}

/** Reglas de las reservas online: horario por turnos, duración, grupos, antelación, cierres y avisos. */
export function BookingSettings({ baseUrl, canManage, initial, paymentProviders = { STRIPE: false, REDSYS: false }, qrDataUrl, registers }: { baseUrl: string; canManage: boolean; initial: BookingSettingsData; paymentProviders?: { STRIPE: boolean; REDSYS: boolean }; qrDataUrl: string | null; registers: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [pending, setPending] = useState(false);
  const [closure, setClosure] = useState({ date: "", reason: "" });
  const [depositText, setDepositText] = useState(initial.depositPerPerson ? String(initial.depositPerPerson).replace(".", ",") : "");
  const disabled = !canManage || pending;
  const publicUrl = `${baseUrl}/reservar/${slugify(data.slug) || "…"}`;
  const embedCode = `<iframe src="${publicUrl}?embed=1" title="Reservar mesa" style="width:100%;max-width:640px;height:900px;border:0" loading="lazy"></iframe>`;
  const set = <K extends keyof BookingSettingsData>(key: K, value: BookingSettingsData[K]) => setData((current) => ({ ...current, [key]: value }));

  async function run(work: () => Promise<unknown>, success: string) {
    setPending(true);
    try {
      await work();
      toast.success(success);
      router.refresh();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar.");
      return false;
    } finally {
      setPending(false);
    }
  }

  function setShift(index: number, change: Partial<Shift>) {
    set("hours", data.hours.map((shift, position) => (position === index ? { ...shift, ...change } : shift)));
  }

  function copyToAll(weekday: number) {
    const source = data.hours.filter((shift) => shift.weekday === weekday);
    set("hours", WEEK_ORDER.flatMap((day) => (day === weekday ? source : source.map((shift) => ({ ...shift, weekday: day })))));
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copiado.`);
    } catch {
      toast.error("No se pudo copiar: selecciónalo y cópialo a mano.");
    }
  }

  const save = () => run(() => postJson("/api/pos/bookings/settings", { ...data, closures: undefined, slug: slugify(data.slug) }, "PUT"), data.enabled ? "Reservas guardadas y activas." : "Reservas guardadas.");

  return (
    <div className="space-y-5" data-testid="booking-settings">
      <div className={cn("flex flex-wrap items-center justify-between gap-3 border-2 p-3", data.enabled ? "border-success bg-success/10" : "border-window-shadow bg-window-panel")}>
        <Toggle checked={data.enabled} disabled={disabled} hint="Los clientes reservan desde un enlace, sin registrarse." label="Aceptar reservas online" onChange={(value) => set("enabled", value)} testId="booking-enabled" />
        {initial.enabled ? <a className="font-mono text-sm font-bold text-link underline" href={publicUrl} rel="noreferrer" target="_blank">Abrir el formulario</a> : null}
      </div>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-3">
          <h3 className="font-mono text-sm font-bold">Enlace para tus clientes</h3>
          <label className="grid gap-1 text-sm font-medium">
            Dirección
            <span className="flex flex-wrap items-center gap-1">
              <span className="font-mono text-xs text-muted-foreground">{baseUrl}/reservar/</span>
              <Input aria-label="Dirección del formulario" className="h-11 w-56" data-testid="booking-slug" disabled={disabled} maxLength={48} onBlur={() => set("slug", slugify(data.slug))} onChange={(event) => set("slug", event.target.value)} value={data.slug} />
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button className="h-11" onClick={() => void copy(publicUrl, "Enlace")} type="button" variant="outline"><Copy aria-hidden="true" /> Copiar enlace</Button>
            <Button className="h-11" onClick={() => void copy(embedCode, "Código")} type="button" variant="outline"><Copy aria-hidden="true" /> Copiar código para tu web</Button>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">¿Cómo lo pongo en mi web, Instagram o Google?</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Web: pega el código en la página de reservas (en WordPress, un bloque «HTML personalizado»).</li>
              <li>Instagram, WhatsApp o Google Maps: usa el enlace en el botón «Reservar» o en tu biografía.</li>
              <li>En el local: imprime el código QR para las mesas, la carta o el escaparate.</li>
            </ul>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all border border-window-shadow bg-window-panel p-2 font-mono text-xs">{embedCode}</pre>
          </details>
        </div>
        {qrDataUrl ? (
          <figure className="justify-self-start text-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- QR generado en el servidor como data URL */}
            <img alt={`Código QR para reservar en ${publicUrl}`} className="size-36 border border-window-dark-shadow bg-white p-1" src={qrDataUrl} />
            <figcaption className="mt-1"><a className="text-xs text-link underline" download="reservas-qr.png" href={qrDataUrl}>Descargar QR</a></figcaption>
          </figure>
        ) : null}
      </section>

      <section className="space-y-2">
        <h3 className="font-mono text-sm font-bold">Horario de reservas</h3>
        <p className="text-xs text-muted-foreground">Por turnos: «primera» y «última» hora a la que se puede empezar a comer. Un día sin turnos no admite reservas.</p>
        <ul className="divide-y divide-window-shadow border border-window-shadow" data-testid="booking-hours">
          {WEEK_ORDER.map((weekday) => {
            const shifts = data.hours.map((shift, index) => ({ shift, index })).filter(({ shift }) => shift.weekday === weekday);
            return (
              <li className="flex flex-wrap items-start gap-2 p-2" key={weekday}>
                <span className="w-24 pt-2.5 text-sm font-semibold">{WEEKDAY_LABELS[weekday]}</span>
                <div className="flex flex-1 flex-col gap-1.5">
                  {shifts.length === 0 ? <span className="pt-2.5 text-sm text-muted-foreground">Sin reservas</span> : null}
                  {shifts.map(({ shift, index }) => (
                    <span className="flex flex-wrap items-center gap-1.5" key={index}>
                      <Input aria-label={`${WEEKDAY_LABELS[weekday]}: primera reserva`} className="h-10 w-28" disabled={disabled} onChange={(event) => setShift(index, { opensAt: event.target.value })} step={300} type="time" value={shift.opensAt} />
                      <span className="text-sm">a</span>
                      <Input aria-label={`${WEEKDAY_LABELS[weekday]}: última reserva`} className="h-10 w-28" disabled={disabled} onChange={(event) => setShift(index, { lastStart: event.target.value })} step={300} type="time" value={shift.lastStart} />
                      <Button aria-label={`Quitar turno del ${WEEKDAY_LABELS[weekday].toLowerCase()}`} disabled={disabled} onClick={() => set("hours", data.hours.filter((_, position) => position !== index))} size="icon-sm" type="button" variant="ghost"><Trash aria-hidden="true" /></Button>
                    </span>
                  ))}
                </div>
                <span className="flex gap-1">
                  <Button className="h-10" data-testid={`booking-add-shift-${weekday}`} disabled={disabled || shifts.length >= 4} onClick={() => set("hours", [...data.hours, { ...DEFAULT_SHIFTS[Math.min(shifts.length, 1)], weekday }])} size="sm" type="button" variant="outline"><Plus aria-hidden="true" /> Turno</Button>
                  {shifts.length > 0 ? <Button className="h-10" disabled={disabled} onClick={() => copyToAll(weekday)} size="sm" type="button" variant="ghost">Copiar a todos</Button> : null}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-3">
        <h3 className="font-mono text-sm font-bold">Reglas</h3>
        <div className="flex flex-wrap gap-4">
          <NumberField disabled={disabled} hint="Cada cuánto se ofrece una hora" label="Intervalo (min)" max={120} min={5} onChange={(value) => set("slotMinutes", value)} value={data.slotMinutes} />
          <NumberField disabled={disabled} hint="Lo que ocupan la mesa" label="Duración (min)" max={600} min={15} onChange={(value) => set("durationMinutes", value)} testId="booking-duration" value={data.durationMinutes} />
          <NumberField disabled={disabled} label="Mínimo personas" max={100} min={1} onChange={(value) => set("minPartySize", value)} value={data.minPartySize} />
          <NumberField disabled={disabled} hint="Más, por teléfono" label="Máximo personas" max={100} min={1} onChange={(value) => set("maxPartySize", value)} testId="booking-max-party" value={data.maxPartySize} />
          <NumberField disabled={disabled} hint="Antelación mínima" label="Hasta (min antes)" max={10080} min={0} onChange={(value) => set("leadMinutes", value)} value={data.leadMinutes} />
          <NumberField disabled={disabled} hint="Antelación máxima" label="Días vista" max={365} min={1} onChange={(value) => set("maxDaysAhead", value)} value={data.maxDaysAhead} />
          <NumberField disabled={disabled} hint="El cliente cancela online hasta" label="Cancelar (h antes)" max={168} min={0} onChange={(value) => set("cancellationHours", value)} value={data.cancellationHours} />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Toggle checked={data.autoConfirm} disabled={disabled} hint="Si no, quedan pendientes hasta que las confirmes." label="Confirmar automáticamente" onChange={(value) => set("autoConfirm", value)} testId="booking-auto-confirm" />
          <Toggle checked={data.allowCombining} disabled={disabled} hint="Para grupos que no caben en una mesa (misma sala)." label="Juntar dos mesas" onChange={(value) => set("allowCombining", value)} />
          <Toggle checked={data.sendReminders} disabled={disabled} hint="Email el día antes con el enlace para cancelar." label="Enviar recordatorio" onChange={(value) => set("sendReminders", value)} />
        </div>
        <fieldset className="space-y-3 border border-window-shadow p-3" data-testid="booking-deposit-settings">
          <legend className="px-1 text-sm font-medium">Fianza contra los «no vino»</legend>
          <Toggle checked={data.depositEnabled} disabled={disabled || (!paymentProviders.STRIPE && !paymentProviders.REDSYS)} hint={!paymentProviders.STRIPE && !paymentProviders.REDSYS ? "Activa antes Stripe o Redsys en «Cobros online y WhatsApp»." : "El cliente paga con tarjeta al reservar; la mesa se le guarda 15 minutos mientras paga."} label="Pedir fianza al reservar online" onChange={(value) => setData((current) => ({ ...current, depositEnabled: value, depositProvider: current.depositProvider ?? (paymentProviders.STRIPE ? "STRIPE" : paymentProviders.REDSYS ? "REDSYS" : null) }))} testId="booking-deposit-enabled" />
          {data.depositEnabled ? (
            <div className="flex flex-wrap items-end gap-4">
              <label className="grid gap-1 text-sm font-medium">Cobrar con
                <select className="h-11 border border-input bg-window-surface px-2 text-sm" disabled={disabled} onChange={(event) => set("depositProvider", event.target.value as "STRIPE" | "REDSYS")} value={data.depositProvider ?? ""}>
                  {paymentProviders.STRIPE ? <option value="STRIPE">Stripe</option> : null}
                  {paymentProviders.REDSYS ? <option value="REDSYS">Redsys (TPV virtual del banco)</option> : null}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-medium">Por persona (€)<Input className="h-11 w-28" data-testid="booking-deposit-amount" disabled={disabled} inputMode="decimal" onChange={(event) => { const text = event.target.value.replace(/[^\d,.]/g, ""); setDepositText(text); set("depositPerPerson", Number(text.replace(",", ".")) || 0); }} value={depositText} /></label>
              <NumberField disabled={disabled} hint="Grupos desde" label="A partir de (personas)" max={100} min={1} onChange={(value) => set("depositMinParty", Math.max(1, value))} value={data.depositMinParty} />
              <Toggle checked={data.depositRefundable} disabled={disabled} hint={`Si cancela hasta ${data.cancellationHours} h antes se le devuelve sola; si no viene, se queda.`} label="Devolver si cancela a tiempo" onChange={(value) => set("depositRefundable", value)} />
            </div>
          ) : null}
        </fieldset>
        <label className="grid gap-1 text-sm font-medium">
          Caja donde se sientan las reservas
          <select className="h-11 w-full max-w-xs border border-input bg-window-surface px-2 text-sm" disabled={disabled} onChange={(event) => set("registerId", event.target.value || null)} value={data.registerId ?? ""}>
            <option value="">Elegir al sentar</option>
            {registers.map((register) => <option key={register.id} value={register.id}>{register.name}</option>)}
          </select>
          <span className="text-xs font-normal text-muted-foreground">Las mesas que se reservan son las marcadas como «reservables» en el plano.</span>
        </label>
        <label className="grid gap-1 text-sm font-medium">Avisarme de reservas nuevas en<Input className="h-11 max-w-sm" disabled={disabled} onChange={(event) => set("notifyEmail", event.target.value)} placeholder="reservas@mirestaurante.es" type="email" value={data.notifyEmail ?? ""} /></label>
        <label className="grid gap-1 text-sm font-medium">Mensaje para el cliente<Textarea disabled={disabled} maxLength={1000} onChange={(event) => set("welcomeMessage", event.target.value)} placeholder="Mantenemos la mesa 15 minutos. Avísanos de alergias en los comentarios." rows={3} value={data.welcomeMessage ?? ""} /></label>
      </section>

      {canManage ? <Button className="h-12" data-testid="booking-settings-save" disabled={pending} onClick={() => void save()} type="button">Guardar reservas</Button> : null}

      <section className="space-y-2 border-t border-window-shadow pt-4">
        <h3 className="font-mono text-sm font-bold">Días cerrados</h3>
        <p className="text-xs text-muted-foreground">Vacaciones, festivos o eventos privados: ese día no se puede reservar online.</p>
        {initial.closures.length > 0 ? (
          <ul className="divide-y divide-window-shadow border border-window-shadow">
            {initial.closures.map((entry) => (
              <li className="flex items-center justify-between gap-2 p-2 text-sm" key={entry.id}>
                <span><strong className="font-mono">{new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${entry.date}T00:00:00Z`))}</strong>{entry.reason ? ` · ${entry.reason}` : ""}</span>
                {canManage ? <Button aria-label={`Quitar cierre del ${entry.date}`} disabled={pending} onClick={() => void run(() => postJson(`/api/pos/bookings/closures/${entry.id}`, {}, "DELETE"), "Cierre quitado.")} size="icon-sm" type="button" variant="ghost"><Trash aria-hidden="true" /></Button> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {canManage ? (
          <form className="flex flex-wrap items-end gap-2" onSubmit={async (event) => { event.preventDefault(); if (closure.date && (await run(() => postJson("/api/pos/bookings/closures", { date: closure.date, reason: closure.reason || null }), "Día cerrado."))) setClosure({ date: "", reason: "" }); }}>
            <label className="grid gap-1 text-sm font-medium">Fecha<Input className="h-11 w-44" onChange={(event) => setClosure({ ...closure, date: event.target.value })} type="date" value={closure.date} /></label>
            <label className="grid gap-1 text-sm font-medium">Motivo (lo ve el cliente)<Input className="h-11 w-56" maxLength={120} onChange={(event) => setClosure({ ...closure, reason: event.target.value })} placeholder="Vacaciones, evento privado…" value={closure.reason} /></label>
            <Button className="h-11" disabled={pending || !closure.date} type="submit" variant="outline"><Plus aria-hidden="true" /> Cerrar ese día</Button>
          </form>
        ) : null}
      </section>
    </div>
  );
}
