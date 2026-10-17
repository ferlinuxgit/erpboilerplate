import { createHash, createHmac, randomInt } from "node:crypto";

import { and, asc, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";

import { company, posArea, posBooking, posWaitlist, posBookingClosure, posBookingHours, posBookingSettings, posOrder, posRegister, posTable } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { HttpError } from "@/lib/http";
import {
  ACTIVE_BOOKING_STATUSES,
  addDays,
  bookingCode,
  canCustomerCancel,
  dateUnavailableReason,
  daySlots,
  isDate,
  isTime,
  minutesOfDay,
  pickTables,
  busyTableIds,
  slugify,
  zonedParts,
  zonedToUtc,
  type BookableTable,
  type BookingRules,
  type BookingSource,
  type BookingStatus,
} from "@/modules/hospitality/bookings";
import { recordAudit } from "@/server/audit";
import { appBaseUrl } from "@/server/email/templates";
import { isModuleEnabled } from "@/server/modules/service";
import { openOrder } from "@/server/pos/hospitality";
import type { PosActor } from "@/server/pos/service";

import { customerBookingEmail, restaurantBookingEmail, sendBookingEmail, type BookingEmailData } from "./booking-emails";
import { listWaitlist, notifyWaitlist } from "./waitlist";

const DEFAULT_RULES = { slotMinutes: 30, durationMinutes: 90, minPartySize: 1, maxPartySize: 8, leadMinutes: 60, maxDaysAhead: 60, allowCombining: true } satisfies BookingRules;

async function audit(actor: PosActor, action: string, entityId: string, payload: Record<string, unknown>, client: DbClient = db) {
  await recordAudit({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action, entityName: "pos_booking", entityId, payload }, client);
}

// ---------------------------------------------------------------------------------------------
// Enlace privado del cliente: se deriva de la reserva (para poder repetirlo en el recordatorio) y en la
// base de datos solo se guarda su hash.
// ---------------------------------------------------------------------------------------------

export function manageToken(bookingId: string) {
  return createHmac("sha256", process.env.JWT_SECRET || "erp-bookings").update(`booking:${bookingId}`).digest("base64url");
}

export function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function manageUrl(bookingId: string) {
  return `${appBaseUrl()}/reservar/gestion/${manageToken(bookingId)}`;
}

// ---------------------------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------------------------

export type BookingSettingsInput = {
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
  hours: Array<{ weekday: number; opensAt: string; lastStart: string }>;
};

export async function getBookingSettings(companyId: string) {
  const [[settings], hours, closures, [owner]] = await Promise.all([
    db.select().from(posBookingSettings).where(eq(posBookingSettings.companyId, companyId)).limit(1),
    db.select().from(posBookingHours).where(eq(posBookingHours.companyId, companyId)).orderBy(asc(posBookingHours.weekday), asc(posBookingHours.opensAt)),
    db.select().from(posBookingClosure).where(eq(posBookingClosure.companyId, companyId)).orderBy(asc(posBookingClosure.date)),
    db.select({ name: company.name, email: company.email, timezone: company.timezone }).from(company).where(eq(company.id, companyId)).limit(1),
  ]);
  return {
    saved: Boolean(settings),
    enabled: settings?.enabled ?? false,
    slug: settings?.slug ?? (slugify(owner?.name ?? "") || "mi-restaurante"),
    registerId: settings?.registerId ?? null,
    slotMinutes: settings?.slotMinutes ?? DEFAULT_RULES.slotMinutes,
    durationMinutes: settings?.durationMinutes ?? DEFAULT_RULES.durationMinutes,
    minPartySize: settings?.minPartySize ?? DEFAULT_RULES.minPartySize,
    maxPartySize: settings?.maxPartySize ?? DEFAULT_RULES.maxPartySize,
    leadMinutes: settings?.leadMinutes ?? DEFAULT_RULES.leadMinutes,
    maxDaysAhead: settings?.maxDaysAhead ?? DEFAULT_RULES.maxDaysAhead,
    autoConfirm: settings?.autoConfirm ?? true,
    cancellationHours: settings?.cancellationHours ?? 2,
    allowCombining: settings?.allowCombining ?? true,
    welcomeMessage: settings?.welcomeMessage ?? null,
    notifyEmail: settings?.notifyEmail ?? owner?.email ?? null,
    sendReminders: settings?.sendReminders ?? true,
    timezone: owner?.timezone ?? "Europe/Madrid",
    hours: hours.map(({ weekday, opensAt, lastStart }) => ({ weekday, opensAt, lastStart })),
    closures: closures.map(({ id, date, reason }) => ({ id, date, reason })),
  };
}

export type BookingSettingsView = Awaited<ReturnType<typeof getBookingSettings>>;

export async function saveBookingSettings(actor: PosActor, input: BookingSettingsInput) {
  const slug = slugify(input.slug);
  if (slug.length < 3) throw new HttpError(400, "La dirección del formulario debe tener al menos 3 letras o números.");
  if (slug === "gestion") throw new HttpError(400, "Esa dirección está reservada: elige otra.");
  if (input.minPartySize > input.maxPartySize) throw new HttpError(400, "El mínimo de personas no puede ser mayor que el máximo.");
  for (const shift of input.hours) {
    if (!isTime(shift.opensAt) || !isTime(shift.lastStart)) throw new HttpError(400, "Las horas deben tener el formato HH:MM.");
    if (minutesOfDay(shift.lastStart) < minutesOfDay(shift.opensAt)) throw new HttpError(400, "En cada turno, la última reserva debe ser posterior a la primera.");
  }
  if (input.enabled && input.hours.length === 0) throw new HttpError(400, "Añade al menos un turno para poder recibir reservas.");
  if (input.registerId) {
    const [register] = await db.select({ id: posRegister.id }).from(posRegister).where(and(eq(posRegister.id, input.registerId), eq(posRegister.companyId, actor.companyId))).limit(1);
    if (!register) throw new HttpError(404, "Caja no encontrada.");
  }
  const [taken] = await db.select({ companyId: posBookingSettings.companyId }).from(posBookingSettings).where(and(eq(posBookingSettings.slug, slug), ne(posBookingSettings.companyId, actor.companyId))).limit(1);
  if (taken) throw new HttpError(409, `La dirección «${slug}» ya la usa otro restaurante: elige otra.`);
  const values = {
    enabled: input.enabled,
    slug,
    registerId: input.registerId,
    slotMinutes: input.slotMinutes,
    durationMinutes: input.durationMinutes,
    minPartySize: input.minPartySize,
    maxPartySize: input.maxPartySize,
    leadMinutes: input.leadMinutes,
    maxDaysAhead: input.maxDaysAhead,
    autoConfirm: input.autoConfirm,
    cancellationHours: input.cancellationHours,
    allowCombining: input.allowCombining,
    welcomeMessage: input.welcomeMessage?.trim() || null,
    notifyEmail: input.notifyEmail?.trim() || null,
    sendReminders: input.sendReminders,
    updatedAt: new Date(),
  };
  await db.transaction(async (tx) => {
    await tx.insert(posBookingSettings).values({ companyId: actor.companyId, ...values }).onConflictDoUpdate({ target: posBookingSettings.companyId, set: values });
    await tx.delete(posBookingHours).where(eq(posBookingHours.companyId, actor.companyId));
    if (input.hours.length > 0) await tx.insert(posBookingHours).values(input.hours.map((shift) => ({ companyId: actor.companyId, ...shift })));
    await recordAudit({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action: "pos_booking_settings.update", entityName: "pos_booking_settings", entityId: actor.companyId, payload: { ...values, hours: input.hours.length } }, tx);
  });
  return { slug };
}

export async function addBookingClosure(actor: PosActor, input: { date: string; reason: string | null }) {
  if (!isDate(input.date)) throw new HttpError(400, "Fecha no válida.");
  const [created] = await db.insert(posBookingClosure).values({ companyId: actor.companyId, date: input.date, reason: input.reason?.trim() || null }).onConflictDoNothing().returning({ id: posBookingClosure.id });
  if (!created) throw new HttpError(409, "Ese día ya está cerrado.");
  return created;
}

export async function deleteBookingClosure(actor: PosActor, closureId: string) {
  await db.delete(posBookingClosure).where(and(eq(posBookingClosure.id, closureId), eq(posBookingClosure.companyId, actor.companyId)));
}

// ---------------------------------------------------------------------------------------------
// Disponibilidad
// ---------------------------------------------------------------------------------------------

/** Mesas en uso; para reservas online, solo las marcadas como reservables en salas reservables. */
async function loadTables(client: DbClient, companyId: string, onlyBookable: boolean) {
  const rows = await client
    .select({ id: posTable.id, name: posTable.name, areaId: posTable.areaId, seats: posTable.seats, bookable: posTable.bookable, areaBookable: posArea.bookable, areaName: posArea.name })
    .from(posTable)
    .innerJoin(posArea, eq(posArea.id, posTable.areaId))
    .where(and(eq(posTable.companyId, companyId), eq(posTable.isActive, true)))
    .orderBy(asc(posArea.position), asc(posTable.position), asc(posTable.name));
  return rows.filter((row) => !onlyBookable || (row.bookable && row.areaBookable));
}

async function loadBusy(client: DbClient, companyId: string, date: string, timeZone: string) {
  const from = zonedToUtc(addDays(date, -1), "00:00", timeZone);
  const to = zonedToUtc(addDays(date, 2), "00:00", timeZone);
  return client
    .select({ id: posBooking.id, startsAt: posBooking.startsAt, endsAt: posBooking.endsAt, tableIds: posBooking.tableIds })
    .from(posBooking)
    .where(and(eq(posBooking.companyId, companyId), inArray(posBooking.status, [...ACTIVE_BOOKING_STATUSES]), lt(posBooking.startsAt, to), gte(posBooking.endsAt, from)));
}

type Settings = BookingSettingsView;

function rulesOf(settings: Settings): BookingRules {
  return { slotMinutes: settings.slotMinutes, durationMinutes: settings.durationMinutes, minPartySize: settings.minPartySize, maxPartySize: settings.maxPartySize, leadMinutes: settings.leadMinutes, maxDaysAhead: settings.maxDaysAhead, allowCombining: settings.allowCombining };
}

async function computeSlots(client: DbClient, companyId: string, settings: Settings, date: string, partySize: number, now: Date) {
  const today = zonedParts(now, settings.timezone).date;
  const reason = dateUnavailableReason({ date, today, rules: settings, closures: settings.closures });
  if (reason) return { reason, slots: [] };
  if (partySize < settings.minPartySize || partySize > settings.maxPartySize) return { reason: `Online se reserva para ${settings.minPartySize}–${settings.maxPartySize} personas. Para grupos, llámanos.`, slots: [] };
  const [tables, bookings] = await Promise.all([loadTables(client, companyId, true), loadBusy(client, companyId, date, settings.timezone)]);
  const slots = daySlots({ date, partySize, timeZone: settings.timezone, now, rules: rulesOf(settings), shifts: settings.hours, tables, bookings });
  if (slots.length === 0) return { reason: "Ese día no hay horas de reserva.", slots: [] };
  return { reason: slots.some((slot) => slot.available) ? null : "Está todo completo ese día para ese número de personas. Prueba otro día.", slots };
}

// ---------------------------------------------------------------------------------------------
// Formulario público
// ---------------------------------------------------------------------------------------------

/** Restaurante detrás de una dirección pública, solo si tiene la hostelería y las reservas activas. */
export async function getPublicBookingPage(slug: string) {
  const [row] = await db
    .select({ companyId: posBookingSettings.companyId, enabled: posBookingSettings.enabled, name: company.name, address: company.fiscalAddress, city: company.city, phone: company.phone, logo: company.logoDataUrl })
    .from(posBookingSettings)
    .innerJoin(company, eq(company.id, posBookingSettings.companyId))
    .where(eq(posBookingSettings.slug, slugify(slug)))
    .limit(1);
  if (!row || !row.enabled || !(await isModuleEnabled(row.companyId, "hospitality"))) return null;
  const settings = await getBookingSettings(row.companyId);
  const today = zonedParts(new Date(), settings.timezone).date;
  return {
    companyId: row.companyId,
    slug: settings.slug,
    name: row.name,
    address: [row.address, row.city].filter(Boolean).join(", ") || null,
    phone: row.phone,
    logo: row.logo,
    welcomeMessage: settings.welcomeMessage,
    minPartySize: settings.minPartySize,
    maxPartySize: settings.maxPartySize,
    autoConfirm: settings.autoConfirm,
    cancellationHours: settings.cancellationHours,
    today,
    lastDay: addDays(today, settings.maxDaysAhead),
    openWeekdays: [...new Set(settings.hours.map((shift) => shift.weekday))],
    closures: settings.closures.map((closure) => closure.date).filter((date) => date >= today),
  };
}

async function requirePublic(slug: string) {
  const page = await getPublicBookingPage(slug);
  if (!page) throw new HttpError(404, "Este restaurante no acepta reservas online ahora mismo.");
  return { page, settings: await getBookingSettings(page.companyId) };
}

export async function getPublicAvailability(slug: string, date: string, partySize: number) {
  const { page, settings } = await requirePublic(slug);
  const result = await computeSlots(db, page.companyId, settings, date, partySize, new Date());
  return { reason: result.reason, slots: result.slots.map((slot) => ({ time: slot.time, available: slot.available })) };
}

export function formatWhen(startsAt: Date, timeZone: string) {
  return new Intl.DateTimeFormat("es-ES", { timeZone, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(startsAt);
}

/** ¿Hay alguna hora libre ese día para ese grupo? (para avisar a la lista de espera). */
export async function hasAvailability(companyId: string, date: string, partySize: number, now = new Date()) {
  const settings = await getBookingSettings(companyId);
  if (!settings.enabled) return { available: false, times: [] as string[] };
  const { slots } = await computeSlots(db, companyId, settings, date, partySize, now);
  const times = slots.filter((slot) => slot.available).map((slot) => slot.time);
  return { available: times.length > 0, times };
}

export type PublicBookingInput = { date: string; time: string; partySize: number; name: string; phone: string; email: string; notes: string | null };

export async function createPublicBooking(slug: string, input: PublicBookingInput) {
  const { page, settings } = await requirePublic(slug);
  const status: BookingStatus = settings.autoConfirm ? "CONFIRMED" : "PENDING";
  const booking = await db.transaction(async (tx) => {
    // Una reserva a la vez por restaurante: dos clientes no pueden quedarse la misma mesa.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`booking:${page.companyId}`}))`);
    const { reason, slots } = await computeSlots(tx, page.companyId, settings, input.date, input.partySize, new Date());
    const slot = slots.find((entry) => entry.time === input.time);
    if (!slot) throw new HttpError(400, reason ?? "Esa hora no está disponible para reservar.");
    if (!slot.available || !slot.tables) throw new HttpError(409, "Lo sentimos, esa hora se acaba de completar. Elige otra.");
    return insertBooking(tx, page.companyId, {
      status,
      startsAt: slot.startsAt,
      durationMinutes: settings.durationMinutes,
      partySize: input.partySize,
      name: input.name,
      phone: input.phone,
      email: input.email,
      notes: input.notes,
      tableIds: slot.tables.map((table) => table.id),
      source: "WEB",
      consentAt: new Date(),
      createdByUserId: null,
    });
  });
  // Si estaba en la lista de espera de ese día, ya tiene mesa.
  await db.update(posWaitlist).set({ status: "BOOKED", updatedAt: new Date() }).where(and(eq(posWaitlist.companyId, page.companyId), eq(posWaitlist.date, input.date), eq(posWaitlist.email, input.email.trim().toLowerCase()), inArray(posWaitlist.status, ["WAITING", "NOTIFIED"])));
  return { ...booking, token: manageToken(booking.id), status, notify: () => notifyNewBooking(page.companyId, booking.id) };
}

async function insertBooking(
  tx: DbClient,
  companyId: string,
  input: { status: BookingStatus; startsAt: Date; durationMinutes: number; partySize: number; name: string; phone: string | null; email: string | null; notes: string | null; tableIds: string[]; source: BookingSource; consentAt: Date | null; createdByUserId: string | null },
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = bookingCode((max) => randomInt(max));
    const id = crypto.randomUUID();
    const [created] = await tx
      .insert(posBooking)
      .values({
        id,
        companyId,
        code,
        status: input.status,
        startsAt: input.startsAt,
        endsAt: new Date(input.startsAt.getTime() + input.durationMinutes * 60_000),
        partySize: input.partySize,
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        email: input.email?.trim().toLowerCase() || null,
        notes: input.notes?.trim() || null,
        tableIds: input.tableIds,
        source: input.source,
        manageTokenHash: tokenHash(manageToken(id)),
        consentAt: input.consentAt,
        createdByUserId: input.createdByUserId,
      })
      .onConflictDoNothing()
      .returning({ id: posBooking.id, code: posBooking.code, startsAt: posBooking.startsAt });
    if (created) return created;
  }
  throw new HttpError(500, "No se pudo generar el localizador. Inténtalo de nuevo.");
}

async function emailData(bookingId: string) {
  const [row] = await db
    .select({ booking: posBooking, restaurant: company.name, address: company.fiscalAddress, city: company.city, phone: company.phone, timezone: company.timezone })
    .from(posBooking)
    .innerJoin(company, eq(company.id, posBooking.companyId))
    .where(eq(posBooking.id, bookingId))
    .limit(1);
  if (!row) return null;
  const settings = await getBookingSettings(row.booking.companyId);
  const tables = row.booking.tableIds.length > 0 ? await db.select({ id: posTable.id, name: posTable.name }).from(posTable).where(inArray(posTable.id, row.booking.tableIds)) : [];
  const data: BookingEmailData = {
    restaurant: row.restaurant,
    address: [row.address, row.city].filter(Boolean).join(", ") || null,
    phone: row.phone,
    code: row.booking.code,
    name: row.booking.name,
    partySize: row.booking.partySize,
    when: formatWhen(row.booking.startsAt, row.timezone),
    notes: row.booking.notes,
    manageUrl: manageUrl(row.booking.id),
    welcomeMessage: settings.welcomeMessage,
  };
  return { booking: row.booking, settings, data, tables: tables.map((table) => table.name).join(" + ") };
}

/** Correo al cliente (confirmada o pendiente) y aviso al restaurante. */
export async function notifyNewBooking(companyId: string, bookingId: string) {
  const info = await emailData(bookingId);
  if (!info || info.booking.companyId !== companyId) return;
  await sendBookingEmail(info.booking.email, customerBookingEmail(info.booking.status === "PENDING" ? "PENDING" : "CONFIRMED", info.data));
  if (info.booking.source === "WEB") {
    await sendBookingEmail(info.settings.notifyEmail, restaurantBookingEmail("NEW", { ...info.data, tables: info.tables, bookingsUrl: `${appBaseUrl()}/pos/bookings?date=${zonedParts(info.booking.startsAt, info.settings.timezone).date}`, email: info.booking.email, customerPhone: info.booking.phone }));
  }
}

async function notifyCustomer(bookingId: string, kind: "CONFIRMED" | "CANCELLED") {
  const info = await emailData(bookingId);
  if (!info) return;
  await sendBookingEmail(info.booking.email, customerBookingEmail(kind, kind === "CANCELLED" ? { ...info.data, manageUrl: null } : info.data));
}

// ---------------------------------------------------------------------------------------------
// Enlace del cliente: ver, descargar al calendario y cancelar
// ---------------------------------------------------------------------------------------------

export async function getBookingByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [row] = await db
    .select({ booking: posBooking, restaurant: company.name, address: company.fiscalAddress, city: company.city, phone: company.phone, timezone: company.timezone })
    .from(posBooking)
    .innerJoin(company, eq(company.id, posBooking.companyId))
    .where(eq(posBooking.manageTokenHash, tokenHash(token)))
    .limit(1);
  if (!row) return null;
  const settings = await getBookingSettings(row.booking.companyId);
  const now = new Date();
  return {
    id: row.booking.id,
    code: row.booking.code,
    status: row.booking.status as BookingStatus,
    startsAt: row.booking.startsAt,
    endsAt: row.booking.endsAt,
    when: formatWhen(row.booking.startsAt, row.timezone),
    partySize: row.booking.partySize,
    name: row.booking.name,
    notes: row.booking.notes,
    restaurant: row.restaurant,
    address: [row.address, row.city].filter(Boolean).join(", ") || null,
    phone: row.phone,
    slug: settings.slug,
    welcomeMessage: settings.welcomeMessage,
    cancellationHours: settings.cancellationHours,
    canCancel: canCustomerCancel(row.booking, settings.cancellationHours, now),
  };
}

export async function cancelBookingByToken(token: string) {
  const booking = await getBookingByToken(token);
  if (!booking) throw new HttpError(404, "Reserva no encontrada.");
  if (booking.status === "CANCELLED") return { cancelled: true };
  if (!booking.canCancel) throw new HttpError(409, `Ya no se puede cancelar online (hasta ${booking.cancellationHours} h antes). Llama al restaurante${booking.phone ? ` al ${booking.phone}` : ""}.`);
  const [updated] = await db
    .update(posBooking)
    .set({ status: "CANCELLED", cancelledAt: new Date(), cancelReason: "Cancelada por el cliente", updatedAt: new Date() })
    .where(and(eq(posBooking.id, booking.id), inArray(posBooking.status, ["PENDING", "CONFIRMED"])))
    .returning({ id: posBooking.id, companyId: posBooking.companyId });
  return {
    cancelled: Boolean(updated),
    notify: async () => {
      if (!updated) return;
      const info = await emailData(updated.id);
      if (!info) return;
      await sendBookingEmail(info.booking.email, customerBookingEmail("CANCELLED", { ...info.data, manageUrl: null }));
      await sendBookingEmail(info.settings.notifyEmail, restaurantBookingEmail("CANCELLED", { ...info.data, tables: info.tables, bookingsUrl: `${appBaseUrl()}/pos/bookings?date=${zonedParts(info.booking.startsAt, info.settings.timezone).date}`, email: info.booking.email, customerPhone: info.booking.phone }));
      await notifyWaitlist(updated.companyId, zonedParts(info.booking.startsAt, info.settings.timezone).date);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Gestión del restaurante
// ---------------------------------------------------------------------------------------------

/** Reservas de un día (en la zona de la empresa), con sus mesas. Las sentadas cuya cuenta ya se cobró pasan a terminadas. */
export async function listBookings(companyId: string, date: string) {
  const settings = await getBookingSettings(companyId);
  const from = zonedToUtc(date, "00:00", settings.timezone);
  const to = zonedToUtc(addDays(date, 1), "00:00", settings.timezone);
  await db.execute(sql`
    update pos_booking b set status = 'COMPLETED', "updatedAt" = now()
    from pos_order o
    where b."orderId" = o.id and b."companyId" = ${companyId} and b.status = 'SEATED' and o.status in ('PAID', 'CANCELLED')
  `);
  const [rows, tables] = await Promise.all([
    db.select().from(posBooking).where(and(eq(posBooking.companyId, companyId), gte(posBooking.startsAt, from), lt(posBooking.startsAt, to))).orderBy(asc(posBooking.startsAt), asc(posBooking.createdAt)),
    loadTables(db, companyId, false),
  ]);
  const waitlist = await listWaitlist(companyId, date);
  return {
    date,
    waitlist,
    timezone: settings.timezone,
    enabled: settings.enabled,
    slug: settings.slug,
    registerId: settings.registerId,
    durationMinutes: settings.durationMinutes,
    tables: tables.map((table) => ({ id: table.id, name: table.name, seats: table.seats, areaId: table.areaId, areaName: table.areaName })),
    bookings: rows.map((row) => ({
      id: row.id,
      code: row.code,
      status: row.status as BookingStatus,
      source: row.source as BookingSource,
      time: zonedParts(row.startsAt, settings.timezone).time,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      partySize: row.partySize,
      name: row.name,
      phone: row.phone,
      email: row.email,
      notes: row.notes,
      tableIds: row.tableIds,
      tableNames: row.tableIds.map((id) => tables.find((table) => table.id === id)?.name ?? "?").join(" + "),
      orderId: row.orderId,
    })),
  };
}

export type BookingDay = Awaited<ReturnType<typeof listBookings>>;

export type StaffBookingInput = { date: string; time: string; partySize: number; name: string; phone: string | null; email: string | null; notes: string | null; tableIds: string[] | null; source: BookingSource };

/** Mesas para una reserva del personal: las elegidas (si están libres) o la mejor libre de todas las mesas. */
async function staffTables(tx: DbClient, companyId: string, settings: Settings, startsAt: Date, partySize: number, requested: string[] | null, ignoreBookingId?: string) {
  const date = zonedParts(startsAt, settings.timezone).date;
  const [tables, bookings] = await Promise.all([loadTables(tx, companyId, false), loadBusy(tx, companyId, date, settings.timezone)]);
  const endsAt = new Date(startsAt.getTime() + settings.durationMinutes * 60_000);
  const busy = busyTableIds({ startsAt, endsAt }, bookings, ignoreBookingId);
  if (requested && requested.length > 0) {
    const chosen = requested.map((id) => tables.find((table) => table.id === id));
    if (chosen.some((table) => !table)) throw new HttpError(404, "Alguna mesa no existe o no está en uso.");
    const clash = (chosen as BookableTable[]).find((table) => busy.has(table.id));
    if (clash) throw new HttpError(409, `${clash.name} ya está reservada a esa hora.`);
    return requested;
  }
  const picked = pickTables(partySize, tables, busy, true);
  if (!picked) throw new HttpError(409, "No queda ninguna mesa libre para ese grupo a esa hora. Elige las mesas a mano o cambia la hora.");
  return picked.map((table) => table.id);
}

function staffStart(settings: Settings, date: string, time: string) {
  if (!isDate(date) || !isTime(time)) throw new HttpError(400, "Fecha u hora no válida.");
  return zonedToUtc(date, time, settings.timezone);
}

export async function createStaffBooking(actor: PosActor, input: StaffBookingInput) {
  const settings = await getBookingSettings(actor.companyId);
  const startsAt = staffStart(settings, input.date, input.time);
  const booking = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`booking:${actor.companyId}`}))`);
    const tableIds = await staffTables(tx, actor.companyId, settings, startsAt, input.partySize, input.tableIds);
    const created = await insertBooking(tx, actor.companyId, { status: "CONFIRMED", startsAt, durationMinutes: settings.durationMinutes, partySize: input.partySize, name: input.name, phone: input.phone, email: input.email, notes: input.notes, tableIds, source: input.source, consentAt: null, createdByUserId: actor.actorUserId });
    await audit(actor, "pos_booking.create", created.id, { ...input, tableIds }, tx);
    return created;
  });
  return { ...booking, notify: () => notifyNewBooking(actor.companyId, booking.id) };
}

async function loadOwned(client: DbClient, companyId: string, bookingId: string) {
  const [row] = await client.select().from(posBooking).where(and(eq(posBooking.id, bookingId), eq(posBooking.companyId, companyId))).limit(1);
  if (!row) throw new HttpError(404, "Reserva no encontrada.");
  return row;
}

export async function updateStaffBooking(actor: PosActor, bookingId: string, input: Omit<StaffBookingInput, "source">) {
  const settings = await getBookingSettings(actor.companyId);
  const startsAt = staffStart(settings, input.date, input.time);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`booking:${actor.companyId}`}))`);
    const current = await loadOwned(tx, actor.companyId, bookingId);
    if (!ACTIVE_BOOKING_STATUSES.includes(current.status as (typeof ACTIVE_BOOKING_STATUSES)[number])) throw new HttpError(409, "Solo se pueden cambiar reservas pendientes, confirmadas o sentadas.");
    const tableIds = await staffTables(tx, actor.companyId, settings, startsAt, input.partySize, input.tableIds, bookingId);
    const moved = current.startsAt.getTime() !== startsAt.getTime();
    await tx
      .update(posBooking)
      .set({
        startsAt,
        endsAt: new Date(startsAt.getTime() + (moved ? settings.durationMinutes * 60_000 : current.endsAt.getTime() - current.startsAt.getTime())),
        partySize: input.partySize,
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        email: input.email?.trim().toLowerCase() || null,
        notes: input.notes?.trim() || null,
        tableIds,
        ...(moved ? { reminderSentAt: null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(posBooking.id, bookingId));
    await audit(actor, "pos_booking.update", bookingId, { ...input, tableIds }, tx);
    return { id: bookingId };
  });
}

const TRANSITIONS: Record<"CONFIRM" | "CANCEL" | "NO_SHOW" | "COMPLETE" | "RESTORE", { from: BookingStatus[]; to: BookingStatus }> = {
  CONFIRM: { from: ["PENDING"], to: "CONFIRMED" },
  CANCEL: { from: ["PENDING", "CONFIRMED"], to: "CANCELLED" },
  NO_SHOW: { from: ["PENDING", "CONFIRMED"], to: "NO_SHOW" },
  COMPLETE: { from: ["SEATED"], to: "COMPLETED" },
  RESTORE: { from: ["CANCELLED", "NO_SHOW"], to: "CONFIRMED" },
};
export type BookingAction = keyof typeof TRANSITIONS;

export async function changeBookingStatus(actor: PosActor, bookingId: string, action: BookingAction, input: { reason?: string | null; notifyCustomer?: boolean } = {}) {
  const transition = TRANSITIONS[action];
  const settings = await getBookingSettings(actor.companyId);
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`booking:${actor.companyId}`}))`);
    const current = await loadOwned(tx, actor.companyId, bookingId);
    if (!transition.from.includes(current.status as BookingStatus)) throw new HttpError(409, "La reserva ya no está en un estado que permita ese cambio.");
    if (action === "RESTORE") {
      const bookings = await loadBusy(tx, actor.companyId, zonedParts(current.startsAt, settings.timezone).date, settings.timezone);
      const busy = busyTableIds(current, bookings, bookingId);
      if (current.tableIds.some((id) => busy.has(id))) throw new HttpError(409, "Su mesa ya está reservada a esa hora: edita la reserva para darle otra.");
    }
    await tx
      .update(posBooking)
      .set({ status: transition.to, updatedAt: new Date(), ...(transition.to === "CANCELLED" ? { cancelledAt: new Date(), cancelReason: input.reason?.trim() || "Cancelada por el restaurante" } : {}), ...(action === "RESTORE" ? { cancelledAt: null, cancelReason: null } : {}) })
      .where(eq(posBooking.id, bookingId));
    await audit(actor, `pos_booking.${action.toLowerCase()}`, bookingId, { reason: input.reason ?? null }, tx);
    return { id: bookingId, status: transition.to };
  });
  const notify = async () => {
    if (input.notifyCustomer === false) return;
    if (action === "CONFIRM") await notifyCustomer(bookingId, "CONFIRMED");
    if (action === "CANCEL") await notifyCustomer(bookingId, "CANCELLED");
  };
  // Una mesa liberada (cancelación o «no vino») se ofrece a la lista de espera.
  const freed = action === "CANCEL" || action === "NO_SHOW";
  const notifyAll = async () => {
    await notify();
    if (freed) {
      const [row] = await db.select({ startsAt: posBooking.startsAt }).from(posBooking).where(eq(posBooking.id, bookingId)).limit(1);
      if (row) await notifyWaitlist(actor.companyId, zonedParts(row.startsAt, settings.timezone).date);
    }
  };
  return { ...result, notify: notifyAll };
}

/** Sentar a una reserva: abre (o reutiliza) la cuenta de su primera mesa con sus comensales. */
export async function seatBooking(actor: PosActor, bookingId: string, input: { registerId: string | null; waiterUserId: string | null }) {
  const current = await loadOwned(db, actor.companyId, bookingId);
  if (!["PENDING", "CONFIRMED"].includes(current.status)) throw new HttpError(409, "Esta reserva ya no se puede sentar.");
  const settings = await getBookingSettings(actor.companyId);
  const registerId = input.registerId || settings.registerId;
  if (!registerId) throw new HttpError(400, "Elige en los ajustes de reservas la caja donde se sientan las reservas.");
  const [first, ...rest] = current.tableIds;
  const restNames = rest.length > 0 ? (await db.select({ name: posTable.name }).from(posTable).where(inArray(posTable.id, rest))).map((row) => row.name) : [];
  const order = await openOrder(actor, {
    registerId,
    tableId: first ?? null,
    label: first ? (restNames.length > 0 ? `Reserva ${current.name} (+ ${restNames.join(", ")})` : null) : `Reserva ${current.name}`,
    guests: current.partySize,
    waiterUserId: input.waiterUserId,
  });
  if (order.created && restNames.length > 0) await db.update(posOrder).set({ label: `Reserva ${current.name} (+ ${restNames.join(", ")})` }).where(eq(posOrder.id, order.id));
  await db.update(posBooking).set({ status: "SEATED", orderId: order.id, updatedAt: new Date() }).where(eq(posBooking.id, bookingId));
  await audit(actor, "pos_booking.seat", bookingId, { orderId: order.id, registerId });
  return { orderId: order.id, registerId };
}

/** Disponibilidad para el formulario del personal (sin antelación mínima y con todas las mesas). */
export async function getStaffAvailability(companyId: string, date: string, partySize: number, ignoreBookingId?: string) {
  if (!isDate(date)) throw new HttpError(400, "Fecha no válida.");
  const settings = await getBookingSettings(companyId);
  const [tables, bookings] = await Promise.all([loadTables(db, companyId, false), loadBusy(db, companyId, date, settings.timezone)]);
  const shifts = settings.hours.length > 0 ? settings.hours : [{ weekday: new Date(`${date}T00:00:00Z`).getUTCDay(), opensAt: "12:00", lastStart: "23:00" }];
  const slots = daySlots({ date, partySize, timeZone: settings.timezone, now: new Date(Date.now() - 30 * 60_000), rules: { ...rulesOf(settings), allowCombining: true }, shifts, tables, bookings, ignoreLead: true, ignoreBookingId });
  return slots.map((slot) => ({ time: slot.time, available: slot.available, tables: slot.tables?.map((table) => table.name).join(" + ") ?? null }));
}

/** Próximas reservas (hoy) por mesa, para avisar en el plano. */
export async function upcomingBookingsByTable(companyId: string, now = new Date()) {
  const rows = await db
    .select({ id: posBooking.id, startsAt: posBooking.startsAt, name: posBooking.name, partySize: posBooking.partySize, status: posBooking.status, tableIds: posBooking.tableIds })
    .from(posBooking)
    .where(and(eq(posBooking.companyId, companyId), inArray(posBooking.status, ["PENDING", "CONFIRMED"]), gte(posBooking.startsAt, new Date(now.getTime() - 45 * 60_000)), lt(posBooking.startsAt, new Date(now.getTime() + 4 * 3_600_000))))
    .orderBy(asc(posBooking.startsAt));
  const [{ timezone } = { timezone: "Europe/Madrid" }] = await db.select({ timezone: company.timezone }).from(company).where(eq(company.id, companyId)).limit(1);
  const byTable = new Map<string, { id: string; time: string; name: string; partySize: number; late: boolean }>();
  for (const row of rows) {
    for (const tableId of row.tableIds) {
      if (!byTable.has(tableId)) byTable.set(tableId, { id: row.id, time: zonedParts(row.startsAt, timezone).time, name: row.name, partySize: row.partySize, late: row.startsAt.getTime() < now.getTime() });
    }
  }
  return byTable;
}

export async function countPendingBookings(companyId: string) {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(posBooking).where(and(eq(posBooking.companyId, companyId), eq(posBooking.status, "PENDING"), gte(posBooking.startsAt, new Date())));
  return row?.count ?? 0;
}

// ---------------------------------------------------------------------------------------------
// Recordatorios (worker): el día antes, a quien reservó con más de 12 h de margen.
// ---------------------------------------------------------------------------------------------

export async function sendBookingReminders(now = new Date()) {
  const due = await db
    .select({ id: posBooking.id })
    .from(posBooking)
    .innerJoin(posBookingSettings, eq(posBookingSettings.companyId, posBooking.companyId))
    .where(
      and(
        eq(posBookingSettings.sendReminders, true),
        eq(posBooking.status, "CONFIRMED"),
        isNull(posBooking.reminderSentAt),
        sql`${posBooking.email} is not null`,
        gte(posBooking.startsAt, new Date(now.getTime() + 3 * 3_600_000)),
        lt(posBooking.startsAt, new Date(now.getTime() + 26 * 3_600_000)),
        sql`${posBooking.startsAt} - ${posBooking.createdAt} > interval '12 hours'`,
      ),
    )
    .limit(50);
  let sent = 0;
  for (const { id } of due) {
    // Se marca antes de enviar para no repetir si otro worker coincide.
    const [claimed] = await db.update(posBooking).set({ reminderSentAt: now }).where(and(eq(posBooking.id, id), isNull(posBooking.reminderSentAt))).returning({ id: posBooking.id });
    if (!claimed) continue;
    const info = await emailData(id);
    if (info && (await sendBookingEmail(info.booking.email, customerBookingEmail("REMINDER", info.data)))) sent += 1;
  }
  return { sent };
}
