import { and, eq, or } from "drizzle-orm";

import { paymentMethod } from "@/db/schema";
import type { DbClient } from "@/lib/db";

export const CASH_PAYMENT_METHOD_CODE = "EFECTIVO";

/**
 * Forma de pago «Efectivo» de la empresa (tipo CASH, sin banco): sus cobros y pagos se
 * contabilizan en caja (57000000). No crea otra si la empresa ya tiene alguna en efectivo.
 */
export async function ensureCashPaymentMethod(client: DbClient, companyId: string) {
  const [existing] = await client
    .select({ id: paymentMethod.id })
    .from(paymentMethod)
    .where(and(eq(paymentMethod.companyId, companyId), or(eq(paymentMethod.type, "CASH"), eq(paymentMethod.code, CASH_PAYMENT_METHOD_CODE))))
    .limit(1);
  if (existing) return { id: existing.id, created: false };
  const [created] = await client
    .insert(paymentMethod)
    .values({ companyId, code: CASH_PAYMENT_METHOD_CODE, name: "Efectivo", type: "CASH" })
    .returning({ id: paymentMethod.id });
  return { id: created?.id ?? null, created: true };
}
