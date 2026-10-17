import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";

import { company, membership, timeEntry, user } from "@/db/schema";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { addDays, zonedParts, zonedToUtc } from "@/modules/hospitality/bookings";
import { allowedActions, entryKindLabels, groupByWorkday, stateAfter, summarizeDay, timesheetCsv, type EntryKind } from "@/modules/timesheets/model";
import { recordAudit } from "@/server/audit";
import { verifyStaffPin } from "@/server/pos/hospitality";

export type TimesheetActor = { tenantId: string; companyId: string; actorUserId: string };

async function companyZone(companyId: string) {
  const [row] = await db.select({ timezone: company.timezone }).from(company).where(eq(company.id, companyId)).limit(1);
  return row?.timezone ?? "Europe/Madrid";
}

async function assertMember(tenantId: string, userId: string) {
  const [row] = await db.select({ name: user.name }).from(membership).innerJoin(user, eq(user.id, membership.userId)).where(and(eq(membership.tenantId, tenantId), eq(membership.userId, userId))).limit(1);
  if (!row) throw new HttpError(404, "Esa persona no es del equipo.");
  return row;
}

/** Última marca válida (no anulada) de una persona. */
async function lastKind(client: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0], companyId: string, userId: string) {
  const [row] = await client.select({ kind: timeEntry.kind, at: timeEntry.at }).from(timeEntry).where(and(eq(timeEntry.companyId, companyId), eq(timeEntry.userId, userId), isNull(timeEntry.voidedAt))).orderBy(desc(timeEntry.at)).limit(1);
  return row ? { kind: row.kind as EntryKind, at: row.at } : null;
}

const ACTION_ERRORS: Record<EntryKind, string> = {
  IN: "Ya estás dentro: ficha la salida o una pausa.",
  BREAK_START: "Para empezar una pausa primero hay que fichar la entrada.",
  BREAK_END: "No hay ninguna pausa abierta.",
  OUT: "No hay ninguna entrada abierta.",
};

/** Ficha (desde su sesión o en la tablet): solo la marca que toca en ese momento. */
export async function clock(actor: TimesheetActor, userId: string, kind: EntryKind, source: "APP" | "KIOSK") {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`timesheet:${actor.companyId}:${userId}`}))`);
    const last = await lastKind(tx, actor.companyId, userId);
    if (!allowedActions(stateAfter(last?.kind ?? null)).includes(kind)) throw new HttpError(409, ACTION_ERRORS[kind]);
    const now = new Date();
    if (last && now.getTime() - last.at.getTime() < 30_000 && last.kind === kind) throw new HttpError(409, "Acabas de fichar.");
    const [created] = await tx.insert(timeEntry).values({ companyId: actor.companyId, userId, kind, at: now, source, createdByUserId: actor.actorUserId }).returning({ id: timeEntry.id, at: timeEntry.at });
    await recordAudit({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action: `time_entry.${kind.toLowerCase()}`, entityName: "time_entry", entityId: created.id, payload: { userId, source } }, tx);
    return { id: created.id, kind, at: created.at, state: stateAfter(kind) };
  });
}

/** Estado actual de una persona y qué puede fichar. */
export async function currentState(companyId: string, userId: string) {
  const last = await lastKind(db, companyId, userId);
  const state = stateAfter(last?.kind ?? null);
  return { state, since: last?.at ?? null, lastKind: last?.kind ?? null, actions: allowedActions(state) };
}

/** Tablet compartida: el trabajador se identifica con su PIN; sin `kind` solo devuelve su estado. */
export async function kioskClock(actor: TimesheetActor, pin: string, kind: EntryKind | null) {
  const staff = await verifyStaffPin(actor.companyId, pin);
  if (!staff) throw new HttpError(403, "PIN incorrecto.");
  await assertMember(actor.tenantId, staff.userId);
  if (kind) await clock(actor, staff.userId, kind, "KIOSK");
  return { userId: staff.userId, name: staff.name, ...(await currentState(actor.companyId, staff.userId)) };
}

function monthRange(month: string, timeZone: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, "Mes no válido.");
  const first = `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number);
  const next = monthNumber === 12 ? `${year + 1}-01-01` : `${year}-${String(monthNumber + 1).padStart(2, "0")}-01`;
  // Un día más al final para recoger salidas de madrugada del último día.
  return { first, next, from: zonedToUtc(first, "00:00", timeZone), to: zonedToUtc(addDays(next, 1), "06:00", timeZone) };
}

