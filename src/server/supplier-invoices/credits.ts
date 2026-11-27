import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import { accountChart, bankAccount, journalEntry, journalLine, supplierCreditApplication, supplierInvoice } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { createAutomaticEntry, resolveAccounts, resolveBankLedgerAccountId, reverseAutomaticEntries } from "@/server/accounting/auto-post";
import { AccountingRuleError } from "@/server/accounting/errors";
import { centsToAmount, toCents } from "@/server/accounting/money";
import { ensurePartnerSubaccount } from "@/server/accounting/subaccounts";
import { recordAudit } from "@/server/audit";
import { assertFiscalPeriodOpen } from "@/server/fiscal/locks";
import {
  supplierCreditAllocationCents,
  supplierCreditRemainingCents,
  supplierOutstandingCents,
  supplierPaymentStatus,
} from "@/server/supplier-invoices/document-rules";
import { loadSupplierInvoiceSettlement, syncPurchaseOrderPaymentStatus } from "@/server/supplier-invoices/outstanding";

/*
 * Compensación de abonos de proveedor.
 *
 * Un abono (rectificativa de total negativo) reduce lo pendiente de la factura contra la que se
 * aplica: pendiente = total − pagos − abonos aplicados. Al registrarlo se aplica solo contra la
 * factura que rectifica (hasta lo que esta tenga pendiente); lo que sobre, o un abono sin factura
 * enlazada, queda como saldo a favor del proveedor, que se puede aplicar a otra factura suya o
 * cobrar por banco (devolución).
 *
 * Asientos: la compensación NO genera ninguno. La factura abonó la subcuenta 400/410 del proveedor
 * y el abono la cargó: el saldo de la subcuenta ya es el neto. Solo se casan los dos apuntes
 * (`journal_line.matchingId`). La devolución por banco sí se contabiliza:
 *     572 Banco (debe)  a  400/410 Proveedor (haber)
 * y salda el saldo deudor que el abono dejó en la subcuenta.
 */

export const SUPPLIER_CREDIT_REFUND_SOURCE = "supplierCreditRefund";

type Actor = { tenantId: string; companyId: string; actorUserId: string };

type DocumentRow = {
  id: string;
  number: string;
  supplierPartnerId: string;
  purchaseOrderId: string | null;
  status: string;
  totalAmount: string;
  dueDate: Date | null;
};

async function lockDocuments(tx: DbClient, companyId: string, ids: string[]) {
  const rows: DocumentRow[] = await tx
    .select({
      id: supplierInvoice.id,
      number: supplierInvoice.number,
      supplierPartnerId: supplierInvoice.supplierPartnerId,
      purchaseOrderId: supplierInvoice.purchaseOrderId,
      status: supplierInvoice.status,
      totalAmount: supplierInvoice.totalAmount,
      dueDate: supplierInvoice.dueDate,
    })
    .from(supplierInvoice)
    .where(and(eq(supplierInvoice.companyId, companyId), inArray(supplierInvoice.id, ids)))
    // Orden estable: dos compensaciones cruzadas no se bloquean entre sí.
    .orderBy(asc(supplierInvoice.id))
    .for("update");
  return new Map(rows.map((row) => [row.id, row]));
}

/** Importe ya compensado o devuelto de un abono, en céntimos. */
async function creditAppliedCents(tx: DbClient, companyId: string, creditInvoiceId: string) {
  const [row] = await tx
    .select({ amount: sql<string>`coalesce(sum(${supplierCreditApplication.amount}), 0)` })
    .from(supplierCreditApplication)
    .where(and(eq(supplierCreditApplication.companyId, companyId), eq(supplierCreditApplication.creditInvoiceId, creditInvoiceId)));
  return toCents(row?.amount ?? 0);
}

