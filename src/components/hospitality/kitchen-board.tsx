"use client";

import { ArrowCounterClockwise, BellRinging, CheckCircle, CircleHalf, Clock, Coffee, CookingPot, Fire, HourglassMedium, ListNumbers, SpeakerHigh, SpeakerSlash, TextAa, Warning } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AllergenChip } from "@/components/menu/allergen-icons";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatElapsed, minutesSince, type LineStatus } from "@/modules/hospitality/model";
import { courseLabels, courseLongLabels } from "@/modules/hospitality/ordering";
import { productionSummary } from "@/modules/hospitality/service-aids";

import { KioskAction, KioskBar } from "../pos/kiosk-bar";
import { useWakeLock } from "../pos/use-touch-pos";
import { ConnectionBanner } from "./connection-banner";
import { sendOrQueue } from "./offline-queue";
import { usePolling } from "./use-polling";

export type KitchenLine = { id: string; description: string; quantity: number; note: string | null; status: LineStatus; course: number; held: boolean; firedAt: string | null; inMenu: boolean; allergens: string[]; traces: string[] };

export type KitchenBatch = {
  batchId: string;
  orderId: string;
  name: string;
  waiterName: string | null;
  sentAt: string | null;
  firedAt: string | null;
  servedAt?: string | null;
  lines: KitchenLine[];
};

// Un tiempo marchado se resalta unos minutos para que cocina lo vea al momento.
const JUST_FIRED_MS = 3 * 60_000;

const SOUND_KEY = "erp:pos:kitchen-sound";
const SCALE_KEY = "erp:pos:kitchen-scale";
const CONTRAST_KEY = "erp:pos:kitchen-contrast";
const SUMMARY_KEY = "erp:pos:kitchen-summary";
// Tamaños de letra para la tablet de la pared (se leen a dos metros).
const SCALES = [1, 1.25, 1.5] as const;
const SCALE_LABELS = ["Normal", "Grande", "Muy grande"] as const;

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
 * y su color (ámbar a los 10 min, rojo a los 20). Tocar un plato lo marca listo; «Servido» la retira
 * (se puede deshacer o recuperar después). Los alérgenos de la carta salen en cada plato.
 */
