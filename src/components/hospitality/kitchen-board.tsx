"use client";

import { BellRinging, CheckCircle, Clock, Coffee, CookingPot, Fire, HourglassMedium, SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatElapsed, minutesSince, type LineStatus } from "@/modules/hospitality/model";
import { courseLabels, courseLongLabels } from "@/modules/hospitality/ordering";

import { KioskAction, KioskBar } from "../pos/kiosk-bar";
import { useWakeLock } from "../pos/use-touch-pos";
import { postJson } from "./types";
import { usePolling } from "./use-polling";

export type KitchenBatch = {
  batchId: string;
  orderId: string;
  name: string;
  waiterName: string | null;
  sentAt: string | null;
  firedAt: string | null;
  lines: Array<{ id: string; description: string; quantity: number; note: string | null; status: LineStatus; course: number; held: boolean; firedAt: string | null; inMenu: boolean }>;
};

// Un tiempo marchado se resalta unos minutos para que cocina lo vea al momento.
const JUST_FIRED_MS = 3 * 60_000;

const SOUND_KEY = "erp:pos:kitchen-sound";

function beep() {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.value = 0.15;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.25);
  } catch {
    // Sin audio disponible: solo el aviso visual.
  }
}

/**
 * Pantalla de cocina o barra (tablet en la pared): comandas por orden de llegada, el tiempo que llevan
 * y su color (ámbar a los 10 min, rojo a los 20). Tocar un plato lo marca listo; «Servido» la retira.
 */
