import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import {
  accountChart,
  bankAccount,
  bankTransaction,
  bankTransactionAllocation,
  company,
  customer,
  invoice,
  invoicePayment,
  sepaDirectDebitItem,
  sepaDirectDebitRemittance,
  sepaMandate,
} from "@/db/schema";
import { checkCreditorId } from "@/lib/bank-import/sepa-creditor";
import { db, type DbClient } from "@/lib/db";
import { postBankTransactionAssignment, reverseAutomaticEntries } from "@/server/accounting/auto-post";
import { AccountingRuleError } from "@/server/accounting/errors";
import { toCents } from "@/server/accounting/money";
import { recordAudit } from "@/server/audit";
import { resolveOpenPostingDate } from "@/server/fiscal/locks";
import { invoiceLifecycle } from "@/server/invoices/lifecycle";
import { removeInvoicePayment } from "@/server/invoices/payments";
import { getInvoiceBalance } from "@/server/invoices/service";
import { creditedByInvoiceSubquery, invoiceIsIssuedSql, netOutstandingSql, paidByInvoiceSubquery } from "@/server/invoices/sql";
import { earliestCollectionDate, mandateAfterCollection, mandateUnusableReason, nextSequenceType } from "@/server/sepa/direct-debit-rules";
import { buildPain008, validatePain008Input, type Pain008Input, type SequenceType } from "@/server/sepa/pain008";
import { createCustomerPaymentForBank, type TreasuryActor } from "@/server/treasury/bank-payments";

/*
 * Remesas de cobros por adeudo directo SEPA (CORE, pain.008.001.02):
 * 1. Se eligen facturas pendientes de clientes con mandato activo, la cuenta de abono y la fecha
 *    de cobro → se genera el fichero y se guarda la remesa (GENERATED). Aún no hay cobros.
 * 2. "Remesa cobrada": se registra un cobro por factura (Banco ↔ 430 en la subcuenta del banco de
 *    la remesa) con la fecha de cobro (COLLECTED). El abono único del extracto se concilia después
 *    con la propuesta "Remesa SEPA" de la mesa de conciliación.
 * 3. Devolución de un recibo: se anula su cobro con fecha de la devolución (la factura vuelve a
 *    pendiente) y, si ya está el cargo en el extracto, se concilia con él asignando la comisión.
 */

type Actor = Omit<TreasuryActor, "activeFiscalYearId">;

