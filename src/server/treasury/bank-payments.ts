import type { DbClient } from "@/lib/db";
import { registerInvoicePayment, removeInvoicePayment } from "@/server/invoices/payments";
import { registerSupplierPayment, removeSupplierPayment } from "@/server/supplier-payments/service";

export { paymentMethodForBankAccount } from "@/server/treasury/payment-methods";

/*
 * Cobros y pagos creados desde tesorería (mesa de conciliación y remesas SEPA), dentro de la
 * transacción de quien llama para que un reparto entre varias facturas sea atómico.
 *
 * No duplican reglas: delegan en `registerInvoicePayment` (src/server/invoices/payments.ts) y en
 * `registerSupplierPayment` (src/server/supplier-payments/service.ts), que son la única fuente de
 * verdad. Aquí solo se fija el banco del movimiento como subcuenta del asiento (así la reversión
 * del apunte 555 deja un único efecto en el banco correcto) y la forma de pago de ese banco.
 */

export type TreasuryActor = { companyId: string; tenantId: string; actorUserId: string; activeFiscalYearId: string };

export async function createCustomerPaymentForBank(
  client: DbClient,
  actor: TreasuryActor,
  input: { invoiceId: string; amount: number; postedAt: Date; bankAccountId: string; paymentMethodId?: string | null; reference?: string; origin?: "treasury" | "sepa" },
) {
  const result = await registerInvoicePayment(actor, {
    invoiceId: input.invoiceId,
    amountApplied: input.amount,
    postedAt: input.postedAt,
    bankAccountId: input.bankAccountId,
    paymentMethodId: input.paymentMethodId ?? null,
    reference: input.reference,
    origin: input.origin ?? "treasury",
  }, client);
  return { paymentId: result.payment.id, applicationId: result.application.id, number: result.payment.number, invoiceNumber: result.invoiceNumber };
}

export async function createSupplierPaymentForBank(
  client: DbClient,
  actor: TreasuryActor,
  input: { supplierInvoiceId: string; amount: number; postedAt: Date; bankAccountId: string; paymentMethodId?: string | null; reference?: string; notes?: string; origin?: "treasury" | "sepa" },
) {
  const result = await registerSupplierPayment(actor, {
    supplierInvoiceId: input.supplierInvoiceId,
    amountApplied: input.amount,
    postedAt: input.postedAt,
    bankAccountId: input.bankAccountId,
    paymentMethodId: input.paymentMethodId ?? null,
    reference: input.reference ?? null,
    notes: input.notes ?? null,
    origin: input.origin ?? "treasury",
  }, client);
  if (!result.application) throw new Error("Pago de tesorería sin factura aplicada.");
  return { paymentId: result.payment.id, applicationId: result.application.id, number: result.payment.number, invoiceNumber: result.invoiceNumber ?? "" };
}

/** Deshacer un cobro creado desde tesorería (ver `removeInvoicePayment`). */
export function removeTreasuryCustomerPayment(client: DbClient, actor: Omit<TreasuryActor, "activeFiscalYearId">, paymentId: string, options?: { reason?: string; origin?: string }) {
  return removeInvoicePayment(actor, paymentId, options, client);
}

/** Deshacer un pago creado desde tesorería (ver `removeSupplierPayment`). */
export function removeTreasurySupplierPayment(client: DbClient, actor: Omit<TreasuryActor, "activeFiscalYearId">, supplierPaymentId: string, options?: { reason?: string; origin?: string }) {
  return removeSupplierPayment(actor, supplierPaymentId, options, client);
}
