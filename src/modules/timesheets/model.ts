/**
 * Registro de jornada: qué fichaje toca, horas trabajadas y pausas por día, e incidencias (olvidos).
 * Puro, sin base de datos. Las horas se agrupan por el día local de la entrada.
 */

export const ENTRY_KINDS = ["IN", "BREAK_START", "BREAK_END", "OUT"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];
export const entryKindLabels: Record<EntryKind, string> = { IN: "Entrada", BREAK_START: "Inicio de pausa", BREAK_END: "Fin de pausa", OUT: "Salida" };
export const entryActionLabels: Record<EntryKind, string> = { IN: "Entrar", BREAK_START: "Pausa", BREAK_END: "Volver de la pausa", OUT: "Salir" };

export type WorkState = "OFF" | "WORKING" | "ON_BREAK";

/** Estado tras la última marca válida. */
export function stateAfter(last: EntryKind | null): WorkState {
  if (last === "IN" || last === "BREAK_END") return "WORKING";
  if (last === "BREAK_START") return "ON_BREAK";
  return "OFF";
}

/** Fichajes posibles ahora. */
export function allowedActions(state: WorkState): EntryKind[] {
  if (state === "OFF") return ["IN"];
  if (state === "WORKING") return ["BREAK_START", "OUT"];
  return ["BREAK_END"];
}

export type Entry = { kind: EntryKind; at: Date };
export type DaySummary = { date: string; firstIn: Date | null; lastOut: Date | null; workedMinutes: number; breakMinutes: number; open: boolean; issues: string[] };

const minutesBetween = (from: Date, to: Date) => Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));

/**
 * Resume una jornada (marcas válidas de un día, en orden). `now` sirve para contar la jornada en curso.
 * Incidencias: marcas fuera de orden u olvidos de salida en días pasados.
 */
export function summarizeDay(date: string, entries: readonly Entry[], now: Date, isToday: boolean, timeZone = "UTC"): DaySummary {
  const clock = new Intl.DateTimeFormat("es-ES", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const sorted = [...entries].sort((a, b) => a.at.getTime() - b.at.getTime());
  let state: WorkState = "OFF";
  let since: Date | null = null;
  let worked = 0;
  let breaks = 0;
  const issues: string[] = [];
  for (const entry of sorted) {
    if (!allowedActions(state).includes(entry.kind)) {
      issues.push(`${entryKindLabels[entry.kind]} a las ${clock.format(entry.at)} fuera de orden`);
      continue;
    }
    if (since && state === "WORKING") worked += minutesBetween(since, entry.at);
    if (since && state === "ON_BREAK") breaks += minutesBetween(since, entry.at);
    state = stateAfter(entry.kind);
    since = entry.at;
  }
  const open = state !== "OFF";
  if (open && since) {
    if (isToday) {
      if (state === "WORKING") worked += minutesBetween(since, now);
      else breaks += minutesBetween(since, now);
    } else {
      issues.push("Falta la salida");
    }
  }
  return {
    date,
    firstIn: sorted.find((entry) => entry.kind === "IN")?.at ?? null,
    lastOut: [...sorted].reverse().find((entry) => entry.kind === "OUT")?.at ?? null,
    workedMinutes: worked,
    breakMinutes: breaks,
    open,
    issues,
  };
}

export function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** CSV del registro (separador «;» y coma decimal, como lo abre Excel en España). */
export function timesheetCsv(rows: ReadonlyArray<{ worker: string; date: string; entries: string; workedMinutes: number; breakMinutes: number; issues: string }>) {
  const escape = (value: string) => (/[;"\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = [["Trabajador", "Fecha", "Marcas", "Horas trabajadas", "Pausas (min)", "Incidencias"].join(";")];
  for (const row of rows) lines.push([row.worker, row.date, row.entries, (row.workedMinutes / 60).toFixed(2).replace(".", ","), String(row.breakMinutes), row.issues].map(escape).join(";"));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/**
 * Agrupa las marcas por jornada: todo lo que va desde una entrada hasta su salida cuenta en el día
 * (local) de la entrada, aunque se salga pasada la medianoche.
 */
export function groupByWorkday<T extends Entry>(entries: readonly T[], timeZone: string) {
  const dayOf = (instant: Date) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
  const days = new Map<string, T[]>();
  let state: WorkState = "OFF";
  let current: string | null = null;
  for (const entry of [...entries].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (entry.kind === "IN" || state === "OFF" || !current) current = dayOf(entry.at);
    const list = days.get(current) ?? [];
    list.push(entry);
    days.set(current, list);
    if (allowedActions(state).includes(entry.kind)) state = stateAfter(entry.kind);
  }
  return days;
}
