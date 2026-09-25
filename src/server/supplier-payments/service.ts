import { and, eq, inArray } from "drizzle-orm";

import { bankAccount, goodsReceipt, partner, paymentMethod, purchaseOrder, supplierInvoice, supplierInvoicePayment, supplierPayment } from "@/db/schema";
import type { DbClient } from "@/lib/db";
import { postSupplierPayment, reverseAutomaticEntries } from "@/server/accounting/auto-post";
import { AccountingRuleError } from "@/server/accounting/errors";
import { toCents } from "@/server/accounting/money";
import { recordAudit } from "@/server/audit";
import { reserveSeriesNumber } from "@/server/documents/series";
import { assertFiscalPeriodOpen } from "@/server/fiscal/locks";
import { withTransaction, type PaymentActor, type PaymentOrigin } from "@/server/invoices/payments";
import { refreshSupplierInvoicePaymentStatus } from "@/server/supplier-invoices/service";
import { paymentMethodForBankAccount } from "@/server/treasury/payment-methods";
import { reconcileBankTransaction } from "@/server/treasury/reconciliation";

/*
 * Pagos a proveedores: única fuente de verdad para la API /api/supplier-payments, la mesa de
 * conciliación y las remesas SEPA de transferencias. Registrar y deshacer son simétricos:
 * - registrar: pago + aplicación a factura + asiento Banco ↔ 400 + estado de la factura y del pedido;
 * - deshacer: revierte el asiento, borra el pago y recalcula el estado de la factura
 *   (PENDIENTE/PARCIAL/VENCIDA) y del pedido (PAGADO → FACTURADO).
 */

export type RegisterSupplierPaymentInput = {
  supplierInvoiceId?: string | null;
  supplierPartnerId?: string | null;
  amountApplied: number;
  postedAt: Date;
  paymentMethodId?: string | null;
  /** Banco del pago. Con `bankAccountId` y sin forma de pago se usa la forma de pago del banco. */
  bankAccountId?: string | null;
  reference?: string | null;
  notes?: string | null;
  /** Movimiento bancario del que nace el pago: se concilia en la misma operación. */
  bankTransactionId?: string;
  origin?: PaymentOrigin;
};

type RemoveActor = Omit<PaymentActor, "activeFiscalYearId">;

/**
 * Estado del pedido de compra según el cobro de sus facturas (función pura):
 * todas las facturas activas pagadas → PAID; si estaba PAID y ya no lo está → INVOICED (o
 * RECEIVED/APPROVED si no queda ninguna factura activa). En otro caso no cambia.
 */
export function nextPurchaseOrderStatus(input: {
  currentStatus: string;
  invoices: Array<{ status: string; paymentStatus: string }>;
  hasGoodsReceipt: boolean;
}) {
  const active = input.invoices.filter((row) => row.status !== "VOID");
  const allPaid = active.length > 0 && active.every((row) => row.paymentStatus === "PAID");
  if (allPaid) return "PAID";
  if (input.currentStatus !== "PAID") return input.currentStatus;
  if (active.length > 0) return "INVOICED";
  return input.hasGoodsReceipt ? "RECEIVED" : "APPROVED";
}

/** Recalcula el estado del pedido de compra tras registrar o deshacer un pago de sus facturas. */
export async function syncPurchaseOrderPaymentStatus(client: DbClient, companyId: string, purchaseOrderId: string) {
  const [order] = await client
    .select({ id: purchaseOrder.id, status: purchaseOrder.status })
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.companyId, companyId), eq(purchaseOrder.id, purchaseOrderId)))
    .limit(1);
  if (!order) return null;
  const [invoices, receipts] = await Promise.all([
    client
      .select({ status: supplierInvoice.status, paymentStatus: supplierInvoice.paymentStatus })
      .from(supplierInvoice)
      .where(and(eq(supplierInvoice.companyId, companyId), eq(supplierInvoice.purchaseOrderId, purchaseOrderId))),
    client
      .select({ id: goodsReceipt.id })
      .from(goodsReceipt)
      .where(and(eq(goodsReceipt.companyId, companyId), eq(goodsReceipt.purchaseOrderId, purchaseOrderId)))
      .limit(1),
  ]);
  const next = nextPurchaseOrderStatus({ currentStatus: order.status, invoices, hasGoodsReceipt: receipts.length > 0 });
  if (next !== order.status) {
    await client
      .update(purchaseOrder)
      .set({ status: next })
      .where(and(eq(purchaseOrder.companyId, companyId), eq(purchaseOrder.id, purchaseOrderId)));
  }
  return next;
}

async function refreshInvoiceAndOrder(client: DbClient, companyId: string, supplierInvoiceId: string) {
  const [row] = await client
    .select({ status: supplierInvoice.status, purchaseOrderId: supplierInvoice.purchaseOrderId })
    .from(supplierInvoice)
    .where(and(eq(supplierInvoice.companyId, companyId), eq(supplierInvoice.id, supplierInvoiceId)))
    .limit(1);
  if (!row) return null;
  // Una factura anulada conserva su estado de pago VOID.
  const refreshed = row.status === "VOID" ? null : await refreshSupplierInvoicePaymentStatus(companyId, supplierInvoiceId, client);
  if (row.purchaseOrderId) await syncPurchaseOrderPaymentStatus(client, companyId, row.purchaseOrderId);
  return refreshed;
}

