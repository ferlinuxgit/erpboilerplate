import { and, asc, eq, sql } from "drizzle-orm";

import { paymentMethod } from "@/db/schema";
import type { DbClient } from "@/lib/db";

/**
 * Forma de pago "Transferencia · Banco" vinculada a la cuenta bancaria (la que se crea con la
 * cuenta); si no hay, cualquier forma de pago de esa cuenta. Null si ninguna.
 */
export async function paymentMethodForBankAccount(client: DbClient, companyId: string, bankAccountId: string) {
  const [method] = await client
    .select({ id: paymentMethod.id })
    .from(paymentMethod)
    .where(and(eq(paymentMethod.companyId, companyId), eq(paymentMethod.bankAccountId, bankAccountId)))
    .orderBy(sql`case when ${paymentMethod.code} = ${`AUTO-BANK-${bankAccountId}`} then 0 else 1 end`, asc(paymentMethod.name))
    .limit(1);
  return method?.id ?? null;
}
