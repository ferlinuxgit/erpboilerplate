"use client";

import { CaretDown, CaretRight, DownloadSimple, Pause, Play, SignIn, SignOut, Warning } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { postJson } from "@/components/hospitality/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { entryActionLabels, entryKindLabels, formatMinutes, type EntryKind, type WorkState } from "@/modules/timesheets/model";
import type { monthReport } from "@/server/timesheets/service";

type Report = Awaited<ReturnType<typeof monthReport>>;
type Worker = Report["workers"][number];
type Day = Worker["days"][number];

const ACTION_ICON: Record<EntryKind, React.ReactNode> = {
  IN: <SignIn aria-hidden="true" className="size-6" />,
  BREAK_START: <Pause aria-hidden="true" className="size-6" />,
  BREAK_END: <Play aria-hidden="true" className="size-6" />,
  OUT: <SignOut aria-hidden="true" className="size-6" />,
};
export const STATE_LABEL: Record<WorkState, string> = { OFF: "Fuera", WORKING: "Trabajando", ON_BREAK: "En pausa" };
const STATE_TONE: Record<WorkState, string> = { OFF: "bg-window-panel", WORKING: "bg-success text-white", ON_BREAK: "bg-warning text-warning-foreground" };
const dayLabel = (date: string) => new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const timeOf = (iso: string | null, timeZone: string) => (iso ? new Intl.DateTimeFormat("es-ES", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)) : "—");