/** Estado de pago de la factura (pagos + abonos) y del pedido del que viene. */
export async function refreshSettledInvoice(tx: DbClient, companyId: string, invoice: Pick<DocumentRow, "id" | "status" | "totalAmount" | "dueDate" | "purchaseOrderId">) {
  if (invoice.status !== "VOID") {
    const settlement = await loadSupplierInvoiceSettlement(tx, companyId, invoice.id);
    const paymentStatus = supplierPaymentStatus(Number(invoice.totalAmount), (settlement.paidCents + settlement.creditedCents) / 100, invoice.dueDate);
    await tx
      .update(supplierInvoice)
      .set({ paymentStatus, updatedAt: new Date() })
      .where(and(eq(supplierInvoice.companyId, companyId), eq(supplierInvoice.id, invoice.id)));
  }
  if (invoice.purchaseOrderId) await syncPurchaseOrderPaymentStatus(tx, companyId, invoice.purchaseOrderId);
}

/** Apuntes del proveedor (subcuenta 400/410 con ese tercero) de los asientos vivos de un documento. */
async function partyLineIds(tx: DbClient, companyId: string, documentId: string, supplierPartnerId: string) {
  const rows = await tx
    .select({ id: journalLine.id })
    .from(journalLine)
    .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
    .innerJoin(accountChart, eq(accountChart.id, journalLine.accountId))
    .where(and(
      eq(journalEntry.companyId, companyId),
      eq(journalEntry.sourceType, "supplierInvoice"),
      eq(journalEntry.sourceId, documentId),
      isNull(journalEntry.reversesEntryId),
      isNull(journalEntry.reversedAt),
      eq(accountChart.partnerId, supplierPartnerId),
    ));
  return rows.map((row) => row.id);
}

/**
 * Casación: los apuntes del proveedor de la factura y de sus abonos comparten `matchingId` (el id
 * de la factura). Al quitar la compensación se libera el del abono y, si la factura ya no tiene
 * ninguno, también el suyo.
 */
async function syncMatching(tx: DbClient, companyId: string, invoice: DocumentRow, credit: DocumentRow, linked: boolean) {
  const creditLines = await partyLineIds(tx, companyId, credit.id, credit.supplierPartnerId);
  const invoiceLines = await partyLineIds(tx, companyId, invoice.id, invoice.supplierPartnerId);
  if (linked) {
    const ids = [...creditLines, ...invoiceLines];
    if (ids.length > 0) await tx.update(journalLine).set({ matchingId: invoice.id }).where(inArray(journalLine.id, ids));
    return;
  }
  const [stillAppliedHere] = await tx
    .select({ id: supplierCreditApplication.id })
    .from(supplierCreditApplication)
    .where(and(eq(supplierCreditApplication.creditInvoiceId, credit.id), eq(supplierCreditApplication.supplierInvoiceId, invoice.id)))
    .limit(1);
  if (!stillAppliedHere && creditLines.length > 0) {
    await tx.update(journalLine).set({ matchingId: null }).where(and(inArray(journalLine.id, creditLines), eq(journalLine.matchingId, invoice.id)));
  }
  const [anyOther] = await tx
    .select({ id: supplierCreditApplication.id })
    .from(supplierCreditApplication)
    .where(eq(supplierCreditApplication.supplierInvoiceId, invoice.id))
    .limit(1);
  if (!anyOther && invoiceLines.length > 0) {
    await tx.update(journalLine).set({ matchingId: null }).where(and(inArray(journalLine.id, invoiceLines), eq(journalLine.matchingId, invoice.id)));
  }
}

/**
 * Compensa un abono contra una factura del mismo proveedor, dentro de la transacción de quien
 * llama. Sin `amount` aplica todo lo posible (lo menor entre el saldo del abono y lo pendiente de
 * la factura) y devuelve null si no hay nada que aplicar; con `amount` exige que quepa.
 */
