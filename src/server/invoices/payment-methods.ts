import { and, eq, inArray } from "drizzle-orm";

import { invoicePaymentMethod, paymentMethod } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";

export type InvoicePaymentMethodSnapshot = {
  id: string;
  name: string;
  type: "BANK_TRANSFER" | "CARD" | "CASH" | "DIRECT_DEBIT";
  bankAccountNumber: string | null;
};

export function getRequestedPaymentMethodIds(input: {
  paymentMethodIds?: string[];
  paymentMethodId?: string;
}) {
  if (input.paymentMethodIds !== undefined) {
    return [...new Set(input.paymentMethodIds.map((id) => id.trim()).filter(Boolean))];
  }
  if (input.paymentMethodId !== undefined) {
    const legacyId = input.paymentMethodId.trim();
    return legacyId ? [legacyId] : [];
  }
  return undefined;
}

export async function resolveInvoicePaymentMethods(companyId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const configured = await db.select({
    id: paymentMethod.id,
    name: paymentMethod.name,
    type: paymentMethod.type,
    bankAccountNumber: paymentMethod.bankAccountNumber,
  }).from(paymentMethod).where(and(
    eq(paymentMethod.companyId, companyId),
    inArray(paymentMethod.id, ids),
  ));
  if (configured.length !== ids.length) return null;
  const byId = new Map(configured.map((method) => [method.id, method]));
  return ids.map((id) => byId.get(id)!);
}

export async function replaceInvoicePaymentMethods(
  dbClient: DbClient,
  invoiceId: string,
  methods: InvoicePaymentMethodSnapshot[],
) {
  await dbClient.delete(invoicePaymentMethod).where(eq(invoicePaymentMethod.invoiceId, invoiceId));
  if (methods.length === 0) return;
  await dbClient.insert(invoicePaymentMethod).values(methods.map((method, position) => ({
    invoiceId,
    paymentMethodId: method.id,
    name: method.name,
    type: method.type,
    bankAccountNumber: method.bankAccountNumber,
    position,
  })));
}
