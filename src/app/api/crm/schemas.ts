import { z } from "zod";

import { CRM_ACTIVITY_TYPES, CRM_STAGE_KINDS } from "@/modules/crm/model";

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const isoDate = z.string().trim().refine((value) => !Number.isNaN(new Date(value).getTime()), "Fecha no válida.");

export const opportunitySchema = z.object({
  title: z.string().trim().min(2, "Pon un título a la oportunidad.").max(200),
  customerId: z.string().trim().nullable().optional(),
  contactName: optionalText(200),
  contactEmail: z.string().trim().email("El email del contacto no es válido.").nullable().optional().or(z.literal("")),
  contactPhone: optionalText(60),
  stageId: z.string().trim().nullable().optional(),
  amount: z.number().min(0, "El importe no puede ser negativo.").max(999_999_999),
  expectedCloseDate: isoDate.nullable().optional(),
  ownerUserId: z.string().trim().nullable().optional(),
  source: optionalText(60),
  notes: optionalText(5000),
  lostReason: optionalText(500),
});

export const opportunityUpdateSchema = opportunitySchema.partial();

export const moveSchema = z.object({
  stageId: z.string().trim().min(1),
  index: z.number().int().min(0).optional(),
  lostReason: optionalText(500),
});

export const activitySchema = z.object({
  type: z.enum(CRM_ACTIVITY_TYPES),
  subject: z.string().trim().min(2, "Describe la actividad.").max(300),
  notes: optionalText(5000),
  dueAt: isoDate.nullable().optional(),
  opportunityId: z.string().trim().nullable().optional(),
  customerId: z.string().trim().nullable().optional(),
  assignedUserId: z.string().trim().nullable().optional(),
  completed: z.boolean().optional(),
});

export const activityUpdateSchema = activitySchema.partial();

export const stagesSchema = z.object({
  stages: z.array(z.object({
    id: z.string().trim().optional(),
    name: z.string().trim().min(1).max(60),
    probability: z.number().int().min(0).max(100),
    kind: z.enum(CRM_STAGE_KINDS),
  })).min(3).max(20),
});

export function toDate(value: string | null | undefined) {
  if (value === undefined) return undefined;
  return value ? new Date(value) : null;
}

export function firstIssue(error: z.ZodError) {
  return error.issues[0]?.message ?? "Datos inválidos.";
}