export async function applySupplierCreditInTransaction(
  tx: DbClient,
  actor: Actor,
  input: { creditInvoiceId: string; supplierInvoiceId: string; amount?: number },
) {
  if (input.creditInvoiceId === input.supplierInvoiceId) throw new AccountingRuleError(400, "SUPPLIER_CREDIT_SAME_DOCUMENT", "Un abono no se puede compensar contra sí mismo.");
  const rows = await lockDocuments(tx, actor.companyId, [input.creditInvoiceId, input.supplierInvoiceId]);
  const credit = rows.get(input.creditInvoiceId);
  const invoice = rows.get(input.supplierInvoiceId);
  if (!credit) throw new AccountingRuleError(404, "SUPPLIER_CREDIT_NOT_FOUND", "Abono de proveedor no encontrado.");
  if (!invoice) throw new AccountingRuleError(404, "SUPPLIER_INVOICE_NOT_FOUND", "Factura de proveedor no encontrada.");
  if (credit.status === "VOID" || invoice.status === "VOID") throw new AccountingRuleError(409, "SUPPLIER_INVOICE_VOID", "No se puede compensar un documento anulado.");
  if (toCents(credit.totalAmount) >= 0) throw new AccountingRuleError(422, "SUPPLIER_CREDIT_NOT_CREDIT", `El documento ${credit.number} no es un abono (su total no es negativo).`);
  if (credit.supplierPartnerId !== invoice.supplierPartnerId) throw new AccountingRuleError(422, "SUPPLIER_CREDIT_PARTNER_MISMATCH", "El abono y la factura son de proveedores distintos.");

  const remainingCents = supplierCreditRemainingCents({ totalCents: toCents(credit.totalAmount), appliedCents: await creditAppliedCents(tx, actor.companyId, credit.id) });
  const settlement = await loadSupplierInvoiceSettlement(tx, actor.companyId, invoice.id);
  const outstandingCents = supplierOutstandingCents({ totalCents: toCents(invoice.totalAmount), ...settlement });
  const maxCents = supplierCreditAllocationCents(remainingCents, outstandingCents);
  let cents = maxCents;
  if (input.amount !== undefined) {
    cents = toCents(input.amount);
    if (cents <= 0) throw new AccountingRuleError(400, "AMOUNT_INVALID", "El importe a compensar debe ser mayor que 0.");
    if (cents > maxCents) {
      throw new AccountingRuleError(
        422,
        "SUPPLIER_CREDIT_OVER",
        `Solo se pueden compensar ${centsToAmount(maxCents)}: es lo menor entre el saldo del abono (${centsToAmount(remainingCents)}) y lo pendiente de la factura ${invoice.number} (${centsToAmount(outstandingCents)}).`,
      );
    }
  }
  if (cents <= 0) return null;

  const [application] = await tx
    .insert(supplierCreditApplication)
    .values({ companyId: actor.companyId, creditInvoiceId: credit.id, supplierInvoiceId: invoice.id, amount: centsToAmount(cents) })
    .returning();
  await syncMatching(tx, actor.companyId, invoice, credit, true);
  await refreshSettledInvoice(tx, actor.companyId, invoice);
  await recordAudit({
    ...actor,
    action: "supplier_credit.apply",
    entityName: "supplierInvoice",
    entityId: invoice.id,
    payload: { creditInvoiceId: credit.id, creditNumber: credit.number, invoiceNumber: invoice.number, amount: cents / 100 },
  }, tx);
  return { application, creditNumber: credit.number, invoiceNumber: invoice.number, amount: cents / 100 };
}

export async function applySupplierCredit(actor: Actor, input: { creditInvoiceId: string; supplierInvoiceId: string; amount?: number }) {
  return db.transaction(async (tx) => {
    const result = await applySupplierCreditInTransaction(tx, actor, input);
    if (!result) throw new AccountingRuleError(422, "SUPPLIER_CREDIT_NOTHING", "No hay nada que compensar: el abono no tiene saldo o la factura no tiene importe pendiente.");
    return result;
  });
}

/**
 * Suelta las compensaciones de un documento que se anula (dentro de su transacción):
 * - de un abono: sus facturas vuelven a tener ese importe pendiente;
 * - de una factura: los abonos aplicados recuperan su saldo a favor.
 * Un abono con una devolución por banco registrada no se puede anular sin quitarla antes.
 */
