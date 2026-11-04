import { z } from "zod";

import { ADVISOR_PASSWORD_MIN_LENGTH } from "@/lib/advisor-scopes";

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().transform((value) => (value ? value : null));
/** Fecha de caducidad (YYYY-MM-DD): el acceso vale hasta el final de ese día. */
const expiresAt = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .nullable()
  .transform((value) => (value ? new Date(`${value}T23:59:59.999Z`) : null));
const password = z.string().max(200).optional().nullable().refine((value) => !value || value.length >= ADVISOR_PASSWORD_MIN_LENGTH, `La contraseña debe tener al menos ${ADVISOR_PASSWORD_MIN_LENGTH} caracteres.`);

export const createAdvisorAccessSchema = z.object({
  name: z.string().trim().min(1, "Indica el nombre del asesor.").max(120),
  firm: optionalText(120),
  email: z.string().trim().email("Indica un email válido.").max(254),
  password,
  scopes: z.array(z.string()).max(20),
  expiresAt,
});

export const updateAdvisorAccessSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("revoke") }),
  z.object({ action: z.literal("reactivate") }),
  z.object({ action: z.literal("reset-password"), password }),
  z.object({ action: z.literal("update"), name: z.string().trim().min(1).max(120), firm: optionalText(120), scopes: z.array(z.string()).max(20), expiresAt }),
]);

export function firstIssue(error: z.ZodError) {
  return error.issues[0]?.message ?? "Revisa los datos del acceso.";
}