export function KitchenBoard({ initial, initialStation }: { initial: KitchenBatch[]; initialStation: "KITCHEN" | "BAR" }) {
  const [station, setStation] = useState(initialStation);
  const { data: batches, refresh } = usePolling<KitchenBatch[]>(`/api/pos/hospitality/kitchen?station=${station}`, initial, 4000);
  const [sound, setSound] = useState(true);
  const [scale, setScale] = useState(0);
  const [contrast, setContrast] = useState(false);
  const [summary, setSummary] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const known = useRef(new Set(initial.map((batch) => batch.batchId)));
  const fired = useRef(new Set(initial.flatMap((batch) => batch.lines.filter((line) => !line.held).map((line) => line.id))));
  useWakeLock(true);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSound(window.localStorage.getItem(SOUND_KEY) !== "0");
      setScale(Math.min(SCALES.length - 1, Math.max(0, Number(window.localStorage.getItem(SCALE_KEY)) || 0)));
      setContrast(window.localStorage.getItem(CONTRAST_KEY) === "1");
      setSummary(window.localStorage.getItem(SUMMARY_KEY) === "1");
    }, 0);
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

  function remember(key: string, value: string) {
    window.localStorage.setItem(key, value);
  }

  async function setStatus(lineIds: string[], status: "SENT" | "READY" | "SERVED") {
    try {
      const outcome = await sendOrQueue("/api/pos/hospitality/kitchen/status", { lineIds, status }, "POST", status === "READY" ? "Marcar listo" : status === "SERVED" ? "Marcar servido" : "Volver a preparación");
      if (!outcome.queued) await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar.");
    }
  }

  /** «Servido» retira la comanda; durante unos segundos se puede deshacer con un toque. */
  async function serve(batch: KitchenBatch, lines: KitchenLine[]) {
    await setStatus(lines.map((line) => line.id), "SERVED");
    toast.success(`${batch.name}: servida.`, {
      duration: 8000,
      action: { label: "Deshacer", onClick: () => void restore(lines) },
    });
  }

  /** Devuelve a la pantalla lo retirado por error, con el estado que tenía cada plato. */
  async function restore(lines: Array<Pick<KitchenLine, "id" | "status">>) {
    const ready = lines.filter((line) => line.status === "READY").map((line) => line.id);
    const cooking = lines.filter((line) => line.status !== "READY").map((line) => line.id);
    if (ready.length > 0) await setStatus(ready, "READY");
    if (cooking.length > 0) await setStatus(cooking, "SENT");
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
  const production = useMemo(() => productionSummary(batches), [batches]);

  return (
    <div className={cn("flex h-dvh flex-col bg-background text-foreground [touch-action:manipulation]", contrast && "dark")} data-testid="pos-kitchen">
      <KioskBar backHref="/pos?choose=1" backLabel="TPV" status={`${batches.length} ${batches.length === 1 ? "comanda" : "comandas"} · ${pendingLines} ${pendingLines === 1 ? "plato" : "platos"} por preparar`} title={station === "KITCHEN" ? "Cocina" : "Barra"}>
        <KioskAction aria-pressed={station === "KITCHEN"} data-testid="pos-kitchen-station-kitchen" icon={<CookingPot aria-hidden="true" className="size-5" />} label="Cocina" onClick={() => changeStation("KITCHEN")} />
        <KioskAction aria-pressed={station === "BAR"} data-testid="pos-kitchen-station-bar" icon={<Coffee aria-hidden="true" className="size-5" />} label="Barra" onClick={() => changeStation("BAR")} />
        <KioskAction aria-pressed={summary} data-testid="pos-kitchen-summary-toggle" icon={<ListNumbers aria-hidden="true" className="size-5" />} label={summary ? "Ocultar el resumen de producción" : "Ver el resumen de producción"} onClick={() => { setSummary(!summary); remember(SUMMARY_KEY, summary ? "0" : "1"); }}>Resumen</KioskAction>
        <KioskAction data-testid="pos-kitchen-recover" icon={<ArrowCounterClockwise aria-hidden="true" className="size-5" />} label="Recuperar una comanda servida" onClick={() => setRecovering(true)}>Recuperar</KioskAction>
        <KioskAction data-testid="pos-kitchen-scale" icon={<TextAa aria-hidden="true" className="size-5" />} label={`Tamaño de letra: ${SCALE_LABELS[scale]}`} onClick={() => { const next = (scale + 1) % SCALES.length; setScale(next); remember(SCALE_KEY, String(next)); }}>Letra</KioskAction>
        <KioskAction aria-pressed={contrast} data-testid="pos-kitchen-contrast" icon={<CircleHalf aria-hidden="true" className="size-5" />} label={contrast ? "Quitar el alto contraste" : "Alto contraste"} onClick={() => { setContrast(!contrast); remember(CONTRAST_KEY, contrast ? "0" : "1"); }}>Contraste</KioskAction>
        <KioskAction icon={sound ? <SpeakerHigh aria-hidden="true" className="size-5" /> : <SpeakerSlash aria-hidden="true" className="size-5" />} label={sound ? "Silenciar avisos" : "Activar avisos"} onClick={() => { setSound(!sound); remember(SOUND_KEY, sound ? "0" : "1"); }}>Sonido</KioskAction>
      </KioskBar>
      <ConnectionBanner onSynced={() => void refresh()} />
      <div className={cn("grid min-h-0 flex-1", summary && "md:grid-cols-[minmax(0,1fr)_16rem]")} style={{ zoom: SCALES[scale] }}>
        {summary ? (
          <aside aria-label="Resumen de producción" className="order-first max-h-40 overflow-y-auto border-b border-window-shadow bg-window-panel p-2 md:order-last md:max-h-none md:border-b-0 md:border-l" data-testid="pos-kitchen-summary">
            <h2 className="mb-1 font-mono text-xs font-bold uppercase text-muted-foreground">Por preparar ahora</h2>
            {production.length === 0 ? <p className="text-sm text-muted-foreground">Nada pendiente.</p> : (
              <ul className="grid grid-cols-2 gap-x-3 gap-y-1 md:grid-cols-1">
                {production.map((entry) => (
                  <li className="flex items-baseline gap-2" key={entry.description}>
                    <span className="min-w-8 text-right font-mono text-2xl font-black tabular-nums">{entry.quantity.toLocaleString("es-ES")}</span>
                    <span className="min-w-0 truncate text-base font-bold">{entry.description}</span>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        ) : null}
        <div className="min-h-0 overflow-y-auto p-2">
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
                                <LineAllergens line={line} />
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
                            {held.map((line) => <li key={line.id}><span className="font-mono font-bold">{line.quantity.toLocaleString("es-ES")}</span> {line.description} <span className="font-mono text-xs">({courseLabels[line.course]})</span>{line.note ? <span className="italic"> · {line.note}</span> : null}{line.allergens.length > 0 ? <Warning aria-label="Lleva alérgenos" className="ml-1 inline size-4 text-destructive" weight="fill" /> : null}</li>)}
                          </ul>
                        </li>
                      ) : null}
                    </ul>
                    {onlyHeld ? null : (
                      <div className="grid grid-cols-2 gap-1.5 border-t border-window-shadow p-2">
                        <Button className="h-12" data-testid="pos-kitchen-all-ready" disabled={allReady} onClick={() => void setStatus(active.map((line) => line.id), "READY")} type="button" variant="outline">Todo listo</Button>
                        <Button className="h-12" data-testid="pos-kitchen-served" onClick={() => void serve(batch, active)} type="button">Servido</Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      {recovering ? <RecoverDialog onClose={() => setRecovering(false)} onRestore={async (lines) => { setRecovering(false); await restore(lines); toast.success("Comanda devuelta a la pantalla."); }} station={station} /> : null}
    </div>
  );
}

/** Alérgenos del plato según la carta: con nombre, para que nadie tenga que adivinar un icono. */
function LineAllergens({ line }: { line: KitchenLine }) {
  if (line.allergens.length === 0 && line.traces.length === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1" data-testid="pos-kitchen-allergens">
      {line.allergens.map((id) => <AllergenChip id={id} key={id} />)}
      {line.traces.map((id) => <AllergenChip id={id} key={`t-${id}`} variant="traces" />)}
    </span>
  );
}

/** Comandas retiradas en la última hora: se devuelven a la pantalla si se marcaron servidas por error. */
function RecoverDialog({ onClose, onRestore, station }: { onClose: () => void; onRestore: (lines: KitchenLine[]) => void; station: "KITCHEN" | "BAR" }) {
  const [served, setServed] = useState<KitchenBatch[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/pos/hospitality/kitchen?station=${station}&served=1`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : []))
      .then((data: KitchenBatch[]) => alive && setServed(data))
      .catch(() => alive && setServed([]));
    return () => {
      alive = false;
    };
  }, [station]);
  return (
    <Dialog description="Lo retirado en la última hora. Tócalo para devolverlo a la pantalla." onClose={onClose} open title="Recuperar una comanda">
      <div className="max-h-[60dvh] space-y-2 overflow-y-auto" data-testid="pos-kitchen-recover-list">
        {served === null ? <p className="text-sm text-muted-foreground">Cargando…</p> : served.length === 0 ? <p className="text-sm text-muted-foreground">No se ha retirado nada en la última hora.</p> : served.map((batch) => (
          <button className="block w-full border-2 border-window-dark-shadow bg-window-panel p-3 text-left active:translate-y-px" data-testid={`pos-kitchen-recover-${batch.name}`} key={batch.batchId} onClick={() => onRestore(batch.lines)} type="button">
            <span className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-lg font-black">{batch.name}</span>
              {batch.servedAt ? <span className="font-mono text-xs text-muted-foreground">hace {formatElapsed(minutesSince(batch.servedAt))}</span> : null}
            </span>
            <span className="block truncate text-sm">{batch.lines.map((line) => `${line.quantity.toLocaleString("es-ES")} ${line.description}`).join(" · ")}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
