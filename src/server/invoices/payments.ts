import { and, eq } from "drizzle-orm";

import { invoice, invoicePayment, payment, paymentMethod } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { postCustomerPayment, reverseAutomaticEntries } from "@/server/accounting/auto-post";
import { AccountingRuleError } from "@/server/accounting/errors";
import { toCents } from "@/server/accounting/money";
import { recordAudit } from "@/server/audit";
import { reserveSeriesNumber } from "@/server/documents/series";
import { assertFiscalPeriodOpen } from "@/server/fiscal/locks";
import { invoiceLifecycle } from "@/server/invoices/lifecycle";
import { getInvoiceBalance, refreshInvoicePaymentStatus } from "@/server/invoices/service";
import { paymentMethodForBankAccount } from "@/server/treasury/payment-methods";
import { reconcileBankTransaction } from "@/server/treasury/reconciliation";

export type PaymentActor = { tenantId: string; companyId: string; actorUserId: string; activeFiscalYearId: string };

/** De dónde nace el cobro (solo para la auditoría y la referencia contable). */
export type PaymentOrigin = "manual" | "treasury" | "sepa";

export type RegisterInvoicePaymentInput = {
  invoiceId: string;
  amountApplied: number;
  postedAt: Date;
  /** Obligatoria salvo que se indique `bankAccountId` (entonces se usa la forma de pago de ese banco). */
  paymentMethodId?: string | null;
  /** Movimiento bancario del que nace el cobro: se concilia en la misma operación. */
  bankTransactionId?: string;
  /** Banco real del cobro (movimiento o remesa): manda sobre el de la forma de pago en el asiento. */
  bankAccountId?: string | null;
  reference?: string;
  origin?: PaymentOrigin;
};

/** Ejecuta `work` en la transacción recibida o abre una nueva. */
export function withTransaction<T>(client: DbClient | undefined, work: (tx: DbClient) => Promise<T>): Promise<T> {
  return client ? work(client) : db.transaction((tx) => work(tx));
}

/**
 * Registra un cobro de una factura emitida (única fuente de verdad: API de cobros, mesa de
 * conciliación y remesas de adeudos SEPA): valida el saldo pendiente (total − rectificativas −
 * cobros previos), numera el recibo con la serie del ejercicio de la fecha de cobro, contabiliza
 * (banco a 430), concilia el movimiento bancario si viene de uno y audita.
 *
 * Con `client` se ejecuta dentro de la transacción de quien llama (p. ej. un reparto entre varias
 * facturas); sin él abre la suya.
 */
