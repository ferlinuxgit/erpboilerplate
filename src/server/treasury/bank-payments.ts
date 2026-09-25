import { and, asc, eq, sql } from "drizzle-orm";

import { invoice, invoicePayment, payment, paymentMethod, supplierInvoice, supplierInvoicePayment, supplierPayment } from "@/db/schema";
import type { DbClient } from "@/lib/db";
import { postCustomerPayment, postSupplierPayment, reverseAutomaticEntries } from "@/server/accounting/auto-post";
import { AccountingRuleError } from "@/server/accounting/errors";
import { toCents } from "@/server/accounting/money";
import { recordAudit } from "@/server/audit";
import { reserveSeriesNumber } from "@/server/documents/series";
import { assertFiscalPeriodOpen } from "@/server/fiscal/locks";
import { invoiceLifecycle } from "@/server/invoices/lifecycle";
import { getInvoiceBalance, refreshInvoicePaymentStatus } from "@/server/invoices/service";
import { refreshSupplierInvoicePaymentStatus } from "@/server/supplier-invoices/service";

/*
 * Cobros y pagos creados desde tesorería (mesa de conciliación y remesas SEPA), dentro de la
 * transacción de quien llama para que un reparto entre varias facturas sea atómico.
 *
 * Aplican las mismas reglas que `registerInvoicePayment` (src/server/invoices/payments.ts) y que
 * la ruta /api/supplier-payments: factura emitida y no anulada, sin superar el pendiente, periodo
 * fiscal abierto, número de la serie RECEIPT/PAYMENT del ejercicio de la fecha y asiento
 * Banco ↔ 430/400 en la subcuenta del banco del movimiento (así la reversión del apunte 555 del
 * movimiento deja un único efecto en el banco correcto).
 */

export type TreasuryActor = { companyId: string; tenantId: string; actorUserId: string; activeFiscalYearId: string };

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

export async function createCustomerPaymentForBank(
  client: DbClient,
  actor: TreasuryActor,
  input: { invoiceId: string; amount: number; postedAt: Date; bankAccountId: string; paymentMethodId?: string | null; reference?: string },
) {
  const [owned] = await client
    .select({ id: invoice.id, number: invoice.number, totalAmount: invoice.totalAmount, status: invoice.status, issuedAt: invoice.issuedAt, invoiceType: invoice.invoiceType })
    .from(invoice)
    .where(and(eq(invoice.id, input.invoiceId), eq(invoice.companyId, actor.companyId)))
    .for("update")
    .limit(1);
  if (!owned) throw new AccountingRuleError(404, "INVOICE_NOT_FOUND", "Factura no encontrada.");
  const lifecycle = invoiceLifecycle(owned);
  if (lifecycle === "VOID") throw new AccountingRuleError(409, "INVOICE_VOID", `La factura ${owned.number} está anulada.`);
  if (lifecycle === "DRAFT") throw new AccountingRuleError(409, "INVOICE_DRAFT", `La factura ${owned.number} es un borrador: emítela antes de cobrarla.`);
  if (owned.invoiceType === "CREDIT_NOTE") throw new AccountingRuleError(409, "INVOICE_CREDIT_NOTE", "Una factura rectificativa no se cobra: se aplica a la factura original.");
  await assertFiscalPeriodOpen(actor.companyId, input.postedAt, client);

  const amountCents = toCents(input.amount);
  if (amountCents <= 0) throw new AccountingRuleError(422, "AMOUNT_INVALID", "El importe cobrado debe ser mayor que 0.");
  const balance = await getInvoiceBalance(client, actor.companyId, owned.id, owned.totalAmount);
  if (amountCents > balance.outstandingCents) {
    throw new AccountingRuleError(422, "OVERPAYMENT", `El importe supera lo pendiente de la factura ${owned.number} (${(balance.outstandingCents / 100).toFixed(2)}).`);
  }

  const methodId = input.paymentMethodId ?? (await paymentMethodForBankAccount(client, actor.companyId, input.bankAccountId));
  const number = await reserveSeriesNumber(client, {
    companyId: actor.companyId,
    fiscalYearId: actor.activeFiscalYearId,
    type: "RECEIPT",
    referenceDate: input.postedAt,
  });
  const amount = (amountCents / 100).toFixed(2);
  const [created] = await client
    .insert(payment)
    .values({ companyId: actor.companyId, number, invoiceId: owned.id, paymentMethodId: methodId, amount, postedAt: input.postedAt })
    .returning({ id: payment.id, number: payment.number });
  const [applied] = await client
    .insert(invoicePayment)
    .values({ companyId: actor.companyId, invoiceId: owned.id, paymentId: created.id, amountApplied: amount })
    .returning({ id: invoicePayment.id });
  await refreshInvoicePaymentStatus(client, actor.companyId, owned.id);
  await postCustomerPayment({
    tenantId: actor.tenantId,
    companyId: actor.companyId,
    actorUserId: actor.actorUserId,
    paymentId: created.id,
    postedAt: input.postedAt,
    reference: (input.reference ?? `Cobro factura ${owned.number}`).slice(0, 200),
    amount: amountCents / 100,
    // La subcuenta del banco del movimiento manda (aunque la forma de pago apunte a otro banco).
    bankAccountId: input.bankAccountId,
    paymentMethodId: methodId,
    dbClient: client,
  });
  await recordAudit({
    tenantId: actor.tenantId,
    companyId: actor.companyId,
    actorUserId: actor.actorUserId,
    action: "invoice.payment.create",
    entityName: "invoice",
    entityId: owned.id,
    payload: { paymentId: created.id, number, amount, postedAt: input.postedAt.toISOString(), bankAccountId: input.bankAccountId, origin: "treasury" },
  }, client);
  return { paymentId: created.id, applicationId: applied.id, number, invoiceNumber: owned.number };
}

