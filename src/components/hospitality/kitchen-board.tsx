"use client";

import { BellRinging, CheckCircle, Clock, Coffee, CookingPot, SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatElapsed, minutesSince, type LineStatus } from "@/modules/hospitality/model";

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
  lines: Array<{ id: string; description: string; quantity: number; note: string | null; status: LineStatus }>;
};

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
    if (fresh.length > 0 && sound) beep();
    known.current = new Set(batches.map((batch) => batch.batchId));
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

  const pendingLines = batches.reduce((sum, batch) => sum + batch.lines.filter((line) => line.status === "SENT").length, 0);

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
            {batches.map((batch) => {
              const minutes = batch.sentAt ? minutesSince(batch.sentAt, now) : 0;
              const allReady = batch.lines.every((line) => line.status === "READY");
              return (
                <li className={cn("flex flex-col border-2 bg-card", allReady ? "border-success" : minutes >= 20 ? "border-destructive" : minutes >= 10 ? "border-warning" : "border-window-dark-shadow")} data-testid={`pos-kitchen-batch-${batch.name}`} key={batch.batchId}>
                  <header className={cn("flex items-center justify-between gap-2 px-3 py-2", allReady ? "bg-success text-white" : minutes >= 20 ? "bg-destructive text-white" : minutes >= 10 ? "bg-warning/40" : "bg-window-panel")}>
                    <span className="font-mono text-xl font-black">{batch.name}</span>
                    <span className="flex items-center gap-1 font-mono text-sm font-bold"><Clock aria-hidden="true" className="size-4" />{formatElapsed(minutes)}</span>
                  </header>
                  {batch.waiterName ? <p className="px-3 pt-1 text-xs text-muted-foreground">{batch.waiterName}</p> : null}
                  <ul className="flex-1 divide-y divide-window-shadow">
                    {batch.lines.map((line) => (
                      <li key={line.id}>
                        <button className={cn("flex min-h-14 w-full items-start gap-2 px-3 py-2 text-left", line.status === "READY" && "bg-success/15")} data-testid="pos-kitchen-line" onClick={() => void setStatus([line.id], line.status === "READY" ? "SENT" : "READY")} type="button">
                          <span className="font-mono text-2xl font-black">{line.quantity.toLocaleString("es-ES")}</span>
                          <span className="min-w-0 flex-1">
                            <span className={cn("block text-base font-bold", line.status === "READY" && "line-through opacity-70")}>{line.description}</span>
                            {line.note ? <span className="block text-sm font-bold text-destructive">{line.note}</span> : null}
                          </span>
                          {line.status === "READY" ? <BellRinging aria-label="Listo" className="size-6 text-success" /> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="grid grid-cols-2 gap-1.5 border-t border-window-shadow p-2">
                    <Button className="h-12" data-testid="pos-kitchen-all-ready" disabled={allReady} onClick={() => void setStatus(batch.lines.map((line) => line.id), "READY")} type="button" variant="outline">Todo listo</Button>
                    <Button className="h-12" data-testid="pos-kitchen-served" onClick={() => void setStatus(batch.lines.map((line) => line.id), "SERVED")} type="button">Servido</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
