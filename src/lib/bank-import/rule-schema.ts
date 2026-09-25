import { z } from "zod";

/** Datos de una regla de conciliación (API). Importes sin signo; el sentido va en `direction`. */
export const rulePayloadSchema = z.object({
  name: z.string().trim().max(120).nullable().optional(),
  conceptContains: z.string().trim().min(3, "Indica al menos 3 letras del concepto.").max(120),
  direction: z.enum(["ANY", "IN", "OUT"]).optional(),
  minAmount: z.number().nonnegative().nullable().optional(),
  maxAmount: z.number().nonnegative().nullable().optional(),
  accountId: z.string().trim().min(1).nullable().optional(),
  partnerId: z.string().trim().min(1).nullable().optional(),
  autoApply: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