/**
 * Registra un pago a proveedor (a una factura o a cuenta del proveedor). Con `client` se ejecuta
 * dentro de la transacción de quien llama; sin él abre la suya.
 */
export async function registerSupplierPayment(actor: PaymentActor, input: RegisterSupplierPaymentInput, client?: DbClient) {
  return withTransaction(client, async (tx) => {
    const [ownedInvoice] = input.supplierInvoiceId
      ? await tx
        .select({
          id: supplierInvoice.id,
          number: supplierInvoice.number,
          supplierPartnerId: supplierInvoice.supplierPartnerId,
          purchaseOrderId: supplierInvoice.purchaseOrderId,
          totalAmount: supplierInvoice.totalAmount,
          status: supplierInvoice.status,
        })
        .from(supplierInvoice)
        .where(and(eq(supplierInvoice.id, input.supplierInvoiceId), eq(supplierInvoice.companyId, actor.companyId)))
        .for("update")
        .limit(1)
      : [];
    if (input.supplierInvoiceId && !ownedInvoice) throw new AccountingRuleError(404, "SUPPLIER_INVOICE_NOT_FOUND", "Factura de proveedor no encontrada.");
    if (!input.supplierInvoiceId && !input.supplierPartnerId) throw new AccountingRuleError(400, "SUPPLIER_REQUIRED", "Debes indicar un proveedor o una factura.");
    if (ownedInvoice?.status === "VOID") throw new AccountingRuleError(409, "SUPPLIER_INVOICE_VOID", "No se puede pagar una factura anulada.");
    if (ownedInvoice && input.supplierPartnerId && ownedInvoice.supplierPartnerId !== input.supplierPartnerId) {
      throw new AccountingRuleError(400, "SUPPLIER_PAYMENT_PARTNER_MISMATCH", "La factura no pertenece al proveedor indicado.");
    }

    const supplierPartnerId = ownedInvoice?.supplierPartnerId ?? input.supplierPartnerId ?? "";
    const [ownedSupplier] = await tx
      .select({ id: partner.id })
      .from(partner)
      .where(and(
        eq(partner.id, supplierPartnerId),
        eq(partner.companyId, actor.companyId),
        // Un pago a cuenta exige un proveedor; si viene de una factura basta con que sea de la empresa.
        ownedInvoice ? undefined : inArray(partner.type, ["SUPPLIER", "BOTH"]),
      ))
      .limit(1);
    if (!ownedSupplier) throw new AccountingRuleError(404, "SUPPLIER_NOT_FOUND", "Proveedor no encontrado.");

    await assertFiscalPeriodOpen(actor.companyId, input.postedAt, tx);
    const [ownedPaymentMethods, ownedBankAccounts] = await Promise.all([
      input.paymentMethodId
        ? tx.select({ id: paymentMethod.id }).from(paymentMethod).where(and(eq(paymentMethod.id, input.paymentMethodId), eq(paymentMethod.companyId, actor.companyId))).limit(1)
        : Promise.resolve([]),
      input.bankAccountId
        ? tx.select({ id: bankAccount.id }).from(bankAccount).where(and(eq(bankAccount.id, input.bankAccountId), eq(bankAccount.companyId, actor.companyId))).limit(1)
        : Promise.resolve([]),
    ]);
    if (input.paymentMethodId && !ownedPaymentMethods[0]) throw new AccountingRuleError(400, "PAYMENT_METHOD_NOT_FOUND", "La forma de pago no pertenece a la empresa activa.");
    if (input.bankAccountId && !ownedBankAccounts[0]) throw new AccountingRuleError(400, "BANK_ACCOUNT_NOT_FOUND", "La cuenta bancaria no pertenece a la empresa activa.");

    const amountCents = toCents(input.amountApplied);
    if (amountCents <= 0) throw new AccountingRuleError(400, "AMOUNT_INVALID", "El importe pagado debe ser mayor que 0.");
    if (ownedInvoice) {
      const appliedPayments = await tx
        .select({ amountApplied: supplierInvoicePayment.amountApplied })
        .from(supplierInvoicePayment)
        .where(and(eq(supplierInvoicePayment.supplierInvoiceId, ownedInvoice.id), eq(supplierInvoicePayment.companyId, actor.companyId)));
      const paidCents = appliedPayments.reduce((total, entry) => total + toCents(entry.amountApplied), 0);
      const outstandingCents = Math.max(toCents(ownedInvoice.totalAmount) - paidCents, 0);
      if (amountCents > outstandingCents) {
        throw new AccountingRuleError(400, "SUPPLIER_INVOICE_OVERPAYMENT", `El importe supera el saldo pendiente de la factura de proveedor ${ownedInvoice.number} (${(outstandingCents / 100).toFixed(2)}).`);
      }
    }
    if (input.bankTransactionId && !ownedInvoice) {
      throw new AccountingRuleError(400, "SUPPLIER_PAYMENT_NEEDS_INVOICE", "Para conciliar con un movimiento bancario el pago debe aplicarse a una factura.");
    }

    const methodId = input.paymentMethodId || (input.bankAccountId ? await paymentMethodForBankAccount(tx, actor.companyId, input.bankAccountId) : null);
    const number = await reserveSeriesNumber(tx, {
      companyId: actor.companyId,
      fiscalYearId: actor.activeFiscalYearId,
      type: "PAYMENT",
      referenceDate: input.postedAt,
    });
    const amount = (amountCents / 100).toFixed(2);
    const [createdPayment] = await tx
      .insert(supplierPayment)
      .values({
        companyId: actor.companyId,
        number,
        supplierPartnerId: ownedSupplier.id,
        supplierInvoiceId: ownedInvoice?.id ?? null,
        paymentMethodId: methodId,
        bankAccountId: input.bankAccountId || null,
        reference: input.reference?.slice(0, 160) || null,
        notes: input.notes || null,
        amount,
        postedAt: input.postedAt,
      })
      .returning();

    const [appliedPayment] = ownedInvoice
      ? await tx
        .insert(supplierInvoicePayment)
        .values({ companyId: actor.companyId, supplierInvoiceId: ownedInvoice.id, supplierPaymentId: createdPayment.id, amountApplied: amount })
        .returning()
      : [];

    await postSupplierPayment({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      supplierPaymentId: createdPayment.id,
      postedAt: input.postedAt,
      reference: (input.reference || (ownedInvoice ? `Pago factura proveedor ${ownedInvoice.number}` : `Pago a cuenta de proveedor ${ownedSupplier.id}`)).slice(0, 200),
      amount: amountCents / 100,
      paymentMethodId: methodId,
      bankAccountId: input.bankAccountId || null,
      dbClient: tx,
    });

    if (input.bankTransactionId && appliedPayment) {
      await reconcileBankTransaction(tx, {
        companyId: actor.companyId,
        tenantId: actor.tenantId,
        actorUserId: actor.actorUserId,
        transactionId: input.bankTransactionId,
        kind: "supplier",
        matchId: appliedPayment.id,
      });
    }

    if (ownedInvoice) await refreshInvoiceAndOrder(tx, actor.companyId, ownedInvoice.id);

    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "supplier_payment.create",
      entityName: "supplier_payment",
      entityId: createdPayment.id,
      payload: {
        number: createdPayment.number,
        supplierPartnerId: ownedSupplier.id,
        supplierInvoiceId: ownedInvoice?.id ?? null,
        amount: amountCents / 100,
        paymentMethodId: methodId,
        bankAccountId: input.bankAccountId || null,
        reference: input.reference || null,
        origin: input.origin ?? "manual",
      },
    }, tx);

    return { payment: createdPayment, application: appliedPayment ?? null, invoiceNumber: ownedInvoice?.number ?? null };
  });
}

