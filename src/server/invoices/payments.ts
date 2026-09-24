import { and, eq } from "drizzle-orm";

import { invoice, invoicePayment, payment, paymentMethod } from "@/db/schema";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { postCustomerPayment } from "@/server/accounting/auto-post";
import { toCents } from "@/server/accounting/money";
import { recordAudit } from "@/server/audit";
import { reserveSeriesNumber } from "@/server/documents/series";
import { assertFiscalPeriodOpen } from "@/server/fiscal/locks";
import { invoiceLifecycle } from "@/server/invoices/lifecycle";
import { getInvoiceBalance, refreshInvoicePaymentStatus } from "@/server/invoices/service";
import { reconcileBankTransaction } from "@/server/treasury/reconciliation";

export type RegisterInvoicePaymentInput = {
  invoiceId: string;
  amountApplied: number;
  postedAt: Date;
  paymentMethodId: string;
  bankTransactionId?: string;
};

/**
 * Registra un cobro de una factura emitida: valida el saldo pendiente (total − rectificativas −
 * cobros previos), numera el recibo con la serie del ejercicio de la fecha de cobro, contabiliza
 * (banco a 430), concilia el movimiento bancario si viene de uno y audita, todo en una transacción.
 */
export async function registerInvoicePayment(
  actor: { tenantId: string; companyId: string; actorUserId: string; activeFiscalYearId: string },
  input: RegisterInvoicePaymentInput,
) {
  return db.transaction(async (tx) => {
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
    if (!ownedInvoice) throw new HttpError(404, "Factura no encontrada.");
    const lifecycle = invoiceLifecycle(ownedInvoice);
    if (lifecycle === "VOID") throw new HttpError(409, "No se puede cobrar una factura anulada.");
    if (lifecycle === "DRAFT") throw new HttpError(409, "La factura es un borrador: emítela antes de registrar cobros.");
    if (ownedInvoice.invoiceType === "CREDIT_NOTE") throw new HttpError(409, "Una factura rectificativa no se cobra: se aplica a la factura original.");
    await assertFiscalPeriodOpen(actor.companyId, input.postedAt, tx);

    const [ownedPaymentMethod] = await tx
      .select({ id: paymentMethod.id })
      .from(paymentMethod)
      .where(and(eq(paymentMethod.id, input.paymentMethodId), eq(paymentMethod.companyId, actor.companyId)))
      .limit(1);
    if (!ownedPaymentMethod) throw new HttpError(404, "Forma de pago no encontrada.");

    const balance = await getInvoiceBalance(tx, actor.companyId, ownedInvoice.id, ownedInvoice.totalAmount);
    const amountCents = toCents(input.amountApplied);
    if (amountCents <= 0) throw new HttpError(400, "El importe cobrado debe ser mayor que 0.");
    if (amountCents > balance.outstandingCents) throw new HttpError(400, "El importe supera el saldo pendiente de la factura.");

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
        paymentMethodId: input.paymentMethodId,
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
      reference: `Cobro factura ${ownedInvoice.number}`,
      amount: amountCents / 100,
      paymentMethodId: input.paymentMethodId,
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
      payload: { paymentId: createdPayment.id, number, amount, postedAt: input.postedAt.toISOString(), bankTransactionId: input.bankTransactionId ?? null },
    }, tx);

    return { payment: createdPayment, application: appliedPayment };
  });
}
