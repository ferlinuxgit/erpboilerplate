import { z } from "zod";

import { isDateInput, RECURRING_FREQUENCIES } from "@/server/recurring/schedule";

/** Validación de plantillas recurrentes (compartida por API y formularios). */

export const RECURRING_KINDS = ["SALES_INVOICE", "EXPENSE"] as const;
export type RecurringKind = (typeof RECURRING_KINDS)[number];

export const INVOICE_ISSUE_MODES = ["DRAFT", "ISSUE", "ISSUE_AND_EMAIL"] as const;
export const EXPENSE_ISSUE_MODES = ["DRAFT", "POST"] as const;
export type RecurringIssueMode = (typeof INVOICE_ISSUE_MODES)[number] | (typeof EXPENSE_ISSUE_MODES)[number];

export const issueModeLabels: Record<RecurringIssueMode, string> = {
  DRAFT: "Crear borrador para revisar",
  ISSUE: "Emitir automáticamente",
  ISSUE_AND_EMAIL: "Emitir y enviar por email",
  POST: "Registrar automáticamente",
};

export const expenseIssueModeLabels: Record<(typeof EXPENSE_ISSUE_MODES)[number], string> = {
  DRAFT: "Dejar pendiente de revisar",
  POST: "Registrar automáticamente",
};

/** Modos que crean documentos con efectos fiscales sin intervención: exigen confirmación explícita. */
export function isAutomaticMode(mode: string) {
  return mode === "ISSUE" || mode === "ISSUE_AND_EMAIL" || mode === "POST";
}

const pct = (message: string) => z.number({ error: message }).min(0, message).max(100, message);

export const recurringLineSchema = z.object({
  itemId: z.string().trim().max(80).optional().nullable(),
  description: z.string().trim().min(1, "Escribe el concepto de la línea.").max(500, "El concepto no puede superar 500 caracteres."),
  quantity: z.number({ error: "La cantidad debe ser mayor que cero." }).positive("La cantidad debe ser mayor que cero.").max(1_000_000),
  unitPrice: z.number({ error: "Indica un precio." }).min(0, "El precio no puede ser negativo.").max(100_000_000),
  discountPct: pct("El descuento debe estar entre 0 y 100 %.").optional(),
  taxRate: pct("El IVA debe estar entre 0 y 100 %."),
  retentionRate: pct("La retención debe estar entre 0 y 100 %.").default(0),
  expenseAccountId: z.string().trim().max(80).optional().nullable(),
  taxDeductiblePct: pct("El IVA deducible debe estar entre 0 y 100 %.").optional(),
});

const dateSchema = z.string().trim().refine(isDateInput, "Indica una fecha válida.");

export const recurringTemplateSchema = z.object({
  kind: z.enum(RECURRING_KINDS),
  name: z.string().trim().min(1, "Ponle un nombre para reconocerla (p. ej. «Cuota mensual de mantenimiento»).").max(120),
  customerId: z.string().trim().max(80).optional().nullable(),
  supplierPartnerId: z.string().trim().max(80).optional().nullable(),
  frequency: z.enum(RECURRING_FREQUENCIES, { error: "Elige cada cuánto se repite." }),
  everyMonths: z.number().int().min(1, "Entre 1 y 60 meses.").max(60, "Entre 1 y 60 meses.").optional().nullable(),
  startDate: dateSchema,
  lastDayOfMonth: z.boolean().optional(),
  endDate: dateSchema.optional().nullable().or(z.literal("")),
  maxOccurrences: z.number().int().min(1, "Al menos 1 emisión.").max(600).optional().nullable(),
  issueMode: z.enum(["DRAFT", "ISSUE", "ISSUE_AND_EMAIL", "POST"]),
  confirmAutomatic: z.boolean().optional(),
  lines: z.array(recurringLineSchema).min(1, "Añade al menos una línea.").max(50, "Como máximo 50 líneas."),
  notes: z.string().trim().max(2000, "Las notas no pueden superar 2.000 caracteres.").optional().nullable(),
  sourceInvoiceId: z.string().trim().max(80).optional().nullable(),
}).superRefine((value, ctx) => {
  if (value.kind === "SALES_INVOICE" && !value.customerId) ctx.addIssue({ code: "custom", path: ["customerId"], message: "Elige el cliente." });
  if (value.kind === "EXPENSE" && !value.supplierPartnerId) ctx.addIssue({ code: "custom", path: ["supplierPartnerId"], message: "Elige el proveedor." });
  if (value.kind === "SALES_INVOICE" && !(INVOICE_ISSUE_MODES as readonly string[]).includes(value.issueMode)) {
    ctx.addIssue({ code: "custom", path: ["issueMode"], message: "Modo de emisión no válido para facturas." });
  }
  if (value.kind === "EXPENSE" && !(EXPENSE_ISSUE_MODES as readonly string[]).includes(value.issueMode)) {
    ctx.addIssue({ code: "custom", path: ["issueMode"], message: "Modo no válido para gastos." });
  }
  if (value.kind === "EXPENSE" && value.lines.some((line) => !line.expenseAccountId)) {
    ctx.addIssue({ code: "custom", path: ["lines"], message: "Elige la cuenta de gasto de cada línea." });
  }
  if (value.frequency === "EVERY_N_MONTHS" && !value.everyMonths) ctx.addIssue({ code: "custom", path: ["everyMonths"], message: "Indica cada cuántos meses." });
  if (value.endDate && value.endDate < value.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "La fecha final no puede ser anterior a la primera emisión." });
  if (isAutomaticMode(value.issueMode) && !value.confirmAutomatic) {
    ctx.addIssue({ code: "custom", path: ["confirmAutomatic"], message: "Confirma que quieres generar los documentos automáticamente." });
  }
});

export type RecurringTemplateInput = z.infer<typeof recurringTemplateSchema>;

export const recurringStatusSchema = z.object({ status: z.enum(["ACTIVE", "PAUSED"]) });
