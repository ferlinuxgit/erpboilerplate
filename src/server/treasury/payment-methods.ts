import { and, asc, eq, sql } from "drizzle-orm";

import { bankAccount, paymentMethod } from "@/db/schema";
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

export type PaymentMethodAccount = { id: string; kind: "BANK" | "PAYMENT_PROVIDER"; iban: string | null };

/**
 * Cuenta de tesorería de una forma de pago: una transferencia o domiciliación va a un banco; una
 * tarjeta u otra forma, a un banco o a una pasarela (Stripe…); el efectivo, a ninguna (caja).
 * Devuelve `{ account: null }` si no se eligió cuenta y `{ error }` si la elegida no vale.
 */
export async function resolvePaymentMethodAccount(
  client: DbClient,
  companyId: string,
  input: { type: string; bankAccountId?: string | null },
): Promise<{ account: PaymentMethodAccount | null; error?: string }> {
  const selected = input.type === "CASH" ? null : input.bankAccountId?.trim() || null;
  if (!selected) return { account: null };
  const [account] = await client
    .select({ id: bankAccount.id, kind: bankAccount.kind, iban: bankAccount.iban })
    .from(bankAccount)
    .where(and(eq(bankAccount.id, selected), eq(bankAccount.companyId, companyId)))
    .limit(1);
  if (!account) return { account: null, error: "La cuenta seleccionada no pertenece a la empresa." };
  if ((input.type === "BANK_TRANSFER" || input.type === "DIRECT_DEBIT") && account.kind !== "BANK") {
    return { account: null, error: "Una transferencia o domiciliación necesita una cuenta bancaria, no una pasarela de pago." };
  }
  return { account };
}

/**
 * Formas de pago para registrar un cobro, con el nombre de la pasarela (Stripe…) si cobran en una:
 * el diálogo de cobro avisa de que se registra por el total y la comisión va aparte.
 */
export async function listPaymentMethodsForCollection(client: DbClient, companyId: string) {
  return client
    .select({
      id: paymentMethod.id,
      name: paymentMethod.name,
      providerName: sql<string | null>`case when ${bankAccount.kind} = 'PAYMENT_PROVIDER' then ${bankAccount.bankName} end`,
    })
    .from(paymentMethod)
    .leftJoin(bankAccount, eq(bankAccount.id, paymentMethod.bankAccountId))
    .where(eq(paymentMethod.companyId, companyId))
    .orderBy(paymentMethod.name);
}