/** Fichar la propia jornada: estado y el botón (o botones) que tocan ahora. */
export function MyClock({ actions, since, state, timeZone }: { actions: EntryKind[]; since: string | null; state: WorkState; timeZone: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function clock(kind: EntryKind) {
    setPending(true);
    try {
      await postJson("/api/timesheets/clock", { kind });
      toast.success(`${entryKindLabels[kind]} registrada a las ${timeOf(new Date().toISOString(), timeZone)}.`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo fichar.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="timesheet-my-clock">
      <div className={cn("min-w-40 border-2 border-window-dark-shadow px-4 py-3", STATE_TONE[state])}>
        <p className="font-mono text-xs uppercase opacity-80">Ahora</p>
        <p className="font-mono text-2xl font-black" data-testid="timesheet-state">{STATE_LABEL[state]}</p>
        {since && state !== "OFF" ? <p className="text-xs">desde las {timeOf(since, timeZone)}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {actions.map((kind) => (
          <Button className="h-16 min-w-40 text-lg" data-testid={`timesheet-action-${kind}`} disabled={pending} key={kind} onClick={() => void clock(kind)} type="button" variant={kind === "OUT" || kind === "BREAK_START" ? "outline" : "default"}>{ACTION_ICON[kind]} {entryActionLabels[kind]}</Button>
        ))}
      </div>
    </div>
  );
}

/** Tabla de jornadas de una persona en el mes (marcas, horas, pausas, incidencias). */
export function DaysTable({ canManage, days, worker }: { canManage: boolean; days: Day[]; worker?: Worker }) {
  const router = useRouter();
  const [voiding, setVoiding] = useState<{ id: string; label: string } | null>(null);
  const [reason, setReason] = useState("");
  if (days.length === 0) return <p className="p-2 text-sm text-muted-foreground">Sin fichajes este mes.</p>;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="bg-window-panel text-left font-mono text-xs uppercase">
            <tr><th className="p-2">Día</th><th className="p-2">Marcas</th><th className="p-2 text-right">Trabajado</th><th className="p-2 text-right">Pausas</th></tr>
          </thead>
          <tbody className="divide-y divide-window-shadow">
            {days.map((day) => (
              <tr className={cn(day.issues.length > 0 && "bg-warning/10")} data-testid={`timesheet-day-${day.date}`} key={day.date}>
                <td className="p-2 font-semibold capitalize">{dayLabel(day.date)}</td>
                <td className="p-2">
                  <span className="flex flex-wrap gap-1">
                    {day.entries.map((entry) => (
                      <span className={cn("inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-xs", entry.source === "CORRECTION" ? "border-dashed border-link" : "border-window-shadow")} key={entry.id} title={entry.note ?? undefined}>
                        {entry.time} {entryKindLabels[entry.kind]}{entry.source === "CORRECTION" ? " (corr.)" : entry.source === "KIOSK" ? " · tablet" : ""}
                        {canManage ? <button aria-label={`Anular ${entryKindLabels[entry.kind]} de las ${entry.time}`} className="text-destructive" onClick={() => { setVoiding({ id: entry.id, label: `${entryKindLabels[entry.kind]} de las ${entry.time}` }); setReason(""); }} type="button">×</button> : null}
                      </span>
                    ))}
                  </span>
                  {day.issues.length > 0 ? <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-warning-text"><Warning aria-hidden="true" className="size-3.5" />{day.issues.join(" · ")}</span> : null}
                </td>
                <td className="p-2 text-right font-mono tabular-nums">{formatMinutes(day.workedMinutes)}{day.open ? " ·" : ""}</td>
                <td className="p-2 text-right font-mono tabular-nums">{day.breakMinutes} min</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {worker && worker.voided.length > 0 ? <p className="p-2 text-xs text-muted-foreground">Anuladas (se conservan): {worker.voided.map((entry) => `${dayLabel(entry.at.slice(0, 10))} ${entry.time} ${entryKindLabels[entry.kind]} — ${entry.reason ?? ""}`).join(" · ")}</p> : null}
      {voiding ? (
        <Dialog description="La marca no se borra: queda anulada con el motivo, como exige el registro." onClose={() => setVoiding(null)} open title={`Anular ${voiding.label}`}>
          <div className="space-y-3">
            <label className="grid gap-1 text-sm font-medium">Motivo<Input className="h-11" maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="Fichó por error, duplicada…" value={reason} /></label>
            <Button className="h-12 w-full" disabled={!reason.trim()} onClick={async () => {
              try {
                await postJson(`/api/timesheets/entries/${voiding.id}/void`, { reason });
                toast.success("Marca anulada.");
                setVoiding(null);
                router.refresh();
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "No se pudo anular.");
              }
            }} type="button" variant="destructive">Anular marca</Button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

/** Equipo: quién está dentro, horas del mes por persona, correcciones y exportación. */
export function TeamPanel({ canManage, month, now, report }: { canManage: boolean; month: string; now: Array<{ userId: string; name: string; state: WorkState; since: string | null }>; report: Report }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<string | null>(null);
  return (
    <div className="space-y-4" data-testid="timesheet-team">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm font-medium">Mes<Input className="h-11 w-44" onChange={(event) => event.target.value && router.push(`/jornada?mes=${event.target.value}`)} type="month" value={month} /></label>
        <a className="inline-flex h-11 items-center gap-1.5 border-2 border-window-dark-shadow bg-window-panel px-3 font-mono text-sm font-bold" data-testid="timesheet-export-all" href={`/api/timesheets/export?month=${month}`}><DownloadSimple aria-hidden="true" className="size-4" /> Exportar el mes (CSV)</a>
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-label="Ahora mismo">
        {now.map((member) => <li className={cn("border-2 border-window-dark-shadow px-2 py-1 text-sm", STATE_TONE[member.state])} data-testid={`timesheet-now-${member.name}`} key={member.userId}><span className="font-semibold">{member.name}</span> · {STATE_LABEL[member.state]}{member.since && member.state !== "OFF" ? ` desde ${timeOf(member.since, report.timeZone)}` : ""}</li>)}
      </ul>
      <ul className="divide-y divide-window-shadow border border-window-shadow">
        {report.workers.map((worker) => (
          <li data-testid={`timesheet-worker-${worker.name}`} key={worker.userId}>
            <div className="flex flex-wrap items-center gap-2 p-2">
              <button aria-expanded={open === worker.userId} className="flex min-w-0 flex-1 items-center gap-1.5 text-left font-semibold" onClick={() => setOpen(open === worker.userId ? null : worker.userId)} type="button">
                {open === worker.userId ? <CaretDown aria-hidden="true" className="size-4" /> : <CaretRight aria-hidden="true" className="size-4" />}
                {worker.name}
              </button>
              <span className="font-mono text-sm tabular-nums" data-testid="timesheet-worker-total">{formatMinutes(worker.workedMinutes)}</span>
              <span className="text-xs text-muted-foreground">{worker.days.length} {worker.days.length === 1 ? "día" : "días"}</span>
              {worker.issues > 0 ? <span className="bg-warning px-1.5 text-xs font-bold text-warning-foreground">{worker.issues} {worker.issues === 1 ? "incidencia" : "incidencias"}</span> : null}
              <a className="text-xs text-link underline" href={`/api/timesheets/export?month=${month}&userId=${worker.userId}`}>CSV</a>
              {canManage ? <Button className="h-9" data-testid="timesheet-correct" onClick={() => setCorrecting(worker.userId)} size="sm" type="button" variant="outline">Corregir</Button> : null}
            </div>
            {open === worker.userId ? <div className="border-t border-window-shadow"><DaysTable canManage={canManage} days={worker.days} worker={worker} /></div> : null}
          </li>
        ))}
      </ul>
      {correcting ? <CorrectionDialog name={report.workers.find((worker) => worker.userId === correcting)?.name ?? ""} onClose={() => setCorrecting(null)} userId={correcting} /> : null}
    </div>
  );
}

function CorrectionDialog({ name, onClose, userId }: { name: string; onClose: () => void; userId: string }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ kind: "OUT" as EntryKind, date: today, time: "", note: "" });
  const [pending, setPending] = useState(false);
  return (
    <Dialog description="Se añade como corrección, con tu nombre y el motivo; el registro original no se modifica." onClose={onClose} open title={`Corregir la jornada de ${name}`}>
      <div className="space-y-3" data-testid="timesheet-correction-dialog">
        <div aria-label="Tipo de marca" className="grid grid-cols-2 gap-1.5" role="radiogroup">
          {(["IN", "BREAK_START", "BREAK_END", "OUT"] as const).map((kind) => (
            <button aria-checked={form.kind === kind} className={cn("h-11 border-2 text-sm font-semibold", form.kind === kind ? "border-primary bg-primary text-primary-foreground" : "border-window-dark-shadow bg-window-panel")} key={kind} onClick={() => setForm({ ...form, kind })} role="radio" type="button">{entryKindLabels[kind]}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-sm font-medium">Día<Input className="h-11" max={today} onChange={(event) => setForm({ ...form, date: event.target.value })} type="date" value={form.date} /></label>
          <label className="grid gap-1 text-sm font-medium">Hora<Input className="h-11" onChange={(event) => setForm({ ...form, time: event.target.value })} type="time" value={form.time} /></label>
        </div>
        <label className="grid gap-1 text-sm font-medium">Motivo<Input className="h-11" maxLength={300} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Olvidó fichar la salida, confirmado con el trabajador…" value={form.note} /></label>
        <Button className="h-12 w-full" data-testid="timesheet-correction-save" disabled={pending || !form.time || !form.note.trim()} onClick={async () => {
          setPending(true);
          try {
            await postJson("/api/timesheets/entries", { userId, ...form });
            toast.success("Corrección registrada.");
            onClose();
            router.refresh();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "No se pudo registrar.");
            setPending(false);
          }
        }} type="button">Registrar corrección</Button>
      </div>
    </Dialog>
  );
}
