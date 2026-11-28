import { z } from "zod";

import { CORPORATE_TAX_REGIMES } from "@/server/corporate-tax/rates";

/**
 * Entradas de la API del Impuesto sobre Sociedades. Todos los importes van en CÉNTIMOS enteros
 * (12345 = 123,45 €), igual que los devuelve la API, para que el cálculo sea exacto.
 */

const MAX_CENTS = 99_999_999_999_00;
const cents = (message = "El importe no es válido.") => z.number({ message }).int(message).min(0, "El importe no puede ser negativo.").max(MAX_CENTS, "El importe es demasiado alto.");
const optionalCents = () => cents().nullable().optional();
const isoDate = (message: string) => z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, message).refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), message);

const adjustmentSchema = z.object({
  id: z.string().trim().min(1).max(80),
  kind: z.string().trim().min(1).max(60),
  concept: z.string().trim().min(1, "Indica el concepto del ajuste.").max(200, "El concepto no puede superar 200 caracteres."),
  sign: z.enum(["increase", "decrease"]),
  amountCents: cents(),
  nature: z.enum(["permanent", "temporaryOrigin", "temporaryReversal"]),
});

const creditSchema = z.object({
  id: z.string().trim().min(1).max(80),
  concept: z.string().trim().min(1, "Indica el concepto de la deducción o bonificación.").max(200, "El concepto no puede superar 200 caracteres."),
  amountCents: cents(),
});

/** Datos de la liquidación del ejercicio (modelo 200). */
export const corporateTaxReturnSchema = z.object({
  regime: z.enum(CORPORATE_TAX_REGIMES as unknown as [string, ...string[]]),
  customRatePct: z.number().min(0, "El tipo no puede ser negativo.").max(100, "El tipo no puede superar el 100 %.").nullable().optional(),
  priorYearRevenueCents: optionalCents(),
  adjustments: z.array(adjustmentSchema).max(100, "Demasiados ajustes."),
  capitalizationReserveCents: cents(),
  lossCompensationCents: optionalCents(),
  levelingReductionCents: cents(),
  levelingAdditionCents: cents(),
  credits: z.array(creditSchema).max(50, "Demasiadas deducciones."),
  withholdingsOverrideCents: optionalCents(),
  installmentsOverrideCents: optionalCents(),
  recognizeLossCredit: z.boolean().optional(),
}).refine((value) => value.regime !== "custom" || (value.customRatePct !== null && value.customRatePct !== undefined), {
  message: "Indica el tipo de gravamen.",
  path: ["customRatePct"],
});

export type CorporateTaxReturnInput = z.infer<typeof corporateTaxReturnSchema>;

export const fileCorporateTaxReturnSchema = z.object({
  receiptNumber: z.string().trim().max(40, "El número de justificante es demasiado largo.").nullable().optional(),
});

/** Base imponible negativa anterior al uso del programa. */
export const corporateTaxLossSchema = z.object({
  originYear: z.number().int().min(1990, "El ejercicio de origen no es válido.").max(2100, "El ejercicio de origen no es válido."),
  amountCents: cents().min(1, "Indica el importe pendiente de compensar."),
  notes: z.string().trim().max(300).nullable().optional(),
});

/** Cálculo de un pago fraccionado (modelo 202). `filed`: true lo marca como presentado; false lo reabre. */
export const installmentSchema = z.object({
  method: z.enum(["quota", "base"]),
  increasesCents: cents(),
  decreasesCents: cents(),
  bonusesCents: cents(),
  withholdingsCents: optionalCents(),
  lossCompensationCents: optionalCents(),
  quotaBaseCents: optionalCents(),
  filed: z.boolean().optional(),
  receiptNumber: z.string().trim().max(40, "El número de justificante es demasiado largo.").nullable().optional(),
});

export type InstallmentInput = z.infer<typeof installmentSchema>;

export const payInstallmentSchema = z.object({
  date: isoDate("La fecha del pago no es válida."),
  bankAccountId: z.string().trim().min(1).max(80).nullable().optional(),
  amountCents: cents().min(1, "El importe del pago debe ser mayor que cero.").nullable().optional(),
});

export const reminderSettingsSchema = z.object({
  relatedParties: z.boolean(),
  books: z.boolean(),
  annualAccounts: z.boolean(),
});
