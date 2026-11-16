import { z } from "zod";

import { BUSINESS_TYPES, isValidIban, isValidSeriesPrefix } from "@/lib/company-readiness";
import { isCountryCode } from "@/lib/countries";
import { getCountryFiscalProfile } from "@/lib/country-packs/profile";
import { describeTaxIdProblemForCountry } from "@/lib/country-packs/tax-id";

/**
 * Validación del asistente de puesta en marcha, compartida por el formulario y la API.
 * La API acepta envíos parciales (cada paso guarda lo suyo); el formulario exige en
 * cada paso los campos obligatorios de ese paso.
 */

const optionalText = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres.`);

/**
 * Campos del asistente para una empresa del país indicado: el NIF se valida con el algoritmo
 * español solo en España, y el código postal y la provincia solo son obligatorios en España.
 */
export function onboardingFieldsSchemaFor(countryCode: string | null | undefined) {
  const profile = getCountryFiscalProfile(countryCode);
  const spain = profile.features.nationalTaxIdValidation === "es";
  return z.object({
    legalName: z.string().trim().min(2, "Indica el nombre o la razón social (mínimo 2 caracteres).").max(160, "Máximo 160 caracteres."),
    countryCode: z.string().trim().toUpperCase().refine(isCountryCode, "Elige el país de la empresa."),
    vatNumber: z
      .string()
      .trim()
      .min(1, `Indica el ${spain ? "NIF/CIF" : profile.taxIdLabel}: aparece en todas tus facturas.`)
      .superRefine((value, ctx) => {
        const problem = describeTaxIdProblemForCountry(value, profile.countryCode);
        if (problem) ctx.addIssue({ code: "custom", message: problem });
      }),
    businessType: z.enum(BUSINESS_TYPES, { message: "Elige qué vendes." }),
    fiscalAddress: z.string().trim().min(3, "Indica la dirección fiscal (calle y número).").max(200, "Máximo 200 caracteres."),
    postalCode: spain
      ? z.string().trim().regex(/^\d{5}$/, "El código postal español tiene 5 cifras, por ejemplo 28013.")
      : z.string().trim().min(2, "Indica el código postal.").max(12, "Máximo 12 caracteres."),
    city: z.string().trim().min(2, "Indica la ciudad.").max(100, "Máximo 100 caracteres."),
    province: spain
      ? z.string().trim().min(2, "Indica la provincia.").max(100, "Máximo 100 caracteres.")
      : z.string().trim().max(100, "Máximo 100 caracteres."),
    invoicePrefix: z
      .string()
      .trim()
      .refine(isValidSeriesPrefix, "Usa de 1 a 10 letras o números, por ejemplo FA o F-."),
    iban: optionalText(42).refine((value) => !value || isValidIban(value), "El IBAN no es válido: revisa que esté completo (ES + 22 cifras)."),
    bankName: optionalText(80),
  });
}

/** Campos del asistente para una empresa española (el caso por defecto). */
export const onboardingFieldsSchema = onboardingFieldsSchemaFor("ES");

export type OnboardingFields = z.infer<typeof onboardingFieldsSchema>;

/** Envío parcial de un paso: cualquier subconjunto de campos, cada uno validado. */
export const onboardingStepPayloadSchema = onboardingFieldsSchema.partial();
export type OnboardingStepPayload = z.infer<typeof onboardingStepPayloadSchema>;

/** Igual que `onboardingStepPayloadSchema`, validando según el país enviado o el actual de la empresa. */
export function onboardingStepPayloadSchemaFor(currentCountryCode: string | null | undefined, payload: unknown) {
  const sent = payload && typeof payload === "object" ? (payload as { countryCode?: unknown }).countryCode : undefined;
  const country = typeof sent === "string" && isCountryCode(sent) ? sent : currentCountryCode;
  return onboardingFieldsSchemaFor(country).partial();
}

export function onboardingCompletePayloadSchemaFor(currentCountryCode: string | null | undefined, payload: unknown) {
  return onboardingStepPayloadSchemaFor(currentCountryCode, payload).extend({ invite: onboardingInviteSchema.nullish() });
}

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
  company: ["legalName", "countryCode", "vatNumber", "businessType"],
  address: ["fiscalAddress", "postalCode", "city", "province"],
  billing: ["invoicePrefix", "iban", "bankName"],
  team: [],
};
