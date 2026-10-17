import { createHash, createHmac } from "node:crypto";

import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";

import { posBookingSettings, posWaitlist } from "@/db/schema";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { isDate, isTime, zonedParts } from "@/modules/hospitality/bookings";
import { recordAudit } from "@/server/audit";
import { appBaseUrl } from "@/server/email/templates";
import type { PosActor } from "@/server/pos/service";

import { sendBookingEmail, waitlistEmail } from "./booking-emails";
import { getBookingSettings, getPublicBookingPage, hasAvailability } from "./bookings";

export const WAITLIST_STATUSES = ["WAITING", "NOTIFIED", "BOOKED", "CANCELLED"] as const;
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];

function waitlistToken(id: string) {
  return createHmac("sha256", process.env.JWT_SECRET || "erp-bookings").update(`waitlist:${id}`).digest("base64url");
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const cancelUrl = (id: string) => `${appBaseUrl()}/reservar/espera/${waitlistToken(id)}`;
const dayLabel = (date: string) => new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

export type WaitlistJoinInput = { date: string; partySize: number; preferredTime: string | null; name: string; phone: string; email: string; notes: string | null };

/** Apuntarse desde el formulario público cuando el día está completo. */
export async function joinWaitlist(slug: string, input: WaitlistJoinInput) {
  const page = await getPublicBookingPage(slug);
  if (!page) throw new HttpError(404, "Este restaurante no acepta reservas online ahora mismo.");
  if (!isDate(input.date) || input.date < page.today || input.date > page.lastDay) throw new HttpError(400, "Fecha no válida.");
  if (page.closures.includes(input.date)) throw new HttpError(400, "Ese día el restaurante está cerrado.");
  if (input.partySize < page.minPartySize || input.partySize > page.maxPartySize) throw new HttpError(400, `La lista de espera online es para ${page.minPartySize}–${page.maxPartySize} personas.`);
  if (input.preferredTime && !isTime(input.preferredTime)) throw new HttpError(400, "Hora no válida.");
  const email = input.email.trim().toLowerCase();
  const [existing] = await db.select({ id: posWaitlist.id }).from(posWaitlist).where(and(eq(posWaitlist.companyId, page.companyId), eq(posWaitlist.date, input.date), eq(posWaitlist.email, email), inArray(posWaitlist.status, ["WAITING", "NOTIFIED"]))).limit(1);
  if (existing) return { id: existing.id, token: waitlistToken(existing.id), notify: async () => undefined };
  const id = crypto.randomUUID();
  await db.insert(posWaitlist).values({ id, companyId: page.companyId, date: input.date, preferredTime: input.preferredTime, partySize: input.partySize, name: input.name.trim(), phone: input.phone.trim(), email, notes: input.notes?.trim() || null, source: "WEB", manageTokenHash: hashToken(waitlistToken(id)), consentAt: new Date() });
  const bookUrl = `${appBaseUrl()}/reservar/${page.slug}?fecha=${input.date}&personas=${input.partySize}`;
  return {
    id,
    token: waitlistToken(id),
    notify: () => sendBookingEmail(email, waitlistEmail("JOINED", { restaurant: page.name, name: input.name.trim(), partySize: input.partySize, day: dayLabel(input.date), preferredTime: input.preferredTime, bookUrl, cancelUrl: cancelUrl(id) })).then(() => undefined),
  };
}

export async function getWaitlistByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [row] = await db.select().from(posWaitlist).where(eq(posWaitlist.manageTokenHash, hashToken(token))).limit(1);
  if (!row) return null;
  const [settings] = await db.select({ slug: posBookingSettings.slug }).from(posBookingSettings).where(eq(posBookingSettings.companyId, row.companyId)).limit(1);
  return { id: row.id, status: row.status as WaitlistStatus, date: row.date, day: dayLabel(row.date), partySize: row.partySize, name: row.name, preferredTime: row.preferredTime, slug: settings?.slug ?? null };
}

export async function cancelWaitlistByToken(token: string) {
  const entry = await getWaitlistByToken(token);
  if (!entry) throw new HttpError(404, "No encontramos esa solicitud.");
  await db.update(posWaitlist).set({ status: "CANCELLED", updatedAt: new Date() }).where(and(eq(posWaitlist.id, entry.id), inArray(posWaitlist.status, ["WAITING", "NOTIFIED"])));
  return { cancelled: true };
}

