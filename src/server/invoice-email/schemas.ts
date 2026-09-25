import { z } from "zod";

/** Validación de las peticiones de envío por email y de ajustes de plantillas. */

const emailList = z.union([z.string().max(4000), z.array(z.string().max(254)).max(20)]).optional().nullable();

export const sendInvoiceEmailSchema = z.object({
  invoiceId: z.string().trim().min(1, "Indica la factura."),
  to: emailList,
  cc: emailList,
  subject: z.string().trim().max(250, "El asunto no puede superar 250 caracteres.").optional().nullable(),
  body: z.string().max(20_000, "El mensaje es demasiado largo.").optional().nullable(),
  copyToSelf: z.boolean().optional(),
});

export const bulkInvoiceEmailSchema = z.object({
  invoiceIds: z.array(z.string().trim().min(1)).min(1, "Selecciona al menos una factura.").max(100, "Como máximo 100 facturas por envío."),
  copyToSelf: z.boolean().optional(),
});

export const sendReminderSchema = sendInvoiceEmailSchema.extend({
  reminderLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().nullable(),
});

const templateSchema = z.object({
  subject: z.string().max(250, "El asunto no puede superar 250 caracteres."),
  body: z.string().max(20_000, "El mensaje es demasiado largo."),
});

export const invoiceEmailSettingsSchema = z.object({
  templates: z.object({
    invoice: templateSchema.optional(),
    reminder1: templateSchema.optional(),
    reminder2: templateSchema.optional(),
    reminder3: templateSchema.optional(),
  }),
  copyToSelfDefault: z.boolean(),
  dunning: z.object({
    enabled: z.boolean(),
    firstDelayDays: z.number().int().min(0, "Entre 0 y 365 días.").max(365, "Entre 0 y 365 días."),
    intervalDays: z.number().int().min(1, "Entre 1 y 365 días.").max(365, "Entre 1 y 365 días."),
    maxReminders: z.number().int().min(1, "Entre 1 y 3 recordatorios.").max(3, "Entre 1 y 3 recordatorios."),
  }),
});

export const dunningOptOutSchema = z.object({
  customerId: z.string().trim().min(1),
  optOut: z.boolean(),
});

export function firstIssueMessage(error: z.ZodError, fallback: string) {
  return error.issues[0]?.message ?? fallback;
}