export async function createSupplierPaymentForBank(
  client: DbClient,
  actor: TreasuryActor,
  input: { supplierInvoiceId: string; amount: number; postedAt: Date; bankAccountId: string; paymentMethodId?: string | null; reference?: string; notes?: string },
) {
  const [owned] = await client
    .select({ id: supplierInvoice.id, number: supplierInvoice.number, supplierPartnerId: supplierInvoice.supplierPartnerId, totalAmount: supplierInvoice.totalAmount, status: supplierInvoice.status })
    .from(supplierInvoice)
    .where(and(eq(supplierInvoice.id, input.supplierInvoiceId), eq(supplierInvoice.companyId, actor.companyId)))
    .for("update")
    .limit(1);
  if (!owned) throw new AccountingRuleError(404, "SUPPLIER_INVOICE_NOT_FOUND", "Factura de proveedor no encontrada.");
  if (owned.status === "VOID") throw new AccountingRuleError(409, "SUPPLIER_INVOICE_VOID", `La factura ${owned.number} está anulada.`);
  await assertFiscalPeriodOpen(actor.companyId, input.postedAt, client);

  const amountCents = toCents(input.amount);
  if (amountCents <= 0) throw new AccountingRuleError(422, "AMOUNT_INVALID", "El importe pagado debe ser mayor que 0.");
  const [paid] = await client
    .select({ amount: sql<string>`coalesce(sum(${supplierInvoicePayment.amountApplied}), 0)` })
    .from(supplierInvoicePayment)
    .where(and(eq(supplierInvoicePayment.companyId, actor.companyId), eq(supplierInvoicePayment.supplierInvoiceId, owned.id)));
  const outstandingCents = Math.max(toCents(owned.totalAmount) - toCents(paid?.amount ?? 0), 0);
  if (amountCents > outstandingCents) {
    throw new AccountingRuleError(422, "OVERPAYMENT", `El importe supera lo pendiente de la factura ${owned.number} (${(outstandingCents / 100).toFixed(2)}).`);
  }

  const methodId = input.paymentMethodId ?? (await paymentMethodForBankAccount(client, actor.companyId, input.bankAccountId));
  const number = await reserveSeriesNumber(client, {
    companyId: actor.companyId,
    fiscalYearId: actor.activeFiscalYearId,
    type: "PAYMENT",
    referenceDate: input.postedAt,
  });
  const amount = (amountCents / 100).toFixed(2);
  const [created] = await client
    .insert(supplierPayment)
    .values({
      companyId: actor.companyId,
      number,
      supplierPartnerId: owned.supplierPartnerId,
      supplierInvoiceId: owned.id,
      paymentMethodId: methodId,
      bankAccountId: input.bankAccountId,
      reference: input.reference?.slice(0, 160) ?? null,
      notes: input.notes ?? null,
      amount,
      postedAt: input.postedAt,
    })
    .returning({ id: supplierPayment.id, number: supplierPayment.number });
  const [applied] = await client
    .insert(supplierInvoicePayment)
    .values({ companyId: actor.companyId, supplierInvoiceId: owned.id, supplierPaymentId: created.id, amountApplied: amount })
    .returning({ id: supplierInvoicePayment.id });
  await postSupplierPayment({
    tenantId: actor.tenantId,
    companyId: actor.companyId,
    actorUserId: actor.actorUserId,
    supplierPaymentId: created.id,
    postedAt: input.postedAt,
    reference: (input.reference ?? `Pago factura proveedor ${owned.number}`).slice(0, 200),
    amount: amountCents / 100,
    bankAccountId: input.bankAccountId,
    paymentMethodId: methodId,
    dbClient: client,
  });
  await refreshSupplierInvoicePaymentStatus(actor.companyId, owned.id, client);
  await recordAudit({
    tenantId: actor.tenantId,
    companyId: actor.companyId,
    actorUserId: actor.actorUserId,
    action: "supplier_payment.create",
    entityName: "supplier_payment",
    entityId: created.id,
    payload: { number, supplierInvoiceId: owned.id, amount, bankAccountId: input.bankAccountId, origin: "treasury" },
  }, client);
  return { paymentId: created.id, applicationId: applied.id, number, invoiceNumber: owned.number };
}