export async function releaseSupplierCreditApplications(tx: DbClient, companyId: string, document: { id: string; number: string }) {
  const rows = await tx
    .select({ id: supplierCreditApplication.id, creditInvoiceId: supplierCreditApplication.creditInvoiceId, supplierInvoiceId: supplierCreditApplication.supplierInvoiceId })
    .from(supplierCreditApplication)
    .where(and(
      eq(supplierCreditApplication.companyId, companyId),
      sql`(${supplierCreditApplication.creditInvoiceId} = ${document.id} or ${supplierCreditApplication.supplierInvoiceId} = ${document.id})`,
    ));
  if (rows.length === 0) return 0;
  if (rows.some((row) => row.creditInvoiceId === document.id && !row.supplierInvoiceId)) {
    throw new AccountingRuleError(409, "SUPPLIER_CREDIT_REFUNDED", `El abono ${document.number} tiene una devolución cobrada por banco. Quita antes ese cobro.`);
  }
  const documents = await lockDocuments(tx, companyId, [...new Set(rows.flatMap((row) => [row.creditInvoiceId, row.supplierInvoiceId ?? row.creditInvoiceId]))]);
  await tx.delete(supplierCreditApplication).where(inArray(supplierCreditApplication.id, rows.map((row) => row.id)));
  for (const row of rows) {
    const credit = documents.get(row.creditInvoiceId);
    const invoice = row.supplierInvoiceId ? documents.get(row.supplierInvoiceId) : undefined;
    if (!credit || !invoice) continue;
    await syncMatching(tx, companyId, invoice, credit, false);
    // La factura que se está anulando conserva su estado VOID; las demás recalculan su pendiente.
    if (invoice.id !== document.id) await refreshSettledInvoice(tx, companyId, invoice);
  }
  return rows.length;
}

/** Quita una compensación o una devolución por banco (revierte su asiento). */
export async function removeSupplierCreditApplication(actor: Actor, applicationId: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(supplierCreditApplication)
      .where(and(eq(supplierCreditApplication.companyId, actor.companyId), eq(supplierCreditApplication.id, applicationId)))
      .for("update")
      .limit(1);
    if (!row) return false;
    const documents = await lockDocuments(tx, actor.companyId, [row.creditInvoiceId, ...(row.supplierInvoiceId ? [row.supplierInvoiceId] : [])]);
    const credit = documents.get(row.creditInvoiceId);
    if (!row.supplierInvoiceId) {
      await assertFiscalPeriodOpen(actor.companyId, row.appliedAt, tx);
      await reverseAutomaticEntries({
        ...actor,
        postedAt: row.appliedAt,
        reference: `Anulación devolución abono ${credit?.number ?? ""}`.trim(),
        sourceType: SUPPLIER_CREDIT_REFUND_SOURCE,
        sourceId: row.id,
        reason: `Devolución del abono ${credit?.number ?? ""} deshecha`.trim(),
        dbClient: tx,
      });
    }
    await tx.delete(supplierCreditApplication).where(eq(supplierCreditApplication.id, row.id));
    const invoice = row.supplierInvoiceId ? documents.get(row.supplierInvoiceId) : undefined;
    if (invoice && credit) {
      await syncMatching(tx, actor.companyId, invoice, credit, false);
      await refreshSettledInvoice(tx, actor.companyId, invoice);
    }
    await recordAudit({
      ...actor,
      action: row.supplierInvoiceId ? "supplier_credit.unapply" : "supplier_credit.refund.delete",
      entityName: "supplierInvoice",
      entityId: row.creditInvoiceId,
      payload: { applicationId: row.id, supplierInvoiceId: row.supplierInvoiceId, amount: Number(row.amount) },
    }, tx);
    return true;
  });
}