/**
 * Elimina un pago a proveedor (deshacer una conciliación o la confirmación de una remesa):
 * revierte el asiento, borra el pago y recalcula la factura y su pedido. Devuelve false si no existe.
 */
export async function removeSupplierPayment(actor: RemoveActor, supplierPaymentId: string, options: { reason?: string; origin?: string } = {}, client?: DbClient) {
  return withTransaction(client, async (tx) => {
    const [row] = await tx
      .select({ id: supplierPayment.id, supplierInvoiceId: supplierPayment.supplierInvoiceId, number: supplierPayment.number, postedAt: supplierPayment.postedAt, amount: supplierPayment.amount })
      .from(supplierPayment)
      .where(and(eq(supplierPayment.id, supplierPaymentId), eq(supplierPayment.companyId, actor.companyId)))
      .for("update")
      .limit(1);
    if (!row) return false;
    await assertFiscalPeriodOpen(actor.companyId, row.postedAt, tx);
    await reverseAutomaticEntries({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      postedAt: row.postedAt,
      reference: `Anulación pago ${row.number}`,
      sourceType: "supplierPayment",
      sourceId: row.id,
      reason: options.reason ?? `Pago ${row.number} deshecho desde tesorería`,
      dbClient: tx,
    });
    await tx.delete(supplierPayment).where(and(eq(supplierPayment.id, row.id), eq(supplierPayment.companyId, actor.companyId)));
    if (row.supplierInvoiceId) await refreshInvoiceAndOrder(tx, actor.companyId, row.supplierInvoiceId);
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "supplier_payment.delete",
      entityName: "supplier_payment",
      entityId: row.id,
      payload: { number: row.number, amount: row.amount, supplierInvoiceId: row.supplierInvoiceId, origin: options.origin ?? "treasury.undo" },
    }, tx);
    return true;
  });
}