/**
 * Elimina un cobro creado desde tesorería (deshacer): revierte su asiento, borra el cobro y
 * recalcula el estado de la factura. Exige el periodo del cobro abierto.
 */
export async function removeTreasuryCustomerPayment(client: DbClient, actor: Omit<TreasuryActor, "activeFiscalYearId">, paymentId: string) {
  const [row] = await client
    .select({ id: payment.id, invoiceId: payment.invoiceId, number: payment.number, postedAt: payment.postedAt, amount: payment.amount })
    .from(payment)
    .where(and(eq(payment.id, paymentId), eq(payment.companyId, actor.companyId)))
    .for("update")
    .limit(1);
  if (!row) return false;
  await assertFiscalPeriodOpen(actor.companyId, row.postedAt, client);
  await reverseAutomaticEntries({
    tenantId: actor.tenantId,
    companyId: actor.companyId,
    actorUserId: actor.actorUserId,
    postedAt: row.postedAt,
    reference: `Anulación cobro ${row.number}`,
    sourceType: "payment",
    sourceId: row.id,
    reason: `Cobro ${row.number} deshecho desde conciliación bancaria`,
    dbClient: client,
  });
  await client.delete(payment).where(and(eq(payment.id, row.id), eq(payment.companyId, actor.companyId)));
  await refreshInvoicePaymentStatus(client, actor.companyId, row.invoiceId);
  await recordAudit({
    tenantId: actor.tenantId,
    companyId: actor.companyId,
    actorUserId: actor.actorUserId,
    action: "invoice.payment.delete",
    entityName: "invoice",
    entityId: row.invoiceId,
    payload: { paymentId: row.id, number: row.number, amount: row.amount, origin: "treasury.undo" },
  }, client);
  return true;
}

export async function removeTreasurySupplierPayment(client: DbClient, actor: Omit<TreasuryActor, "activeFiscalYearId">, supplierPaymentId: string) {
  const [row] = await client
    .select({ id: supplierPayment.id, supplierInvoiceId: supplierPayment.supplierInvoiceId, number: supplierPayment.number, postedAt: supplierPayment.postedAt, amount: supplierPayment.amount })
    .from(supplierPayment)
    .where(and(eq(supplierPayment.id, supplierPaymentId), eq(supplierPayment.companyId, actor.companyId)))
    .for("update")
    .limit(1);
  if (!row) return false;
  await assertFiscalPeriodOpen(actor.companyId, row.postedAt, client);
  await reverseAutomaticEntries({
    tenantId: actor.tenantId,
    companyId: actor.companyId,
    actorUserId: actor.actorUserId,
    postedAt: row.postedAt,
    reference: `Anulación pago ${row.number}`,
    sourceType: "supplierPayment",
    sourceId: row.id,
    reason: `Pago ${row.number} deshecho desde tesorería`,
    dbClient: client,
  });
  await client.delete(supplierPayment).where(and(eq(supplierPayment.id, row.id), eq(supplierPayment.companyId, actor.companyId)));
  if (row.supplierInvoiceId) await refreshSupplierInvoicePaymentStatus(actor.companyId, row.supplierInvoiceId, client);
  await recordAudit({
    tenantId: actor.tenantId,
    companyId: actor.companyId,
    actorUserId: actor.actorUserId,
    action: "supplier_payment.delete",
    entityName: "supplier_payment",
    entityId: row.id,
    payload: { number: row.number, amount: row.amount, origin: "treasury.undo" },
  }, client);
  return true;
}
