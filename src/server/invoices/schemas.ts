import { z } from "zod";

import { RECTIFICATION_REASONS, RECTIFICATION_TYPES, salesVatTreatmentOptions } from "@/server/invoices/lifecycle";
import { createCustomerSchema, invoiceLineFormSchema, invoiceStatusSchema } from "@/server/schemas/forms";

/** Esquemas de facturas emitidas compartidos por API y formularios (sin dependencias de servidor). */

const salesVatTreatmentValues = salesVatTreatmentOptions.map((option) => option.value) as [
  (typeof salesVatTreatmentOptions)[number]["value"],
  ...Array<(typeof salesVatTreatmentOptions)[number]["value"]>,
];

export const salesVatTreatmentSchema = z.enum(salesVatTreatmentValues, { error: "El tratamiento de IVA no es válido." });

const paymentMethodReferenceSchema = z
  .string()
  .trim()
  .min(1, "La forma de pago seleccionada no es válida.")
  .max(160, "La forma de pago seleccionada no es válida.");

const paymentMethodIdsSchema = z.array(paymentMethodReferenceSchema).max(12, "No puedes seleccionar más de 12 formas de pago.");

export const invoiceLineSchema = invoiceLineFormSchema;

export const createInvoiceSchema = z.object({
  customerId: z.string().trim().optional().or(z.literal("")),
  paymentMethodId: z.string().trim().optional().or(z.literal("")),
  paymentMethodIds: paymentMethodIdsSchema.optional(),
  newCustomer: createCustomerSchema.optional(),
  issueDate: z.string().trim().min(1, "Debes indicar una fecha de emisión."),
  dueDate: z.string().trim().optional().or(z.literal("")),
  /** Informativo: el servidor recalcula siempre el total desde las líneas. */
  totalAmount: z.number().optional(),
  notes: z.string().trim().max(2000, "Las notas no pueden superar 2.000 caracteres.").optional().or(z.literal("")),
  vatTreatment: salesVatTreatmentSchema.optional().nullable(),
  lines: z.array(invoiceLineSchema).min(1, "Debes añadir al menos una línea."),
  /** "draft" guarda un borrador editable; "issue" (por defecto, compatible con integraciones) emite. */
  mode: z.enum(["draft", "issue"]).optional(),
  returnPdf: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (!value.customerId?.trim() && !value.newCustomer) {
    ctx.addIssue({
      code: "custom",
      message: "Debes seleccionar un cliente o crear uno nuevo.",
      path: ["customerId"],
    });
  }
});

/** Edición de un borrador: todo es editable. */
export const updateDraftInvoiceSchema = z.object({
  customerId: z.string().trim().optional().or(z.literal("")),
  issueDate: z.string().trim().min(1, "Debes indicar una fecha de emisión.").optional(),
  dueDate: z.string().trim().optional().or(z.literal("")),
  paymentMethodId: z.string().trim().optional().or(z.literal("")),
  paymentMethodIds: paymentMethodIdsSchema.optional(),
  /** Legado: el estado ya no se edita (se emite con la acción Emitir). */
  status: invoiceStatusSchema.optional(),
  notes: z.string().trim().max(2000, "Las notas no pueden superar 2.000 caracteres.").optional().or(z.literal("")),
  vatTreatment: salesVatTreatmentSchema.optional().nullable(),
  totalAmount: z.number().optional(),
  lines: z.array(invoiceLineSchema).min(1, "Debes añadir al menos una línea.").optional(),
  /** Tras guardar, emitir la factura en la misma operación. */
  issue: z.boolean().optional(),
});

/** Formulario de edición de borradores (las líneas son obligatorias). */
export const draftInvoiceFormSchema = updateDraftInvoiceSchema.extend({
  lines: z.array(invoiceLineSchema).min(1, "Debes añadir al menos una línea."),
});

/** Edición de una factura emitida: solo notas y formas de pago. */
export const issuedInvoiceEditSchema = z.object({
  notes: z.string().trim().max(2000, "Las notas no pueden superar 2.000 caracteres.").optional().or(z.literal("")),
  paymentMethodIds: paymentMethodIdsSchema.optional(),
});

/** Campos que siguen siendo editables en una factura emitida. */
export const ISSUED_EDITABLE_FIELDS = ["notes", "paymentMethodIds", "paymentMethodId"] as const;
export const ISSUED_LOCKED_FIELDS = ["customerId", "issueDate", "dueDate", "lines", "vatTreatment", "totalAmount"] as const;

export const creditNoteLineSchema = z.object({
  itemId: z.string().trim().optional().nullable(),
  description: z.string().trim().min(1, "La línea debe tener descripción."),
  quantity: z.number().positive("La cantidad debe ser mayor que 0."),
  unitPrice: z.number().nonnegative("El importe no puede ser negativo."),
  discountPct: z.number().min(0).max(100).optional(),
  taxIds: z.array(z.uuid("El impuesto seleccionado no es válido.")).max(12).optional(),
  /** Líneas antiguas sin impuestos configurados: tipo de IVA y retención de la línea original. */
  taxRate: z.number().min(0).max(100).optional(),
  retentionRate: z.number().min(0).max(100).optional(),
});

export const createCreditNoteSchema = z.object({
  reason: z.enum(RECTIFICATION_REASONS as [string, ...string[]], { error: "Indica la causa de la rectificación (R1–R5)." }),
  type: z.enum(RECTIFICATION_TYPES as [string, ...string[]]).default("DIFFERENCES"),
  /** FULL: anula íntegramente la original. PARTIAL: solo las líneas indicadas (importes a abonar). */
  scope: z.enum(["FULL", "PARTIAL"]).default("FULL"),
  description: z.string().trim().min(3, "Explica brevemente el motivo de la rectificación.").max(500, "El motivo no puede superar 500 caracteres."),
  issueDate: z.string().trim().optional().or(z.literal("")),
  /**
   * PARTIAL + DIFFERENCES: importes (positivos) que se abonan.
   * SUBSTITUTION: líneas correctas que sustituyen a las de la factura original.
   */
  lines: z.array(creditNoteLineSchema).max(200).optional(),
  /** false guarda la rectificativa como borrador. */
  issue: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if ((value.scope === "PARTIAL" || value.type === "SUBSTITUTION") && (!value.lines || value.lines.length === 0)) {
    ctx.addIssue({ code: "custom", message: "Indica al menos una línea para la rectificación.", path: ["lines"] });
  }
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type UpdateDraftInvoiceInput = z.infer<typeof updateDraftInvoiceSchema>;
export type CreateCreditNoteInput = z.infer<typeof createCreditNoteSchema>;