function remittanceNumber(now: Date) {
  const stamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `ADE${stamp}${crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}

/** Usos pendientes (en remesas generadas sin cobrar) por mandato. */
async function pendingUsesByMandate(client: DbClient, companyId: string) {
  const rows = await client
    .select({ mandateId: sepaDirectDebitItem.mandateId, invoiceId: sepaDirectDebitItem.invoiceId, number: sepaDirectDebitRemittance.number })
    .from(sepaDirectDebitItem)
    .innerJoin(sepaDirectDebitRemittance, eq(sepaDirectDebitRemittance.id, sepaDirectDebitItem.remittanceId))
    .where(and(eq(sepaDirectDebitItem.companyId, companyId), eq(sepaDirectDebitRemittance.status, "GENERATED")));
  const uses = new Map<string, number>();
  for (const row of rows) uses.set(row.mandateId, (uses.get(row.mandateId) ?? 0) + 1);
  return { uses, queued: new Map(rows.map((row) => [row.invoiceId, row.number])) };
}

/** Facturas emitidas pendientes de cobro, con el mandato activo más reciente de su cliente. */
export async function listCollectableInvoices(companyId: string, now = new Date()) {
  const paid = paidByInvoiceSubquery(companyId);
  const credited = creditedByInvoiceSubquery(companyId);
  const outstanding = netOutstandingSql(paid, credited);
  const [rows, mandates, pending] = await Promise.all([
    db
      .select({
        id: invoice.id,
        number: invoice.number,
        customerId: customer.id,
        customerName: customer.name,
        outstanding: outstanding.mapWith(Number),
        dueDate: invoice.dueDate,
        issueDate: invoice.issueDate,
      })
      .from(invoice)
      .innerJoin(customer, eq(customer.id, invoice.customerId))
      .leftJoin(paid, eq(paid.invoiceId, invoice.id))
      .leftJoin(credited, eq(credited.invoiceId, invoice.id))
      .where(and(eq(invoice.companyId, companyId), invoiceIsIssuedSql, eq(invoice.invoiceType, "INVOICE"), sql`${outstanding} > 0`))
      .orderBy(sql`${invoice.dueDate} asc nulls last`, asc(invoice.issueDate), asc(invoice.id))
      .limit(1000),
    db
      .select({
        id: sepaMandate.id,
        customerId: sepaMandate.customerId,
        mandateReference: sepaMandate.mandateReference,
        iban: sepaMandate.iban,
        mandateType: sepaMandate.mandateType,
        status: sepaMandate.status,
        collectionCount: sepaMandate.collectionCount,
        signatureDate: sepaMandate.signatureDate,
        lastCollectionAt: sepaMandate.lastCollectionAt,
      })
      .from(sepaMandate)
      .where(and(eq(sepaMandate.companyId, companyId), eq(sepaMandate.status, "ACTIVE")))
      .orderBy(desc(sepaMandate.signatureDate), desc(sepaMandate.createdAt)),
    pendingUsesByMandate(db, companyId),
  ]);
  const mandateByCustomer = new Map<string, (typeof mandates)[number]>();
  for (const mandate of mandates) if (!mandateByCustomer.has(mandate.customerId)) mandateByCustomer.set(mandate.customerId, mandate);
  return rows.map((row) => {
    const mandate = mandateByCustomer.get(row.customerId) ?? null;
    const uses = mandate ? pending.uses.get(mandate.id) ?? 0 : 0;
    return {
      ...row,
      href: `/invoices/${row.id}`,
      pendingRemittance: pending.queued.get(row.id) ?? null,
      mandate: mandate
        ? {
            id: mandate.id,
            reference: mandate.mandateReference,
            iban: mandate.iban,
            sequenceType: nextSequenceType(mandate, uses),
            problem: mandateUnusableReason(mandate, earliestCollectionDate(now), uses),
          }
        : null,
    };
  });
}

export async function listDirectDebitRemittances(companyId: string) {
  return db
    .select({
      id: sepaDirectDebitRemittance.id,
      number: sepaDirectDebitRemittance.number,
      status: sepaDirectDebitRemittance.status,
      collectionDate: sepaDirectDebitRemittance.collectionDate,
      totalAmount: sepaDirectDebitRemittance.totalAmount,
      itemCount: sepaDirectDebitRemittance.itemCount,
      createdAt: sepaDirectDebitRemittance.createdAt,
      collectedAt: sepaDirectDebitRemittance.collectedAt,
      bankName: bankAccount.bankName,
      iban: bankAccount.iban,
      returned: sql<number>`(select count(*) from ${sepaDirectDebitItem} where ${sepaDirectDebitItem.remittanceId} = ${sepaDirectDebitRemittance.id} and ${sepaDirectDebitItem.status} = 'RETURNED')`.mapWith(Number),
    })
    .from(sepaDirectDebitRemittance)
    .innerJoin(bankAccount, eq(bankAccount.id, sepaDirectDebitRemittance.bankAccountId))
    .where(eq(sepaDirectDebitRemittance.companyId, companyId))
    .orderBy(desc(sepaDirectDebitRemittance.createdAt), desc(sepaDirectDebitRemittance.id))
    .limit(200);
}

export async function getDirectDebitRemittance(companyId: string, id: string) {
  const [remittance] = await db
    .select({
      id: sepaDirectDebitRemittance.id,
      number: sepaDirectDebitRemittance.number,
      status: sepaDirectDebitRemittance.status,
      collectionDate: sepaDirectDebitRemittance.collectionDate,
      creditorId: sepaDirectDebitRemittance.creditorId,
      totalAmount: sepaDirectDebitRemittance.totalAmount,
      itemCount: sepaDirectDebitRemittance.itemCount,
      xml: sepaDirectDebitRemittance.xml,
      createdAt: sepaDirectDebitRemittance.createdAt,
      collectedAt: sepaDirectDebitRemittance.collectedAt,
      cancelledAt: sepaDirectDebitRemittance.cancelledAt,
      bankAccountId: sepaDirectDebitRemittance.bankAccountId,
      bankName: bankAccount.bankName,
      iban: bankAccount.iban,
    })
    .from(sepaDirectDebitRemittance)
    .innerJoin(bankAccount, eq(bankAccount.id, sepaDirectDebitRemittance.bankAccountId))
    .where(and(eq(sepaDirectDebitRemittance.companyId, companyId), eq(sepaDirectDebitRemittance.id, id)))
    .limit(1);
  if (!remittance) return null;
  const items = await db
    .select({
      id: sepaDirectDebitItem.id,
      invoiceId: sepaDirectDebitItem.invoiceId,
      invoiceNumber: invoice.number,
      customerId: sepaDirectDebitItem.customerId,
      debtorName: sepaDirectDebitItem.debtorName,
      debtorIban: sepaDirectDebitItem.debtorIban,
      amount: sepaDirectDebitItem.amount,
      endToEndId: sepaDirectDebitItem.endToEndId,
      sequenceType: sepaDirectDebitItem.sequenceType,
      mandateReference: sepaMandate.mandateReference,
      status: sepaDirectDebitItem.status,
      paymentId: sepaDirectDebitItem.paymentId,
      returnedAt: sepaDirectDebitItem.returnedAt,
      returnReason: sepaDirectDebitItem.returnReason,
      returnBankTransactionId: sepaDirectDebitItem.returnBankTransactionId,
      returnFeeAmount: sepaDirectDebitItem.returnFeeAmount,
    })
    .from(sepaDirectDebitItem)
    .innerJoin(invoice, eq(invoice.id, sepaDirectDebitItem.invoiceId))
    .innerJoin(sepaMandate, eq(sepaMandate.id, sepaDirectDebitItem.mandateId))
    .where(and(eq(sepaDirectDebitItem.companyId, companyId), eq(sepaDirectDebitItem.remittanceId, id)))
    .orderBy(asc(sepaDirectDebitItem.debtorName), asc(sepaDirectDebitItem.id));
  return { ...remittance, items };
}

export type DirectDebitItemInput = { invoiceId: string; amount: number };

export async function createDirectDebitRemittance(
  actor: Actor,
  input: { bankAccountId: string; collectionDate: Date; items: DirectDebitItemInput[]; now?: Date },
) {
  if (input.items.length === 0) throw new AccountingRuleError(422, "REMITTANCE_EMPTY", "Selecciona al menos una factura.");
  if (input.items.length > 500) throw new AccountingRuleError(422, "REMITTANCE_TOO_BIG", "Una remesa admite como máximo 500 recibos.");
  const now = input.now ?? new Date();
  const earliest = earliestCollectionDate(now);
  if (input.collectionDate.getTime() < earliest.getTime()) {
    throw new AccountingRuleError(422, "COLLECTION_DATE", `La fecha de cobro debe ser como pronto el ${earliest.toISOString().slice(0, 10)} (el banco necesita al menos un día hábil).`);
  }
  const ids = [...new Set(input.items.map((item) => item.invoiceId))];
  if (ids.length !== input.items.length) throw new AccountingRuleError(422, "REMITTANCE_DUPLICATE", "Una factura aparece dos veces en la remesa.");

  return db.transaction(async (tx) => {
    const [account] = await tx
      .select({ id: bankAccount.id, iban: bankAccount.iban, bic: bankAccount.bic, isActive: bankAccount.isActive })
      .from(bankAccount)
      .where(and(eq(bankAccount.id, input.bankAccountId), eq(bankAccount.companyId, actor.companyId)))
      .limit(1);
    if (!account) throw new AccountingRuleError(404, "BANK_ACCOUNT_NOT_FOUND", "Cuenta bancaria no encontrada.");
    if (!account.isActive) throw new AccountingRuleError(409, "BANK_ACCOUNT_ARCHIVED", "La cuenta bancaria está archivada.");
    const [owner] = await tx
      .select({ name: company.name, legalName: company.legalName, sepaCreditorId: company.sepaCreditorId })
      .from(company)
      .where(eq(company.id, actor.companyId))
      .limit(1);
    const creditor = checkCreditorId(owner?.sepaCreditorId);
    if (!creditor.valid) {
      throw new AccountingRuleError(422, "CREDITOR_ID_MISSING", "Falta tu identificador de acreedor SEPA (o no es válido). Te lo da tu banco al contratar las remesas de recibos: añádelo en Ajustes › Empresa.");
    }

    const invoices = await tx
      .select({
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        issuedAt: invoice.issuedAt,
        invoiceType: invoice.invoiceType,
        totalAmount: invoice.totalAmount,
        customerId: invoice.customerId,
        customerName: customer.name,
      })
      .from(invoice)
      .innerJoin(customer, eq(customer.id, invoice.customerId))
      .where(and(eq(invoice.companyId, actor.companyId), inArray(invoice.id, ids)))
      .for("update", { of: invoice });
    const byId = new Map(invoices.map((row) => [row.id, row]));
    const pending = await pendingUsesByMandate(tx, actor.companyId);
    const queued = ids.map((id) => pending.queued.get(id)).find(Boolean);
    if (queued) throw new AccountingRuleError(409, "REMITTANCE_QUEUED", `Alguna factura ya está en la remesa ${queued}, pendiente de cobrar.`);

    const customerIds = [...new Set(invoices.map((row) => row.customerId))];
    const mandates = customerIds.length
      ? await tx
        .select({
          id: sepaMandate.id,
          customerId: sepaMandate.customerId,
          mandateReference: sepaMandate.mandateReference,
          signatureDate: sepaMandate.signatureDate,
          iban: sepaMandate.iban,
          bic: sepaMandate.bic,
          mandateType: sepaMandate.mandateType,
          status: sepaMandate.status,
          collectionCount: sepaMandate.collectionCount,
          lastCollectionAt: sepaMandate.lastCollectionAt,
        })
        .from(sepaMandate)
        .where(and(eq(sepaMandate.companyId, actor.companyId), inArray(sepaMandate.customerId, customerIds), eq(sepaMandate.status, "ACTIVE")))
        .orderBy(desc(sepaMandate.signatureDate), desc(sepaMandate.createdAt))
        .for("update")
      : [];
    const mandateByCustomer = new Map<string, (typeof mandates)[number]>();
    for (const mandate of mandates) if (!mandateByCustomer.has(mandate.customerId)) mandateByCustomer.set(mandate.customerId, mandate);

    const number = remittanceNumber(now);
    const usesInFile = new Map<string, number>();
    const prepared: Array<{ row: (typeof invoices)[number]; mandate: (typeof mandates)[number]; amount: number; sequenceType: SequenceType; endToEndId: string; remittanceInformation: string }> = [];
    for (const [index, item] of input.items.entries()) {
      const row = byId.get(item.invoiceId);
      if (!row) throw new AccountingRuleError(404, "INVOICE_NOT_FOUND", "Una de las facturas no existe.");
      const lifecycle = invoiceLifecycle(row);
      if (lifecycle !== "ISSUED" || row.invoiceType !== "INVOICE") throw new AccountingRuleError(409, "INVOICE_NOT_COLLECTABLE", `La factura ${row.number} no está emitida o no se puede cobrar.`);
      const mandate = mandateByCustomer.get(row.customerId);
      if (!mandate) throw new AccountingRuleError(422, "MANDATE_MISSING", `${row.customerName} no tiene un mandato SEPA activo: añádelo en su ficha de cliente.`);
      const uses = (pending.uses.get(mandate.id) ?? 0) + (usesInFile.get(mandate.id) ?? 0);
      const problem = mandateUnusableReason(mandate, input.collectionDate, uses);
      if (problem) throw new AccountingRuleError(422, "MANDATE_UNUSABLE", `${row.customerName} (mandato ${mandate.mandateReference}): ${problem}`);
      const balance = await getInvoiceBalance(tx, actor.companyId, row.id, row.totalAmount);
      const cents = toCents(item.amount);
      if (cents <= 0 || cents > balance.outstandingCents) {
        throw new AccountingRuleError(422, "REMITTANCE_AMOUNT", `El importe de la factura ${row.number} debe estar entre 0,01 y lo pendiente (${(balance.outstandingCents / 100).toFixed(2)}).`);
      }
      usesInFile.set(mandate.id, (usesInFile.get(mandate.id) ?? 0) + 1);
      prepared.push({
        row,
        mandate,
        amount: cents / 100,
        sequenceType: nextSequenceType(mandate, uses),
        endToEndId: `${number}-${index + 1}`,
        remittanceInformation: `Factura ${row.number}`,
      });
    }

    const pain: Pain008Input = {
      messageId: number,
      createdAt: now,
      collectionDate: input.collectionDate,
      creditor: { name: owner?.legalName || owner?.name || "Empresa", creditorId: creditor.creditorId, iban: account.iban, bic: account.bic },
      debits: prepared.map((item) => ({
        endToEndId: item.endToEndId,
        amount: item.amount,
        sequenceType: item.sequenceType,
        mandateReference: item.mandate.mandateReference,
        mandateSignatureDate: item.mandate.signatureDate,
        debtorName: item.row.customerName,
        debtorIban: item.mandate.iban,
        debtorBic: item.mandate.bic,
        remittanceInformation: item.remittanceInformation,
      })),
    };
    const errors = validatePain008Input(pain);
    if (errors.length > 0) throw new AccountingRuleError(422, "REMITTANCE_INVALID", errors.join(" "));
    const xml = buildPain008(pain);
    const totalCents = prepared.reduce((sum, item) => sum + toCents(item.amount), 0);

    const [created] = await tx
      .insert(sepaDirectDebitRemittance)
      .values({
        companyId: actor.companyId,
        bankAccountId: account.id,
        number,
        status: "GENERATED",
        collectionDate: input.collectionDate,
        creditorId: creditor.creditorId,
        totalAmount: (totalCents / 100).toFixed(2),
        itemCount: prepared.length,
        xml,
        createdByUserId: actor.actorUserId,
      })
      .returning({ id: sepaDirectDebitRemittance.id, number: sepaDirectDebitRemittance.number });
    await tx.insert(sepaDirectDebitItem).values(prepared.map((item) => ({
      companyId: actor.companyId,
      remittanceId: created.id,
      invoiceId: item.row.id,
      customerId: item.row.customerId,
      mandateId: item.mandate.id,
      debtorName: item.row.customerName,
      debtorIban: item.mandate.iban,
      debtorBic: item.mandate.bic,
      amount: item.amount.toFixed(2),
      endToEndId: item.endToEndId,
      sequenceType: item.sequenceType,
      remittanceInformation: item.remittanceInformation,
    })));
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "treasury.direct_debit.create",
      entityName: "sepaDirectDebitRemittance",
      entityId: created.id,
      payload: { number, bankAccountId: account.id, total: (totalCents / 100).toFixed(2), items: prepared.length, collectionDate: input.collectionDate.toISOString().slice(0, 10) },
    }, tx);
    return created;
  });
}

async function updateMandateCounters(client: DbClient, companyId: string, mandateId: string, sequenceType: SequenceType, direction: 1 | -1, collectionDate: Date, now: Date) {
  const [mandate] = await client
    .select({ collectionCount: sepaMandate.collectionCount, firstCollectionAt: sepaMandate.firstCollectionAt, lastCollectionAt: sepaMandate.lastCollectionAt, status: sepaMandate.status })
    .from(sepaMandate)
    .where(and(eq(sepaMandate.companyId, companyId), eq(sepaMandate.id, mandateId)))
    .for("update")
    .limit(1);
  if (!mandate) return;
  const next = mandateAfterCollection(mandate, sequenceType, direction, collectionDate, now);
  await client
    .update(sepaMandate)
    .set({ ...next, updatedAt: now })
    .where(and(eq(sepaMandate.companyId, companyId), eq(sepaMandate.id, mandateId)));
}

async function lockRemittance(client: DbClient, companyId: string, id: string) {
  const [remittance] = await client
    .select({
      id: sepaDirectDebitRemittance.id,
      number: sepaDirectDebitRemittance.number,
      status: sepaDirectDebitRemittance.status,
      bankAccountId: sepaDirectDebitRemittance.bankAccountId,
      collectionDate: sepaDirectDebitRemittance.collectionDate,
    })
    .from(sepaDirectDebitRemittance)
    .where(and(eq(sepaDirectDebitRemittance.companyId, companyId), eq(sepaDirectDebitRemittance.id, id)))
    .for("update")
    .limit(1);
  if (!remittance) throw new AccountingRuleError(404, "REMITTANCE_NOT_FOUND", "Remesa no encontrada.");
  return remittance;
}

/** "Remesa cobrada": registra un cobro por recibo con la fecha de cobro y actualiza los mandatos. */
export async function markDirectDebitCollected(actor: TreasuryActor, id: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const remittance = await lockRemittance(tx, actor.companyId, id);
    if (remittance.status !== "GENERATED") throw new AccountingRuleError(409, "REMITTANCE_STATUS", "Solo se puede marcar como cobrada una remesa generada y pendiente.");
    const postedAt = await resolveOpenPostingDate(actor.companyId, remittance.collectionDate, now, tx);
    const items = await tx
      .select({ id: sepaDirectDebitItem.id, invoiceId: sepaDirectDebitItem.invoiceId, mandateId: sepaDirectDebitItem.mandateId, amount: sepaDirectDebitItem.amount, endToEndId: sepaDirectDebitItem.endToEndId, sequenceType: sepaDirectDebitItem.sequenceType })
      .from(sepaDirectDebitItem)
      .where(and(eq(sepaDirectDebitItem.companyId, actor.companyId), eq(sepaDirectDebitItem.remittanceId, remittance.id), eq(sepaDirectDebitItem.status, "PENDING")));
    for (const item of items) {
      const created = await createCustomerPaymentForBank(tx, actor, {
        invoiceId: item.invoiceId,
        amount: Number(item.amount),
        postedAt,
        bankAccountId: remittance.bankAccountId,
        reference: `Remesa ${remittance.number} · ${item.endToEndId}`,
        origin: "sepa",
      });
      await tx.update(sepaDirectDebitItem).set({ status: "COLLECTED", paymentId: created.paymentId }).where(eq(sepaDirectDebitItem.id, item.id));
      await updateMandateCounters(tx, actor.companyId, item.mandateId, item.sequenceType as SequenceType, 1, remittance.collectionDate, now);
    }
    await tx.update(sepaDirectDebitRemittance).set({ status: "COLLECTED", collectedAt: now }).where(eq(sepaDirectDebitRemittance.id, remittance.id));
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "treasury.direct_debit.collect",
      entityName: "sepaDirectDebitRemittance",
      entityId: remittance.id,
      payload: { number: remittance.number, postedAt, payments: items.length },
    }, tx);
    return { id: remittance.id, payments: items.length };
  });
}

/** ¿Algún cobro (invoicePayment de esos pagos) está conciliado con un movimiento del banco? */
async function anyPaymentReconciled(client: DbClient, companyId: string, paymentIds: string[]) {
  if (paymentIds.length === 0) return false;
  const applications = await client
    .select({ id: invoicePayment.id })
    .from(invoicePayment)
    .where(and(eq(invoicePayment.companyId, companyId), inArray(invoicePayment.paymentId, paymentIds)));
  const applicationIds = applications.map((row) => row.id);
  if (applicationIds.length === 0) return false;
  const [allocated] = await client
    .select({ id: bankTransactionAllocation.id })
    .from(bankTransactionAllocation)
    .where(and(eq(bankTransactionAllocation.companyId, companyId), inArray(bankTransactionAllocation.invoicePaymentId, applicationIds)))
    .limit(1);
  const [matched] = await client
    .select({ id: bankTransaction.id })
    .from(bankTransaction)
    .where(inArray(bankTransaction.matchedInvoicePaymentId, applicationIds))
    .limit(1);
  return Boolean(allocated || matched);
}

/** Deshace "Remesa cobrada": borra los cobros (si ninguno está conciliado ni devuelto) y vuelve a "generada". */
export async function undoDirectDebitCollection(actor: TreasuryActor, id: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const remittance = await lockRemittance(tx, actor.companyId, id);
    if (remittance.status !== "COLLECTED") throw new AccountingRuleError(409, "REMITTANCE_STATUS", "La remesa no está marcada como cobrada.");
    const items = await tx
      .select({ id: sepaDirectDebitItem.id, status: sepaDirectDebitItem.status, paymentId: sepaDirectDebitItem.paymentId, mandateId: sepaDirectDebitItem.mandateId, sequenceType: sepaDirectDebitItem.sequenceType })
      .from(sepaDirectDebitItem)
      .where(and(eq(sepaDirectDebitItem.companyId, actor.companyId), eq(sepaDirectDebitItem.remittanceId, remittance.id)));
    if (items.some((item) => item.status === "RETURNED")) {
      throw new AccountingRuleError(409, "REMITTANCE_HAS_RETURNS", "La remesa tiene recibos devueltos: ya no se puede deshacer el cobro completo.");
    }
    const paymentIds = items.map((item) => item.paymentId).filter((value): value is string => Boolean(value));
    if (await anyPaymentReconciled(tx, actor.companyId, paymentIds)) {
      throw new AccountingRuleError(409, "REMITTANCE_RECONCILED", "Algún cobro de la remesa ya está conciliado con el banco. Deshaz primero esa conciliación.");
    }
    for (const item of items) {
      if (item.paymentId) await removeInvoicePayment(actor, item.paymentId, { origin: "sepa.undo", reason: `Remesa ${remittance.number} marcada como no cobrada` }, tx);
      if (item.status === "COLLECTED") await updateMandateCounters(tx, actor.companyId, item.mandateId, item.sequenceType as SequenceType, -1, remittance.collectionDate, now);
    }
    await tx.update(sepaDirectDebitItem).set({ status: "PENDING", paymentId: null }).where(eq(sepaDirectDebitItem.remittanceId, remittance.id));
    await tx.update(sepaDirectDebitRemittance).set({ status: "GENERATED", collectedAt: null }).where(eq(sepaDirectDebitRemittance.id, remittance.id));
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "treasury.direct_debit.uncollect",
      entityName: "sepaDirectDebitRemittance",
      entityId: remittance.id,
      payload: { number: remittance.number, removedPayments: paymentIds.length },
    }, tx);
    return { id: remittance.id, removedPayments: paymentIds.length };
  });
}

export async function cancelDirectDebitRemittance(actor: Actor, id: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(sepaDirectDebitRemittance)
      .set({ status: "CANCELLED", cancelledAt: now })
      .where(and(eq(sepaDirectDebitRemittance.companyId, actor.companyId), eq(sepaDirectDebitRemittance.id, id), eq(sepaDirectDebitRemittance.status, "GENERATED")))
      .returning({ id: sepaDirectDebitRemittance.id, number: sepaDirectDebitRemittance.number });
    if (!updated) throw new AccountingRuleError(409, "REMITTANCE_STATUS", "Solo se puede descartar una remesa generada y sin cobrar.");
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "treasury.direct_debit.cancel",
      entityName: "sepaDirectDebitRemittance",
      entityId: updated.id,
      payload: { number: updated.number },
    }, tx);
    return updated;
  });
}

async function lockItem(client: DbClient, companyId: string, itemId: string) {
  const [item] = await client
    .select({
      id: sepaDirectDebitItem.id,
      remittanceId: sepaDirectDebitItem.remittanceId,
      invoiceId: sepaDirectDebitItem.invoiceId,
      mandateId: sepaDirectDebitItem.mandateId,
      amount: sepaDirectDebitItem.amount,
      endToEndId: sepaDirectDebitItem.endToEndId,
      sequenceType: sepaDirectDebitItem.sequenceType,
      status: sepaDirectDebitItem.status,
      paymentId: sepaDirectDebitItem.paymentId,
      returnBankTransactionId: sepaDirectDebitItem.returnBankTransactionId,
      remittanceNumber: sepaDirectDebitRemittance.number,
      remittanceStatus: sepaDirectDebitRemittance.status,
      bankAccountId: sepaDirectDebitRemittance.bankAccountId,
      collectionDate: sepaDirectDebitRemittance.collectionDate,
    })
    .from(sepaDirectDebitItem)
    .innerJoin(sepaDirectDebitRemittance, eq(sepaDirectDebitRemittance.id, sepaDirectDebitItem.remittanceId))
    .where(and(eq(sepaDirectDebitItem.companyId, companyId), eq(sepaDirectDebitItem.id, itemId)))
    .for("update", { of: sepaDirectDebitItem })
    .limit(1);
  if (!item) throw new AccountingRuleError(404, "ITEM_NOT_FOUND", "Recibo no encontrado.");
  return item;
}

/** Cuenta de gastos para la comisión de devolución: la elegida o la primera 626 imputable. */
async function resolveFeeAccount(client: DbClient, companyId: string, feeAccountId?: string | null) {
  const [account] = await client
    .select({ id: accountChart.id, code: accountChart.code })
    .from(accountChart)
    .where(and(
      eq(accountChart.companyId, companyId),
      eq(accountChart.isPostable, true),
      feeAccountId ? eq(accountChart.id, feeAccountId) : sql`${accountChart.code} like '626%'`,
    ))
    .orderBy(asc(accountChart.code))
    .limit(1);
  if (!account) {
    throw new AccountingRuleError(422, "FEE_ACCOUNT", feeAccountId ? "La cuenta de la comisión no existe o no admite apuntes." : "No hay ninguna cuenta 626 (servicios bancarios): elige la cuenta de la comisión.");
  }
  return account;
}

/**
 * Concilia el cargo de la devolución con el recibo devuelto: revierte su apunte provisional
 * (Banco ↔ 555), porque el efecto en el banco ya lo lleva la anulación del cobro, y lleva la
 * comisión (lo que exceda del recibo) a la cuenta de gastos elegida.
 */
async function linkReturnMovementInTx(
  client: DbClient,
  actor: Actor,
  item: Awaited<ReturnType<typeof lockItem>>,
  input: { bankTransactionId: string; feeAccountId?: string | null; now: Date },
) {
  const [movement] = await client
    .select({ id: bankTransaction.id, bankAccountId: bankTransaction.bankAccountId, amount: bankTransaction.amount, description: bankTransaction.description, postedAt: bankTransaction.postedAt, status: bankTransaction.reconciliationStatus })
    .from(bankTransaction)
    .innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.bankAccountId))
    .where(and(eq(bankTransaction.id, input.bankTransactionId), eq(bankAccount.companyId, actor.companyId)))
    .for("update", { of: bankTransaction })
    .limit(1);
  if (!movement) throw new AccountingRuleError(404, "BANK_TRANSACTION_NOT_FOUND", "Movimiento no encontrado.");
  if (movement.status !== "PENDING") throw new AccountingRuleError(409, "ALREADY_RECONCILED", "Ese movimiento ya está conciliado.");
  if (movement.bankAccountId !== item.bankAccountId) throw new AccountingRuleError(422, "RETURN_BANK", "El cargo de la devolución debe estar en la cuenta de abono de la remesa.");
  const movementCents = toCents(movement.amount);
  const itemCents = toCents(item.amount);
  if (movementCents >= 0 || -movementCents < itemCents) {
    throw new AccountingRuleError(422, "RETURN_AMOUNT", `El cargo de la devolución debe ser de al menos ${(itemCents / 100).toFixed(2)} (el recibo más la comisión, si la hay).`);
  }
  const feeCents = -movementCents - itemCents;
  const feeAccount = feeCents > 0 ? await resolveFeeAccount(client, actor.companyId, input.feeAccountId) : null;
  const postingDate = await resolveOpenPostingDate(actor.companyId, movement.postedAt, input.now, client);
  await reverseAutomaticEntries({
    tenantId: actor.tenantId,
    companyId: actor.companyId,
    actorUserId: actor.actorUserId,
    postedAt: postingDate,
    reference: `Devolución recibo ${item.endToEndId}`.slice(0, 200),
    sourceType: "bankTransaction",
    sourceId: movement.id,
    reason: "Cargo identificado como devolución de un recibo domiciliado",
    dbClient: client,
  });
  if (feeAccount) {
    await postBankTransactionAssignment({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      postedAt: postingDate,
      reference: `Comisión devolución recibo ${item.endToEndId}`.slice(0, 200),
      bankTransactionId: movement.id,
      bankAccountId: movement.bankAccountId,
      movementAmount: Number(movement.amount),
      allocations: [{ accountId: feeAccount.id, amount: feeCents / 100 }],
      dbClient: client,
    });
    await client.insert(bankTransactionAllocation).values({
      companyId: actor.companyId,
      bankTransactionId: movement.id,
      kind: "ACCOUNT",
      accountId: feeAccount.id,
      amount: (feeCents / 100).toFixed(2),
    });
  }
  await client
    .update(bankTransaction)
    .set({ reconciliationStatus: "RECONCILED", reconciledAt: input.now, resolution: feeAccount ? "MIXED" : "PAYMENT", matchedInvoicePaymentId: null, matchedSupplierPaymentId: null })
    .where(eq(bankTransaction.id, movement.id));
  await client
    .update(sepaDirectDebitItem)
    .set({ returnBankTransactionId: movement.id, returnFeeAmount: (feeCents / 100).toFixed(2) })
    .where(eq(sepaDirectDebitItem.id, item.id));
  return { bankTransactionId: movement.id, fee: feeCents / 100, feeAccountCode: feeAccount?.code ?? null };
}

/**
 * Devolución de un recibo: anula su cobro con fecha de la devolución (Banco → 430: la factura
 * vuelve a pendiente), deshace el uso del mandato (un FRST devuelto vuelve a ser FRST) y, si se
 * indica el cargo del extracto, lo concilia asignando la comisión.
 */
export async function returnDirectDebitItem(
  actor: TreasuryActor,
  itemId: string,
  input: { returnedAt: Date; reason?: string | null; bankTransactionId?: string | null; feeAccountId?: string | null; now?: Date },
) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const item = await lockItem(tx, actor.companyId, itemId);
    if (item.status !== "COLLECTED" || !item.paymentId) throw new AccountingRuleError(409, "ITEM_STATUS", "Solo se puede devolver un recibo cobrado.");
    const postedAt = await resolveOpenPostingDate(actor.companyId, input.returnedAt, now, tx);
    await removeInvoicePayment(actor, item.paymentId, { postedAt, origin: "sepa.return", reason: `Devolución del recibo ${item.endToEndId}${input.reason ? `: ${input.reason}` : ""}`.slice(0, 250) }, tx);
    await updateMandateCounters(tx, actor.companyId, item.mandateId, item.sequenceType as SequenceType, -1, item.collectionDate, now);
    await tx
      .update(sepaDirectDebitItem)
      .set({ status: "RETURNED", paymentId: null, returnedAt: input.returnedAt, returnReason: input.reason?.trim().slice(0, 250) || null })
      .where(eq(sepaDirectDebitItem.id, item.id));
    const link = input.bankTransactionId ? await linkReturnMovementInTx(tx, actor, item, { bankTransactionId: input.bankTransactionId, feeAccountId: input.feeAccountId, now }) : null;
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "treasury.direct_debit.return",
      entityName: "sepaDirectDebitItem",
      entityId: item.id,
      payload: { remittance: item.remittanceNumber, endToEndId: item.endToEndId, invoiceId: item.invoiceId, reason: input.reason ?? null, returnedAt: input.returnedAt.toISOString().slice(0, 10), link },
    }, tx);
    return { id: item.id, link };
  });
}

/** Vincula después el cargo de una devolución ya registrada (cuando llega al extracto). */
export async function linkDirectDebitReturnMovement(actor: TreasuryActor, itemId: string, input: { bankTransactionId: string; feeAccountId?: string | null; now?: Date }) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const item = await lockItem(tx, actor.companyId, itemId);
    if (item.status !== "RETURNED") throw new AccountingRuleError(409, "ITEM_STATUS", "Primero marca el recibo como devuelto.");
    if (item.returnBankTransactionId) throw new AccountingRuleError(409, "ITEM_LINKED", "Este recibo ya tiene vinculado el cargo de la devolución.");
    const link = await linkReturnMovementInTx(tx, actor, item, { bankTransactionId: input.bankTransactionId, feeAccountId: input.feeAccountId, now });
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "treasury.direct_debit.return_link",
      entityName: "sepaDirectDebitItem",
      entityId: item.id,
      payload: link,
    }, tx);
    return { id: item.id, link };
  });
}

/** Cargos pendientes de la cuenta de la remesa que pueden ser la devolución del recibo. */
export async function listReturnCandidates(companyId: string, itemId: string) {
  const [item] = await db
    .select({ amount: sepaDirectDebitItem.amount, bankAccountId: sepaDirectDebitRemittance.bankAccountId, collectionDate: sepaDirectDebitRemittance.collectionDate })
    .from(sepaDirectDebitItem)
    .innerJoin(sepaDirectDebitRemittance, eq(sepaDirectDebitRemittance.id, sepaDirectDebitItem.remittanceId))
    .where(and(eq(sepaDirectDebitItem.companyId, companyId), eq(sepaDirectDebitItem.id, itemId)))
    .limit(1);
  if (!item) return [];
  const from = new Date(item.collectionDate.getTime() - 3 * 86_400_000);
  const to = new Date(item.collectionDate.getTime() + 90 * 86_400_000);
  return db
    .select({ id: bankTransaction.id, amount: bankTransaction.amount, description: bankTransaction.description, postedAt: bankTransaction.postedAt })
    .from(bankTransaction)
    .where(and(
      eq(bankTransaction.bankAccountId, item.bankAccountId),
      eq(bankTransaction.reconciliationStatus, "PENDING"),
      lte(bankTransaction.amount, (-Number(item.amount)).toFixed(2)),
      gte(bankTransaction.postedAt, from),
      lte(bankTransaction.postedAt, to),
    ))
    .orderBy(asc(bankTransaction.postedAt), asc(bankTransaction.id))
    .limit(20);
}

/** ¿El movimiento es el cargo de una devolución de recibo? (su deshacer va por la remesa). */
export async function returnedItemForMovement(client: DbClient, companyId: string, bankTransactionId: string) {
  const [row] = await client
    .select({ id: sepaDirectDebitItem.id, remittanceId: sepaDirectDebitItem.remittanceId, endToEndId: sepaDirectDebitItem.endToEndId })
    .from(sepaDirectDebitItem)
    .where(and(eq(sepaDirectDebitItem.companyId, companyId), eq(sepaDirectDebitItem.returnBankTransactionId, bankTransactionId)))
    .limit(1);
  return row ?? null;
}
