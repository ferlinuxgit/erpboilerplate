import { z } from "zod";

import { BUSINESS_TYPES, isValidIban, isValidSeriesPrefix } from "@/lib/company-readiness";
import { describeSpanishTaxIdProblem, normalizeSpanishTaxId } from "@/lib/spanish-tax-id";

/**
 * Validación del asistente de puesta en marcha, compartida por el formulario y la API.
 * La API acepta envíos parciales (cada paso guarda lo suyo); el formulario exige en
 * cada paso los campos obligatorios de ese paso.
 */

const optionalText = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres.`);

export const onboardingFieldsSchema = z.object({
  legalName: z.string().trim().min(2, "Indica el nombre o la razón social (mínimo 2 caracteres).").max(160, "Máximo 160 caracteres."),
  vatNumber: z
    .string()
    .trim()
    .min(1, "Indica el NIF/CIF: aparece en todas tus facturas.")
    .superRefine((value, ctx) => {
      const problem = describeSpanishTaxIdProblem(normalizeSpanishTaxId(value));
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
  businessType: z.enum(BUSINESS_TYPES, { message: "Elige qué vendes." }),
  fiscalAddress: z.string().trim().min(3, "Indica la dirección fiscal (calle y número).").max(200, "Máximo 200 caracteres."),
  postalCode: z.string().trim().regex(/^\d{5}$/, "El código postal español tiene 5 cifras, por ejemplo 28013."),
  city: z.string().trim().min(2, "Indica la ciudad.").max(100, "Máximo 100 caracteres."),
  province: z.string().trim().min(2, "Indica la provincia.").max(100, "Máximo 100 caracteres."),
  invoicePrefix: z
    .string()
    .trim()
    .refine(isValidSeriesPrefix, "Usa de 1 a 10 letras o números, por ejemplo FA o F-."),
  iban: optionalText(42).refine((value) => !value || isValidIban(value), "El IBAN no es válido: revisa que esté completo (ES + 22 cifras)."),
  bankName: optionalText(80),
});

export type OnboardingFields = z.infer<typeof onboardingFieldsSchema>;

/** Envío parcial de un paso: cualquier subconjunto de campos, cada uno validado. */
export const onboardingStepPayloadSchema = onboardingFieldsSchema.partial();
export type OnboardingStepPayload = z.infer<typeof onboardingStepPayloadSchema>;

export const onboardingInviteSchema = z.object({
  email: z.string().trim().email("Indica un email válido, por ejemplo gestor@asesoria.es."),
  role: z.enum(["ADMIN", "MEMBER", "ACCOUNTANT", "VIEWER"]),
});

export const onboardingCompletePayloadSchema = onboardingStepPayloadSchema.extend({
  invite: onboardingInviteSchema.nullish(),
});

export type OnboardingStepKey = "company" | "address" | "billing" | "team";

/** Campos de cada paso (para validar y guardar solo lo que se ve). */
export const onboardingStepFields: Record<OnboardingStepKey, ReadonlyArray<keyof OnboardingFields>> = {
  company: ["legalName", "vatNumber", "businessType"],
  address: ["fiscalAddress", "postalCode", "city", "province"],
  billing: ["invoicePrefix", "iban", "bankName"],
  team: [],
};
