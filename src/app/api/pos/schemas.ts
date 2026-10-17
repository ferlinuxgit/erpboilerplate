import { z } from "zod";

const amount = z.number().min(0).max(999_999_999);

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Pon un nombre a la caja (p. ej. «Mostrador»).").max(60),
  seriesCode: z.string().trim().min(1).max(10).default("T"),
  seriesPrefix: z.string().trim().min(1, "Indica el prefijo de los tickets.").max(12).default("T"),
  warehouseId: z.string().trim().nullable().optional(),
  cardBankAccountId: z.string().trim().nullable().optional(),
  simplifiedLimit: z.number().min(0).max(3000, "El límite de la factura simplificada no puede superar 3.000 €.").default(400),
  isActive: z.boolean().optional(),
});

export const openSchema = z.object({ openingCash: amount });

export const saleSchema = z.object({
  registerId: z.string().trim().min(1),
  clientRequestId: z.string().trim().min(8).max(80),
  customerId: z.string().trim().nullable().optional(),
  lines: z.array(z.object({
    itemId: z.string().trim().nullable().optional(),
    description: z.string().trim().min(1).max(300),
    quantity: z.number().positive().max(100_000),
    unitPrice: amount,
    taxRate: z.number().min(0).max(100),
    taxId: z.string().trim().nullable().optional(),
  })).min(1, "El ticket está vacío.").max(300),
  payment: z.object({ cash: amount, card: amount, cashReceived: amount.nullable().optional() }),
});

export const refundSchema = z.object({
  registerId: z.string().trim().min(1),
  clientRequestId: z.string().trim().min(8).max(80),
  reason: z.string().trim().max(300).nullable().optional(),
  method: z.enum(["cash", "card"]).optional(),
  // Sin líneas: se devuelve todo lo que quede del ticket.
  lines: z.array(z.object({ lineId: z.string().trim().min(1), quantity: z.number().positive() })).max(300).optional(),
});

export const movementSchema = z.object({ type: z.enum(["IN", "OUT"]), amount: z.number().positive().max(999_999_999), reason: z.string().trim().min(2, "Indica el motivo.").max(200) });

export const closeSchema = z.object({ countedCash: amount, notes: z.string().trim().max(1000).nullable().optional() });

export function firstIssue(error: z.ZodError) {
  return error.issues[0]?.message ?? "Datos inválidos.";
}