export function KitchenBoard({ initial, initialStation }: { initial: KitchenBatch[]; initialStation: "KITCHEN" | "BAR" }) {
  const [station, setStation] = useState(initialStation);
  const { data: batches, refresh } = usePolling<KitchenBatch[]>(`/api/pos/hospitality/kitchen?station=${station}`, initial, 4000);
  const [sound, setSound] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const known = useRef(new Set(initial.map((batch) => batch.batchId)));
  const fired = useRef(new Set(initial.flatMap((batch) => batch.lines.filter((line) => !line.held).map((line) => line.id))));
  useWakeLock(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setSound(window.localStorage.getItem(SOUND_KEY) !== "0"), 0);
    const clock = window.setInterval(() => setNow(new Date()), 20_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(clock);
    };
  }, []);

  useEffect(() => {
    const fresh = batches.filter((batch) => !known.current.has(batch.batchId));
    // También suena cuando el camarero marcha un tiempo que estaba en espera.
    const marched = batches.flatMap((batch) => batch.lines).filter((line) => !line.held && !fired.current.has(line.id) && known.current.has(batches.find((batch) => batch.lines.includes(line))!.batchId));
    if ((fresh.length > 0 || marched.length > 0) && sound) beep();
    known.current = new Set(batches.map((batch) => batch.batchId));
    fired.current = new Set(batches.flatMap((batch) => batch.lines.filter((line) => !line.held).map((line) => line.id)));
  }, [batches, sound]);

  async function setStatus(lineIds: string[], status: "SENT" | "READY" | "SERVED") {
    try {
      await postJson("/api/pos/hospitality/kitchen/status", { lineIds, status });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar.");
    }
  }

  function changeStation(next: "KITCHEN" | "BAR") {
    setStation(next);
    const url = new URL(window.location.href);
    url.searchParams.set("station", next);
    window.history.replaceState(null, "", url);
  }

  const pendingLines = batches.reduce((sum, batch) => sum + batch.lines.filter((line) => line.status === "SENT" && !line.held).length, 0);
  // Las comandas solo con platos en espera van al final.
  const ordered = [...batches].sort((a, b) => Number(a.lines.every((line) => line.held)) - Number(b.lines.every((line) => line.held)));

  return (
    <div className="flex h-dvh flex-col bg-background [touch-action:manipulation]" data-testid="pos-kitchen">
      <KioskBar backHref="/pos?choose=1" backLabel="TPV" status={`${batches.length} ${batches.length === 1 ? "comanda" : "comandas"} · ${pendingLines} ${pendingLines === 1 ? "plato" : "platos"} por preparar`} title={station === "KITCHEN" ? "Cocina" : "Barra"}>
        <KioskAction aria-pressed={station === "KITCHEN"} data-testid="pos-kitchen-station-kitchen" icon={<CookingPot aria-hidden="true" className="size-5" />} label="Cocina" onClick={() => changeStation("KITCHEN")} />
        <KioskAction aria-pressed={station === "BAR"} data-testid="pos-kitchen-station-bar" icon={<Coffee aria-hidden="true" className="size-5" />} label="Barra" onClick={() => changeStation("BAR")} />
        <KioskAction icon={sound ? <SpeakerHigh aria-hidden="true" className="size-5" /> : <SpeakerSlash aria-hidden="true" className="size-5" />} label={sound ? "Silenciar avisos" : "Activar avisos"} onClick={() => { setSound(!sound); window.localStorage.setItem(SOUND_KEY, sound ? "0" : "1"); }}>Sonido</KioskAction>
      </KioskBar>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {batches.length === 0 ? (
          <p className="flex h-full flex-col items-center justify-center gap-2 text-lg text-muted-foreground"><CheckCircle aria-hidden="true" className="size-12" />Todo al día.</p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-2">
            {ordered.map((batch) => {
              const active = batch.lines.filter((line) => !line.held);
              const held = batch.lines.filter((line) => line.held);
              const onlyHeld = active.length === 0;
              const since = batch.firedAt ?? batch.sentAt;
              const minutes = since && !onlyHeld ? minutesSince(since, now) : 0;
              const allReady = !onlyHeld && active.every((line) => line.status === "READY");
              return (
                <li className={cn("flex flex-col border-2 bg-card", onlyHeld ? "border-dashed border-window-shadow opacity-70" : allReady ? "border-success" : minutes >= 20 ? "border-destructive" : minutes >= 10 ? "border-warning" : "border-window-dark-shadow")} data-testid={`pos-kitchen-batch-${batch.name}`} key={batch.batchId}>
                  <header className={cn("flex items-center justify-between gap-2 px-3 py-2", onlyHeld ? "bg-window-panel" : allReady ? "bg-success text-white" : minutes >= 20 ? "bg-destructive text-white" : minutes >= 10 ? "bg-warning/40" : "bg-window-panel")}>
                    <span className="font-mono text-xl font-black">{batch.name}</span>
                    {onlyHeld ? <span className="flex items-center gap-1 font-mono text-sm font-bold"><HourglassMedium aria-hidden="true" className="size-4" />En espera</span> : <span className="flex items-center gap-1 font-mono text-sm font-bold"><Clock aria-hidden="true" className="size-4" />{formatElapsed(minutes)}</span>}
                  </header>
                  {batch.waiterName ? <p className="px-3 pt-1 text-xs text-muted-foreground">{batch.waiterName}</p> : null}
                  <ul className="flex-1 divide-y divide-window-shadow">
                    {active.map((line) => {
                      const justFired = line.course > 1 && line.firedAt && now.getTime() - new Date(line.firedAt).getTime() < JUST_FIRED_MS && line.status === "SENT";
                      return (
                        <li key={line.id}>
                          <button className={cn("flex min-h-14 w-full items-start gap-2 px-3 py-2 text-left", line.status === "READY" && "bg-success/15", justFired && "bg-warning/25")} data-testid="pos-kitchen-line" onClick={() => void setStatus([line.id], line.status === "READY" ? "SENT" : "READY")} type="button">
                            <span className="font-mono text-2xl font-black">{line.quantity.toLocaleString("es-ES")}</span>
                            <span className="min-w-0 flex-1">
                              <span className={cn("block text-base font-bold", line.status === "READY" && "line-through opacity-70")}>{line.description}{line.inMenu ? <span className="ml-1 text-xs font-normal text-muted-foreground">(menú)</span> : null}</span>
                              {line.note ? <span className="block text-sm font-bold text-destructive">{line.note}</span> : null}
                              <span className="mt-0.5 flex gap-1">
                                {line.course > 0 ? <span className="border border-window-dark-shadow px-1 font-mono text-xs font-bold">{courseLabels[line.course]}</span> : null}
                                {justFired ? <span className="flex items-center gap-0.5 bg-warning px-1 font-mono text-xs font-black text-warning-foreground" data-testid="pos-kitchen-fired"><Fire aria-hidden="true" className="size-3.5" weight="fill" />¡Marcha!</span> : null}
                              </span>
                            </span>
                            {line.status === "READY" ? <BellRinging aria-label="Listo" className="size-6 text-success" /> : null}
                          </button>
                        </li>
                      );
                    })}
                    {held.length > 0 ? (
                      <li className="bg-window-panel/60 px-3 py-2" data-testid="pos-kitchen-held">
                        <p className="flex items-center gap-1 font-mono text-xs font-bold uppercase text-muted-foreground"><HourglassMedium aria-hidden="true" className="size-4" />En espera · {[...new Set(held.map((line) => courseLongLabels[line.course].toLowerCase()))].join(", ")}</p>
                        <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                          {held.map((line) => <li key={line.id}><span className="font-mono font-bold">{line.quantity.toLocaleString("es-ES")}</span> {line.description} <span className="font-mono text-xs">({courseLabels[line.course]})</span>{line.note ? <span className="italic"> · {line.note}</span> : null}</li>)}
                        </ul>
                      </li>
                    ) : null}
                  </ul>
                  {onlyHeld ? null : (
                    <div className="grid grid-cols-2 gap-1.5 border-t border-window-shadow p-2">
                      <Button className="h-12" data-testid="pos-kitchen-all-ready" disabled={allReady} onClick={() => void setStatus(active.map((line) => line.id), "READY")} type="button" variant="outline">Todo listo</Button>
                      <Button className="h-12" data-testid="pos-kitchen-served" onClick={() => void setStatus(active.map((line) => line.id), "SERVED")} type="button">Servido</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
