import { z } from "zod";

import { BOOKING_SOURCES } from "@/modules/hospitality/bookings";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida.");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora no válida (HH:MM).");
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((value) => value || null);
const email = z.string().trim().max(200).email("Email no válido.");

export const settingsSchema = z.object({
  enabled: z.boolean(),
  slug: z.string().trim().min(3, "La dirección debe tener al menos 3 caracteres.").max(48),
  registerId: z.string().trim().nullable(),
  slotMinutes: z.number().int().min(5).max(120),
  durationMinutes: z.number().int().min(15).max(600),
  minPartySize: z.number().int().min(1).max(100),
  maxPartySize: z.number().int().min(1).max(100),
  leadMinutes: z.number().int().min(0).max(10_080),
  maxDaysAhead: z.number().int().min(1).max(365),
  autoConfirm: z.boolean(),
  cancellationHours: z.number().int().min(0).max(168),
  allowCombining: z.boolean(),
  welcomeMessage: optionalText(1000),
  notifyEmail: z.union([email, z.literal("")]).nullable().optional().transform((value) => value || null),
  sendReminders: z.boolean(),
  depositEnabled: z.boolean().default(false),
  depositProvider: z.enum(["STRIPE", "REDSYS"]).nullable().default(null),
  depositPerPerson: z.number().min(0).max(1000).default(0),
  depositMinParty: z.number().int().min(1).max(100).default(1),
  depositRefundable: z.boolean().default(true),
  hours: z.array(z.object({ weekday: z.number().int().min(0).max(6), opensAt: time, lastStart: time })).max(50),
});

export const closureSchema = z.object({ date, reason: optionalText(120) });

const bookingFields = {
  date,
  time,
  partySize: z.number().int().min(1).max(500),
  name: z.string().trim().min(1, "Pon el nombre de la reserva.").max(80),
  phone: optionalText(30),
  email: z.union([email, z.literal("")]).nullable().optional().transform((value) => value || null),
  notes: optionalText(500),
  tableIds: z.array(z.string().trim().min(1)).max(6).nullable().optional().transform((value) => (value && value.length > 0 ? value : null)),
};

export const staffBookingSchema = z.object({ ...bookingFields, source: z.enum(BOOKING_SOURCES).default("PHONE") });
export const staffBookingUpdateSchema = z.object(bookingFields);
export const statusSchema = z.object({ action: z.enum(["CONFIRM", "CANCEL", "NO_SHOW", "COMPLETE", "RESTORE"]), reason: optionalText(200), notifyCustomer: z.boolean().optional(), refundDeposit: z.boolean().optional() });
export const seatSchema = z.object({ registerId: z.string().trim().nullable().optional(), waiterUserId: z.string().trim().nullable().optional() });

export const publicBookingSchema = z.object({
  date,
  time,
  partySize: z.number().int().min(1).max(100),
  name: z.string().trim().min(2, "Escribe tu nombre.").max(80),
  phone: z.string().trim().min(6, "Escribe un teléfono de contacto.").max(30).regex(/^[+\d][\d\s().-]{5,}$/, "Teléfono no válido."),
  email,
  notes: optionalText(500),
  consent: z.literal(true, { error: "Debes aceptar el tratamiento de tus datos para reservar." }),
  whatsappOptIn: z.boolean().optional(),
  // Trampa para bots: un campo oculto que una persona nunca rellena.
  website: z.string().max(0, "No se pudo enviar la reserva.").optional(),
});

export function firstIssue(error: z.ZodError) {
  return error.issues[0]?.message ?? "Datos inválidos.";
}