export async function registerInvoicePayment(actor: PaymentActor, input: RegisterInvoicePaymentInput, client?: DbClient) {
  return withTransaction(client, async (tx) => {
    const [ownedInvoice] = await tx
      .select({
        id: invoice.id,
        number: invoice.number,
        totalAmount: invoice.totalAmount,
        status: invoice.status,
        issuedAt: invoice.issuedAt,
        invoiceType: invoice.invoiceType,
      })
      .from(invoice)
      .where(and(eq(invoice.id, input.invoiceId), eq(invoice.companyId, actor.companyId)))
      .for("update")
      .limit(1);
    if (!ownedInvoice) throw new AccountingRuleError(404, "INVOICE_NOT_FOUND", "Factura no encontrada.");
    const lifecycle = invoiceLifecycle(ownedInvoice);
    if (lifecycle === "VOID") throw new AccountingRuleError(409, "INVOICE_VOID", `No se puede cobrar la factura ${ownedInvoice.number}: está anulada.`);
    if (lifecycle === "DRAFT") throw new AccountingRuleError(409, "INVOICE_DRAFT", "La factura es un borrador: emítela antes de registrar cobros.");
    if (ownedInvoice.invoiceType === "CREDIT_NOTE") throw new AccountingRuleError(409, "INVOICE_CREDIT_NOTE", "Una factura rectificativa no se cobra: se aplica a la factura original.");
    await assertFiscalPeriodOpen(actor.companyId, input.postedAt, tx);

    let methodId: string | null = null;
    if (input.paymentMethodId) {
      const [ownedPaymentMethod] = await tx
        .select({ id: paymentMethod.id })
        .from(paymentMethod)
        .where(and(eq(paymentMethod.id, input.paymentMethodId), eq(paymentMethod.companyId, actor.companyId)))
        .limit(1);
      if (!ownedPaymentMethod) throw new AccountingRuleError(404, "PAYMENT_METHOD_NOT_FOUND", "Forma de pago no encontrada.");
      methodId = ownedPaymentMethod.id;
    } else if (input.bankAccountId) {
      methodId = await paymentMethodForBankAccount(tx, actor.companyId, input.bankAccountId);
    } else {
      throw new AccountingRuleError(400, "PAYMENT_METHOD_REQUIRED", "Indica la forma de pago del cobro.");
    }

    const amountCents = toCents(input.amountApplied);
    if (amountCents <= 0) throw new AccountingRuleError(400, "AMOUNT_INVALID", "El importe cobrado debe ser mayor que 0.");
    const balance = await getInvoiceBalance(tx, actor.companyId, ownedInvoice.id, ownedInvoice.totalAmount);
    if (amountCents > balance.outstandingCents) {
      throw new AccountingRuleError(400, "OVERPAYMENT", `El importe supera el saldo pendiente de la factura ${ownedInvoice.number} (${(balance.outstandingCents / 100).toFixed(2)}).`);
    }

    const number = await reserveSeriesNumber(tx, {
      companyId: actor.companyId,
      fiscalYearId: actor.activeFiscalYearId,
      type: "RECEIPT",
      referenceDate: input.postedAt,
    });
    const amount = (amountCents / 100).toFixed(2);
    const [createdPayment] = await tx
      .insert(payment)
      .values({
        companyId: actor.companyId,
        number,
        invoiceId: ownedInvoice.id,
        paymentMethodId: methodId,
        amount,
        postedAt: input.postedAt,
      })
      .returning();
    const [appliedPayment] = await tx
      .insert(invoicePayment)
      .values({ companyId: actor.companyId, invoiceId: ownedInvoice.id, paymentId: createdPayment.id, amountApplied: amount })
      .returning();

    await refreshInvoicePaymentStatus(tx, actor.companyId, ownedInvoice.id);

    await postCustomerPayment({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      paymentId: createdPayment.id,
      postedAt: input.postedAt,
      reference: (input.reference ?? `Cobro factura ${ownedInvoice.number}`).slice(0, 200),
      amount: amountCents / 100,
      paymentMethodId: methodId,
      // La subcuenta del banco del movimiento/remesa manda (aunque la forma de pago apunte a otro banco).
      ...(input.bankAccountId ? { bankAccountId: input.bankAccountId } : {}),
      dbClient: tx,
    });

    if (input.bankTransactionId) {
      await reconcileBankTransaction(tx, {
        companyId: actor.companyId,
        tenantId: actor.tenantId,
        actorUserId: actor.actorUserId,
        transactionId: input.bankTransactionId,
        kind: "customer",
        matchId: appliedPayment.id,
      });
    }

    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "invoice.payment.create",
      entityName: "invoice",
      entityId: ownedInvoice.id,
      payload: {
        paymentId: createdPayment.id,
        number,
        amount,
        postedAt: input.postedAt.toISOString(),
        bankTransactionId: input.bankTransactionId ?? null,
        bankAccountId: input.bankAccountId ?? null,
        origin: input.origin ?? "manual",
      },
    }, tx);

    return { payment: createdPayment, application: appliedPayment, invoiceNumber: ownedInvoice.number };
  });
}

/**
 * Elimina un cobro (deshacer desde tesorería, remesa devuelta…): revierte su asiento, lo borra y
 * recalcula el estado de cobro de la factura (vuelve a pendiente/parcial). Exige el periodo del
 * cobro abierto. Devuelve false si el cobro no existe.
 */
export async function removeInvoicePayment(
  actor: Omit<PaymentActor, "activeFiscalYearId">,
  paymentId: string,
  options: { reason?: string; origin?: string; postedAt?: Date } = {},
  client?: DbClient,
) {
  return withTransaction(client, async (tx) => {
    const [row] = await tx
      .select({ id: payment.id, invoiceId: payment.invoiceId, number: payment.number, postedAt: payment.postedAt, amount: payment.amount })
      .from(payment)
      .where(and(eq(payment.id, paymentId), eq(payment.companyId, actor.companyId)))
      .for("update")
      .limit(1);
    if (!row) return false;
    // Por defecto la anulación va en la fecha del cobro; una devolución va en la suya.
    const reversalDate = options.postedAt ?? row.postedAt;
    await assertFiscalPeriodOpen(actor.companyId, reversalDate, tx);
    await reverseAutomaticEntries({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      postedAt: reversalDate,
      reference: `Anulación cobro ${row.number}`,
      sourceType: "payment",
      sourceId: row.id,
      reason: options.reason ?? `Cobro ${row.number} deshecho desde conciliación bancaria`,
      dbClient: tx,
    });
    await tx.delete(payment).where(and(eq(payment.id, row.id), eq(payment.companyId, actor.companyId)));
    await refreshInvoicePaymentStatus(tx, actor.companyId, row.invoiceId);
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "invoice.payment.delete",
      entityName: "invoice",
      entityId: row.invoiceId,
      payload: { paymentId: row.id, number: row.number, amount: row.amount, origin: options.origin ?? "treasury.undo" },
    }, tx);
    return true;
  });
}