/** Jornadas de un mes (de una persona o de todo el equipo), con sus marcas, horas e incidencias. */
export async function monthReport(companyId: string, tenantId: string, month: string, userId?: string | null) {
  const timeZone = await companyZone(companyId);
  const range = monthRange(month, timeZone);
  const members = await db.select({ userId: user.id, name: user.name }).from(membership).innerJoin(user, eq(user.id, membership.userId)).where(and(eq(membership.tenantId, tenantId), ...(userId ? [eq(membership.userId, userId)] : []))).orderBy(asc(user.name));
  if (members.length === 0) return { month, timeZone, workers: [] };
  const rows = await db
    .select({ id: timeEntry.id, userId: timeEntry.userId, kind: timeEntry.kind, at: timeEntry.at, source: timeEntry.source, note: timeEntry.note, voidedAt: timeEntry.voidedAt, voidReason: timeEntry.voidReason })
    .from(timeEntry)
    .where(and(eq(timeEntry.companyId, companyId), inArray(timeEntry.userId, members.map((member) => member.userId)), gte(timeEntry.at, range.from), lt(timeEntry.at, range.to)))
    .orderBy(asc(timeEntry.at));
  const now = new Date();
  const today = zonedParts(now, timeZone).date;
  const clockFormat = new Intl.DateTimeFormat("es-ES", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const workers = members.map((member) => {
    const mine = rows.filter((row) => row.userId === member.userId);
    const valid = mine.filter((row) => !row.voidedAt).map((row) => ({ ...row, kind: row.kind as EntryKind }));
    const grouped = groupByWorkday(valid, timeZone);
    const days = [...grouped.entries()]
      .filter(([date]) => date >= range.first && date < range.next)
      .map(([date, entries]) => {
        const summary = summarizeDay(date, entries, now, date === today, timeZone);
        return {
          ...summary,
          firstIn: summary.firstIn?.toISOString() ?? null,
          lastOut: summary.lastOut?.toISOString() ?? null,
          entries: entries.map((entry) => ({ id: entry.id, kind: entry.kind, at: entry.at.toISOString(), time: clockFormat.format(entry.at), source: entry.source, note: entry.note })),
        };
      });
    const voided = mine.filter((row) => row.voidedAt).map((row) => ({ id: row.id, kind: row.kind as EntryKind, at: row.at.toISOString(), time: clockFormat.format(row.at), reason: row.voidReason }));
    return { userId: member.userId, name: member.name, days, voided, workedMinutes: days.reduce((sum, day) => sum + day.workedMinutes, 0), issues: days.reduce((sum, day) => sum + day.issues.length, 0) };
  });
  return { month, timeZone, workers };
}

/** Quién está trabajando ahora (para el responsable). */
export async function teamNow(companyId: string, tenantId: string) {
  const members = await db.select({ userId: user.id, name: user.name }).from(membership).innerJoin(user, eq(user.id, membership.userId)).where(eq(membership.tenantId, tenantId)).orderBy(asc(user.name));
  return Promise.all(members.map(async (member) => ({ ...member, ...(await currentState(companyId, member.userId)) })));
}

/** Corrección de un responsable: una marca nueva con su hora real y el motivo (queda como corrección). */
export async function addCorrection(actor: TimesheetActor, input: { userId: string; kind: EntryKind; date: string; time: string; note: string }) {
  if (!input.note.trim()) throw new HttpError(400, "Indica el motivo de la corrección.");
  // Fecha y hora de reloj del local.
  const at = zonedToUtc(input.date, input.time, await companyZone(actor.companyId));
  if (at.getTime() > Date.now() + 60_000) throw new HttpError(400, "No se puede fichar en el futuro.");
  await assertMember(actor.tenantId, input.userId);
  const [created] = await db.insert(timeEntry).values({ companyId: actor.companyId, userId: input.userId, kind: input.kind, at, source: "CORRECTION", note: input.note.trim(), createdByUserId: actor.actorUserId }).returning({ id: timeEntry.id });
  await recordAudit({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action: "time_entry.correction", entityName: "time_entry", entityId: created.id, payload: { ...input, at: at.toISOString() } });
  return created;
}

/** Anula una marca errónea: no se borra, queda con quién, cuándo y por qué. */
export async function voidEntry(actor: TimesheetActor, entryId: string, reason: string) {
  if (!reason.trim()) throw new HttpError(400, "Indica el motivo.");
  const [updated] = await db.update(timeEntry).set({ voidedAt: new Date(), voidedByUserId: actor.actorUserId, voidReason: reason.trim() }).where(and(eq(timeEntry.id, entryId), eq(timeEntry.companyId, actor.companyId), isNull(timeEntry.voidedAt))).returning({ id: timeEntry.id, userId: timeEntry.userId });
  if (!updated) throw new HttpError(404, "Marca no encontrada o ya anulada.");
  await recordAudit({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action: "time_entry.void", entityName: "time_entry", entityId: entryId, payload: { reason, userId: updated.userId } });
  return updated;
}

/** CSV del mes para el gestor o la Inspección de Trabajo. */
export async function exportMonthCsv(companyId: string, tenantId: string, month: string, userId?: string | null) {
  const report = await monthReport(companyId, tenantId, month, userId);
  const rows = report.workers.flatMap((worker) => worker.days.map((day) => ({
    worker: worker.name,
    date: day.date,
    entries: day.entries.map((entry) => `${entry.time} ${entryKindLabels[entry.kind]}${entry.source === "CORRECTION" ? " (corrección)" : ""}`).join(" · "),
    workedMinutes: day.workedMinutes,
    breakMinutes: day.breakMinutes,
    issues: day.issues.join(" · "),
  })));
  return timesheetCsv(rows);
}
