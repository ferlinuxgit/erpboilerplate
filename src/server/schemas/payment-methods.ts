import { z } from "zod";

export const paymentMethodPayloadSchema = z.object({
  code: z.string().trim().min(1, "El código es obligatorio.").max(80, "El código es demasiado largo."),
  name: z.string().trim().min(1, "El nombre es obligatorio.").max(160, "El nombre es demasiado largo."),
  type: z.enum(["BANK_TRANSFER", "CARD", "CASH", "DIRECT_DEBIT"]),
  bankAccountId: z.string().trim().optional().nullable().or(z.literal("")),
  bankAccountNumber: z.string().trim().max(80, "El número de cuenta es demasiado largo.").optional().nullable(),
  isDefault: z.boolean().default(false),
});

export type PaymentMethodPayload = z.infer<typeof paymentMethodPayloadSchema>;
