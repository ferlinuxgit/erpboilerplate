import { z } from "zod";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora no válida (HH:MM).");
const text = (max: number) => z.string().trim().max(max).nullable().optional().transform((value) => value || null);
const optionalTime = z.union([time, z.literal("")]).nullable().optional().transform((value) => value || null);

export const menuSettingsSchema = z.object({
  enabled: z.boolean(),
  slug: z.string().trim().min(3, "La dirección debe tener al menos 3 caracteres.").max(48),
  intro: text(600),
  introEn: text(600),
  showBookingLink: z.boolean(),
});

export const sectionSchema = z.object({
  name: z.string().trim().min(1, "Pon un nombre a la sección.").max(60),
  nameEn: text(60),
  description: text(300),
  descriptionEn: text(300),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  fromTime: optionalTime,
  toTime: optionalTime,
  fixedPrice: z.number().min(0).max(100_000).nullable().optional().transform((value) => value ?? null),
  isActive: z.boolean().default(true),
});

export const moveSchema = z.object({ direction: z.enum(["up", "down"]) });

export const menuItemSchema = z.object({
  sectionId: z.string().trim().min(1).nullable(),
  visible: z.boolean(),
  displayName: text(80),
  nameEn: text(80),
  description: text(400),
  descriptionEn: text(400),
  allergens: z.array(z.string()).max(14),
  traces: z.array(z.string()).max(14).default([]),
  tags: z.array(z.string()).max(10),
});

export const visibleSchema = z.object({ visible: z.boolean() });
export const soldOutSchema = z.object({ soldOut: z.boolean() });
export const imageSchema = z.object({ image: z.string().max(700_000).nullable() });

export function firstIssue(error: z.ZodError) {
  return error.issues[0]?.message ?? "Datos inválidos.";
}