/**
 * Devolución del proveedor cobrada por banco: reduce el saldo a favor del abono y contabiliza
 * banco (debe) a la subcuenta 400/410 del proveedor (haber), la misma que usó el abono.
 */
export async function registerSupplierCreditRefund(
  actor: Actor,
  input: { creditInvoiceId: string; amount: number; postedAt: Date; bankAccountId: string; reference?: string | null },
) {
  return db.transaction(async (tx) => {
    const credit = (await lockDocuments(tx, actor.companyId, [input.creditInvoiceId])).get(input.creditInvoiceId);
    if (!credit) throw new AccountingRuleError(404, "SUPPLIER_CREDIT_NOT_FOUND", "Abono de proveedor no encontrado.");
    if (credit.status === "VOID") throw new AccountingRuleError(409, "SUPPLIER_INVOICE_VOID", "El abono está anulado.");
    if (toCents(credit.totalAmount) >= 0) throw new AccountingRuleError(422, "SUPPLIER_CREDIT_NOT_CREDIT", `El documento ${credit.number} no es un abono (su total no es negativo).`);
    const [account] = await tx
      .select({ id: bankAccount.id })
      .from(bankAccount)
      .where(and(eq(bankAccount.id, input.bankAccountId), eq(bankAccount.companyId, actor.companyId)))
      .limit(1);
    if (!account) throw new AccountingRuleError(400, "BANK_ACCOUNT_NOT_FOUND", "La cuenta bancaria no pertenece a la empresa activa.");
    const cents = toCents(input.amount);
    const remainingCents = supplierCreditRemainingCents({ totalCents: toCents(credit.totalAmount), appliedCents: await creditAppliedCents(tx, actor.companyId, credit.id) });
    if (cents <= 0) throw new AccountingRuleError(400, "AMOUNT_INVALID", "El importe devuelto debe ser mayor que 0.");
    if (cents > remainingCents) {
      throw new AccountingRuleError(422, "SUPPLIER_CREDIT_OVER", `El importe supera el saldo a favor del abono ${credit.number} (${centsToAmount(remainingCents)}).`);
    }
    await assertFiscalPeriodOpen(actor.companyId, input.postedAt, tx);

    const [application] = await tx
      .insert(supplierCreditApplication)
      .values({
        companyId: actor.companyId,
        creditInvoiceId: credit.id,
        supplierInvoiceId: null,
        amount: centsToAmount(cents),
        appliedAt: input.postedAt,
        bankAccountId: account.id,
        reference: input.reference?.trim().slice(0, 160) || null,
      })
      .returning();

    const { ids } = await resolveAccounts(actor.companyId, ["bank", "supplier"], tx);
    const bankId = (await resolveBankLedgerAccountId(tx, actor.companyId, { bankAccountId: account.id })) ?? ids.bank;
    // Misma subcuenta que cargó el abono; si no se encuentra su asiento, la del proveedor.
    const [creditLine] = await tx
      .select({ accountId: journalLine.accountId })
      .from(journalLine)
      .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
      .innerJoin(accountChart, eq(accountChart.id, journalLine.accountId))
      .where(and(
        eq(journalEntry.companyId, actor.companyId),
        eq(journalEntry.sourceType, "supplierInvoice"),
        eq(journalEntry.sourceId, credit.id),
        isNull(journalEntry.reversesEntryId),
        eq(accountChart.partnerId, credit.supplierPartnerId),
      ))
      .limit(1);
    const supplierAccountId = creditLine?.accountId
      ?? (await ensurePartnerSubaccount({ id: credit.supplierPartnerId, companyId: actor.companyId }, { role: "supplier", client: tx })).id;
    const reference = (input.reference?.trim() || `Devolución abono proveedor ${credit.number}`).slice(0, 200);
    const document = { partnerId: credit.supplierPartnerId, documentType: "supplierInvoice", documentNumber: credit.number, documentId: credit.id };
    await createAutomaticEntry({
      ...actor,
      postedAt: input.postedAt,
      reference,
      dbClient: tx,
      action: "accounting.autopost.supplierCreditRefund",
      entityName: SUPPLIER_CREDIT_REFUND_SOURCE,
      entityId: application.id,
      lines: [
        { accountId: bankId, debit: cents / 100, credit: 0, ...document },
        { accountId: supplierAccountId, debit: 0, credit: cents / 100, ...document },
      ],
    });
    await recordAudit({
      ...actor,
      action: "supplier_credit.refund",
      entityName: "supplierInvoice",
      entityId: credit.id,
      payload: { applicationId: application.id, amount: cents / 100, bankAccountId: account.id },
    }, tx);
    return { application, creditNumber: credit.number, amount: cents / 100 };
  });
}