/**
 * Se ha liberado sitio un día: avisa por email (los más antiguos primero, hasta 5) a quien esté
 * esperando y ahora quepa. Quien reserve primero se queda la mesa.
 */
export async function notifyWaitlist(companyId: string, date: string) {
  const waiting = await db
    .select()
    .from(posWaitlist)
    .where(and(eq(posWaitlist.companyId, companyId), eq(posWaitlist.date, date), eq(posWaitlist.status, "WAITING"), eq(posWaitlist.source, "WEB"), isNotNull(posWaitlist.email)))
    .orderBy(asc(posWaitlist.createdAt))
    .limit(20);
  if (waiting.length === 0) return { notified: 0 };
  const page = await (async () => {
    const [settings] = await db.select({ slug: posBookingSettings.slug }).from(posBookingSettings).where(eq(posBookingSettings.companyId, companyId)).limit(1);
    return settings ? getPublicBookingPage(settings.slug) : null;
  })();
  if (!page) return { notified: 0 };
  let notified = 0;
  for (const entry of waiting) {
    if (notified >= 5) break;
    const { available } = await hasAvailability(companyId, date, entry.partySize);
    if (!available) continue;
    const [claimed] = await db.update(posWaitlist).set({ status: "NOTIFIED", notifiedAt: new Date(), updatedAt: new Date() }).where(and(eq(posWaitlist.id, entry.id), eq(posWaitlist.status, "WAITING"))).returning({ id: posWaitlist.id });
    if (!claimed) continue;
    await sendBookingEmail(entry.email, waitlistEmail("AVAILABLE", { restaurant: page.name, name: entry.name, partySize: entry.partySize, day: dayLabel(date), preferredTime: entry.preferredTime, bookUrl: `${appBaseUrl()}/reservar/${page.slug}?fecha=${date}&personas=${entry.partySize}`, cancelUrl: cancelUrl(entry.id) }));
    notified += 1;
  }
  return { notified };
}

// ---------------------------------------------------------------------------------------------
// Pantalla del restaurante
// ---------------------------------------------------------------------------------------------

export async function listWaitlist(companyId: string, date: string) {
  const rows = await db.select().from(posWaitlist).where(and(eq(posWaitlist.companyId, companyId), eq(posWaitlist.date, date), inArray(posWaitlist.status, ["WAITING", "NOTIFIED"]))).orderBy(asc(posWaitlist.createdAt));
  return rows.map((row) => ({ id: row.id, source: row.source as "WEB" | "WALK_IN", status: row.status as WaitlistStatus, partySize: row.partySize, name: row.name, phone: row.phone, email: row.email, notes: row.notes, preferredTime: row.preferredTime, createdAt: row.createdAt.toISOString(), notifiedAt: row.notifiedAt?.toISOString() ?? null }));
}

/** Grupo que espera en la puerta (hoy). */
export async function addWalkIn(actor: PosActor, input: { name: string; partySize: number; phone: string | null; notes: string | null }) {
  const settings = await getBookingSettings(actor.companyId);
  const today = zonedParts(new Date(), settings.timezone).date;
  const [created] = await db.insert(posWaitlist).values({ companyId: actor.companyId, date: today, partySize: input.partySize, name: input.name.trim(), phone: input.phone?.trim() || null, notes: input.notes?.trim() || null, source: "WALK_IN" }).returning({ id: posWaitlist.id });
  await recordAudit({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action: "pos_waitlist.walk_in", entityName: "pos_waitlist", entityId: created.id, payload: input });
  return created;
}

export async function setWaitlistStatus(actor: PosActor, id: string, status: WaitlistStatus) {
  const [updated] = await db.update(posWaitlist).set({ status, ...(status === "NOTIFIED" ? { notifiedAt: new Date() } : {}), updatedAt: new Date() }).where(and(eq(posWaitlist.id, id), eq(posWaitlist.companyId, actor.companyId))).returning({ id: posWaitlist.id });
  if (!updated) throw new HttpError(404, "No encontrado en la lista de espera.");
  await recordAudit({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action: `pos_waitlist.${status.toLowerCase()}`, entityName: "pos_waitlist", entityId: id, payload: {} });
  return updated;
}

