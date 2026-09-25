import { z } from "zod";

import { isCountryCode } from "@/lib/countries";
import { salesVatTreatmentOptions } from "@/server/invoices/lifecycle";
import { createCustomerSchema, customerStatusSchema } from "@/server/schemas/forms";

/**
 * Esquemas de la ficha de cliente (datos fiscales + condiciones de facturación).
 * Sin dependencias de servidor: se usan también en los formularios.
 */

/** Un cliente con facturas o documentos comerciales no se elimina: se marca como Inactivo. */
export const CUSTOMER_HAS_DOCUMENTS_MESSAGE = "Tiene documentos; márcalo como Inactivo. Así deja de aparecer al facturar y conservas su historial.";

const vatTreatmentValues = salesVatTreatmentOptions.map((option) => option.value) as [
  (typeof salesVatTreatmentOptions)[number]["value"],
  ...Array<(typeof salesVatTreatmentOptions)[number]["value"]>,
];

/** IBAN opcional: se guarda en mayúsculas y sin espacios; se valida el dígito de control (mod 97). */
export function normalizeIban(value: string | null | undefined) {
  return (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isValidIban(value: string) {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;
  for (const char of rearranged) {
    const digits = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

export const customerBillingSchema = z.object({
  paymentTermsDays: z
    .number({ error: "Indica los días de pago (0 = al contado)." })
    .int("Los días de pago deben ser un número entero.")
    .min(0, "Los días de pago no pueden ser negativos.")
    .max(365, "Los días de pago no pueden superar 365.")
    .nullable()
    .optional(),
  defaultRetentionRate: z
    .number({ error: "La retención debe ser un porcentaje." })
    .min(0, "La retención no puede ser negativa.")
    .max(50, "La retención no puede superar el 50 %.")
    .nullable()
    .optional(),
  defaultVatTreatment: z.enum(vatTreatmentValues, { error: "El tratamiento de IVA no es válido." }).nullable().optional().or(z.literal("")),
  invoiceEmail: z.string().trim().email("Indica un correo válido para enviar las facturas.").optional().or(z.literal("")),
  iban: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .refine((value) => !value || isValidIban(value), "El IBAN no es válido. Revisa los dígitos (ej.: ES91 2100 0418 4502 0005 1332)."),
  equivalenceSurcharge: z.boolean().optional(),
});

function refineCountry(value: { countryCode: string }, ctx: z.RefinementCtx) {
  if (!isCountryCode(value.countryCode)) {
    ctx.addIssue({ code: "custom", message: "Elige un país de la lista.", path: ["countryCode"] });
  }
}

/** Alta de cliente: identidad fiscal (misma validación que siempre) + condiciones de facturación. */
export const customerFormSchema = createCustomerSchema.safeExtend(customerBillingSchema.shape).superRefine(refineCountry);

export const customerUpdateFormSchema = createCustomerSchema
  .safeExtend({ ...customerBillingSchema.shape, status: customerStatusSchema.optional() })
  .superRefine(refineCountry);

export type CustomerFormInput = z.infer<typeof customerFormSchema>;
export type CustomerUpdateFormInput = z.infer<typeof customerUpdateFormSchema>;