/** Aplicaciones de un documento: como abono (a qué facturas o devoluciones) y como factura (qué abonos). */
export async function listSupplierCreditApplications(companyId: string, documentId: string, client: DbClient = db) {
  const [asCredit, asInvoice] = await Promise.all([
    client
      .select({
        id: supplierCreditApplication.id,
        amount: supplierCreditApplication.amount,
        appliedAt: supplierCreditApplication.appliedAt,
        supplierInvoiceId: supplierCreditApplication.supplierInvoiceId,
        documentNumber: supplierInvoice.number,
        supplierDocumentNumber: supplierInvoice.supplierDocumentNumber,
        reference: supplierCreditApplication.reference,
      })
      .from(supplierCreditApplication)
      .leftJoin(supplierInvoice, eq(supplierInvoice.id, supplierCreditApplication.supplierInvoiceId))
      .where(and(eq(supplierCreditApplication.companyId, companyId), eq(supplierCreditApplication.creditInvoiceId, documentId)))
      .orderBy(desc(supplierCreditApplication.appliedAt)),
    client
      .select({
        id: supplierCreditApplication.id,
        amount: supplierCreditApplication.amount,
        appliedAt: supplierCreditApplication.appliedAt,
        creditInvoiceId: supplierCreditApplication.creditInvoiceId,
        documentNumber: supplierInvoice.number,
        supplierDocumentNumber: supplierInvoice.supplierDocumentNumber,
      })
      .from(supplierCreditApplication)
      .innerJoin(supplierInvoice, eq(supplierInvoice.id, supplierCreditApplication.creditInvoiceId))
      .where(and(eq(supplierCreditApplication.companyId, companyId), eq(supplierCreditApplication.supplierInvoiceId, documentId)))
      .orderBy(desc(supplierCreditApplication.appliedAt)),
  ]);
  return { asCredit, asInvoice };
}

/** Abonos vivos de la empresa (o de un proveedor) con saldo a favor sin aplicar. */
export async function listSupplierCreditBalances(companyId: string, supplierPartnerId?: string, client: DbClient = db) {
  const applied = sql<string>`coalesce((select sum(${supplierCreditApplication.amount}) from ${supplierCreditApplication} where ${supplierCreditApplication.creditInvoiceId} = ${supplierInvoice.id}), 0)`;
  const remaining = sql<string>`(-${supplierInvoice.totalAmount} - ${applied})`;
  const rows = await client
    .select({
      id: supplierInvoice.id,
      number: supplierInvoice.number,
      supplierDocumentNumber: supplierInvoice.supplierDocumentNumber,
      supplierPartnerId: supplierInvoice.supplierPartnerId,
      issueDate: supplierInvoice.issueDate,
      totalAmount: supplierInvoice.totalAmount,
      remaining: remaining.mapWith(Number),
    })
    .from(supplierInvoice)
    .where(and(
      eq(supplierInvoice.companyId, companyId),
      ne(supplierInvoice.status, "VOID"),
      sql`${supplierInvoice.totalAmount} < 0`,
      supplierPartnerId ? eq(supplierInvoice.supplierPartnerId, supplierPartnerId) : undefined,
      sql`${remaining} > 0`,
    ))
    .orderBy(asc(supplierInvoice.issueDate));
  return rows;
}
