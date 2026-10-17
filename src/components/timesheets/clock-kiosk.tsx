"use client";

import { Backspace, CheckCircle, Clock } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { postJson } from "@/components/hospitality/types";
import { KioskBar } from "@/components/pos/kiosk-bar";
import { useWakeLock } from "@/components/pos/use-touch-pos";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { entryActionLabels, entryKindLabels, type EntryKind, type WorkState } from "@/modules/timesheets/model";

type Identified = { userId: string; name: string; state: WorkState; actions: EntryKind[]; since: string | null };
const STATE_LABEL: Record<WorkState, string> = { OFF: "Fuera", WORKING: "Trabajando", ON_BREAK: "En pausa" };

/**
 * Tablet de fichar en el local: cada trabajador teclea su PIN y toca el fichaje que le toca. La
 * pantalla vuelve sola al teclado a los pocos segundos para el siguiente.
 */
export function ClockKiosk({ companyName }: { companyName: string }) {
  const [pin, setPin] = useState("");
  const [who, setWho] = useState<Identified | null>(null);
  const [done, setDone] = useState<{ name: string; kind: EntryKind; time: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useWakeLock(true);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  // Tras fichar (o si se queda a medias), vuelve al teclado.
  useEffect(() => {
    if (!done && !who) return;
    const timer = window.setTimeout(() => { setDone(null); setWho(null); setPin(""); }, done ? 4000 : 20_000);
    return () => window.clearTimeout(timer);
  }, [done, who]);

  async function identify(value: string) {
    setPending(true);
    setError(null);
    try {
      setWho(await postJson<Identified>("/api/timesheets/kiosk", { pin: value }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "No se pudo comprobar el PIN.");
      setPin("");
    } finally {
      setPending(false);
    }
  }

  async function clock(kind: EntryKind) {
    if (!who) return;
    setPending(true);
    try {
      await postJson("/api/timesheets/kiosk", { pin, kind });
      setDone({ name: who.name, kind, time: new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) });
      setWho(null);
      setPin("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "No se pudo fichar.");
    } finally {
      setPending(false);
    }
  }

  function press(digit: string) {
    if (pending || pin.length >= 6) return;
    const next = pin + digit;
    setPin(next);
    setError(null);
  }

  return (
    <div className="flex h-dvh flex-col bg-background [touch-action:manipulation]" data-testid="timesheet-kiosk">
      <KioskBar backHref="/jornada" backLabel="Jornada" status={companyName} title="Fichar" />
      <div className="m-auto w-full max-w-sm space-y-4 p-4">
        <p className="flex items-center justify-center gap-2 font-mono text-4xl font-black tabular-nums"><Clock aria-hidden="true" className="size-8" />{now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</p>
        {done ? (
          <div className="space-y-2 border-2 border-success bg-success/10 p-6 text-center" data-testid="timesheet-kiosk-done" role="status">
            <CheckCircle aria-hidden="true" className="mx-auto size-14 text-success" weight="fill" />
            <p className="font-mono text-2xl font-black">{entryKindLabels[done.kind]} · {done.time}</p>
            <p className="text-lg">{done.kind === "OUT" ? `¡Hasta luego, ${done.name}!` : done.kind === "IN" ? `¡Buen turno, ${done.name}!` : done.name}</p>
          </div>
        ) : who ? (
          <div className="space-y-3 text-center" data-testid="timesheet-kiosk-actions">
            <p className="text-2xl font-black">{who.name}</p>
            <p className="text-sm text-muted-foreground">Ahora: <strong>{STATE_LABEL[who.state]}</strong></p>
            <div className="grid gap-2">
              {who.actions.map((kind) => <Button className="h-20 text-2xl" data-testid={`timesheet-kiosk-${kind}`} disabled={pending} key={kind} onClick={() => void clock(kind)} type="button" variant={kind === "OUT" || kind === "BREAK_START" ? "outline" : "default"}>{entryActionLabels[kind]}</Button>)}
            </div>
            <Button className="h-12 w-full" onClick={() => { setWho(null); setPin(""); }} type="button" variant="ghost">No soy {who.name}</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-center text-lg font-semibold">Teclea tu PIN</p>
            <p aria-label={`${pin.length} cifras`} className="flex h-12 items-center justify-center gap-3" data-testid="timesheet-kiosk-pin">
              {Array.from({ length: Math.max(4, pin.length) }, (_, index) => <span className={cn("size-4 rounded-full border-2 border-window-dark-shadow", index < pin.length && "bg-window-dark-shadow")} key={index} />)}
            </p>
            {error ? <p className="text-center text-sm font-semibold text-destructive" data-testid="timesheet-kiosk-error" role="alert">{error}</p> : null}
            <div className="grid grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => <button className="h-20 border-2 border-window-dark-shadow bg-window-panel font-mono text-3xl font-black active:translate-y-px" key={digit} onClick={() => press(digit)} type="button">{digit}</button>)}
              <button aria-label="Borrar" className="grid h-20 place-items-center border-2 border-window-dark-shadow bg-window-panel" onClick={() => setPin(pin.slice(0, -1))} type="button"><Backspace aria-hidden="true" className="size-8" /></button>
              <button className="h-20 border-2 border-window-dark-shadow bg-window-panel font-mono text-3xl font-black active:translate-y-px" onClick={() => press("0")} type="button">0</button>
              <button className="h-20 border-2 border-primary bg-primary font-mono text-lg font-black text-primary-foreground disabled:opacity-50" data-testid="timesheet-kiosk-ok" disabled={pin.length < 4 || pending} onClick={() => void identify(pin)} type="button">OK</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
