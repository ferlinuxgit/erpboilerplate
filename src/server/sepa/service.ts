import { and, desc, eq, inArray, sql } from "drizzle-orm";

import {
  bankAccount,
  bankTransaction,
  bankTransactionAllocation,
  company,
  partner,
  partnerBankAccount,
  sepaRemittance,
  sepaRemittanceItem,
  supplierInvoice,
  supplierInvoicePayment,
} from "@/db/schema";
import { checkIban, isValidBic, normalizeBic, normalizeIban } from "@/lib/bank-import/iban";
import { db } from "@/lib/db";
import { AccountingRuleError } from "@/server/accounting/errors";
import { toCents } from "@/server/accounting/money";
import { recordAudit } from "@/server/audit";
import { resolveOpenPostingDate } from "@/server/fiscal/locks";
import { buildPain001, validatePain001Input, type Pain001Input } from "@/server/sepa/pain001";
import { createSupplierPaymentForBank, removeTreasurySupplierPayment, type TreasuryActor } from "@/server/treasury/bank-payments";
import { listOpenSupplierInvoices } from "@/server/treasury/workbench";

/*
 * Remesas SEPA de pagos a proveedores:
 * 1. Se eligen facturas pendientes y la cuenta de cargo → se genera el fichero pain.001 y se
 *    guarda la remesa (GENERATED). Todavía no se registra ningún pago.
 * 2. Cuando el usuario confirma "Remesa enviada/cargada" se registra un pago por factura
 *    (Banco ↔ 400, en la subcuenta del banco de la remesa) con la fecha de ejecución (CONFIRMED).
 *    El cargo del extracto se concilia después con la propuesta "Remesa SEPA".
 * 3. La confirmación se puede deshacer mientras sus pagos no estén conciliados con el banco.
 */

export type RemittanceItemInput = { supplierInvoiceId: string; amount: number; iban: string; bic?: string | null };

/** Facturas de proveedor pendientes que no están ya en una remesa generada, con el IBAN recordado. */
export async function listRemittableSupplierInvoices(companyId: string) {
  const [open, inRemittance, ibans] = await Promise.all([
    listOpenSupplierInvoices(companyId, 1000),
    db
      .select({ supplierInvoiceId: sepaRemittanceItem.supplierInvoiceId, number: sepaRemittance.number })
      .from(sepaRemittanceItem)
      .innerJoin(sepaRemittance, eq(sepaRemittance.id, sepaRemittanceItem.remittanceId))
      .where(and(eq(sepaRemittanceItem.companyId, companyId), eq(sepaRemittance.status, "GENERATED"))),
    db
      .select({ partnerId: partnerBankAccount.partnerId, iban: partnerBankAccount.iban, bic: partnerBankAccount.bic })
      .from(partnerBankAccount)
      .where(and(eq(partnerBankAccount.companyId, companyId), eq(partnerBankAccount.isDefault, true)))
      .orderBy(desc(partnerBankAccount.updatedAt)),
  ]);
  const pending = new Map(inRemittance.map((row) => [row.supplierInvoiceId, row.number]));
  const ibanByPartner = new Map<string, { iban: string; bic: string | null }>();
  for (const row of ibans) if (!ibanByPartner.has(row.partnerId)) ibanByPartner.set(row.partnerId, { iban: row.iban, bic: row.bic });
  return open.map((row) => ({
    ...row,
    pendingRemittance: pending.get(row.id) ?? null,
    iban: row.partnerId ? ibanByPartner.get(row.partnerId)?.iban ?? null : null,
    bic: row.partnerId ? ibanByPartner.get(row.partnerId)?.bic ?? null : null,
  }));
}

export async function listRemittances(companyId: string) {
  return db
    .select({
      id: sepaRemittance.id,
      number: sepaRemittance.number,
      status: sepaRemittance.status,
      executionDate: sepaRemittance.executionDate,
      totalAmount: sepaRemittance.totalAmount,
      itemCount: sepaRemittance.itemCount,
      createdAt: sepaRemittance.createdAt,
      confirmedAt: sepaRemittance.confirmedAt,
      bankName: bankAccount.bankName,
      iban: bankAccount.iban,
    })
    .from(sepaRemittance)
    .innerJoin(bankAccount, eq(bankAccount.id, sepaRemittance.bankAccountId))
    .where(eq(sepaRemittance.companyId, companyId))
    .orderBy(desc(sepaRemittance.createdAt), desc(sepaRemittance.id))
    .limit(200);
}

export async function getRemittance(companyId: string, id: string) {
  const [remittance] = await db
    .select({
      id: sepaRemittance.id,
      number: sepaRemittance.number,
      status: sepaRemittance.status,
      executionDate: sepaRemittance.executionDate,
      totalAmount: sepaRemittance.totalAmount,
      itemCount: sepaRemittance.itemCount,
      xml: sepaRemittance.xml,
      createdAt: sepaRemittance.createdAt,
      confirmedAt: sepaRemittance.confirmedAt,
      cancelledAt: sepaRemittance.cancelledAt,
      bankAccountId: sepaRemittance.bankAccountId,
      bankName: bankAccount.bankName,
      iban: bankAccount.iban,
    })
    .from(sepaRemittance)
    .innerJoin(bankAccount, eq(bankAccount.id, sepaRemittance.bankAccountId))
    .where(and(eq(sepaRemittance.companyId, companyId), eq(sepaRemittance.id, id)))
    .limit(1);
  if (!remittance) return null;
  const items = await db
    .select({
      id: sepaRemittanceItem.id,
      supplierInvoiceId: sepaRemittanceItem.supplierInvoiceId,
      invoiceNumber: supplierInvoice.number,
      invoiceOrigin: supplierInvoice.origin,
      creditorName: sepaRemittanceItem.creditorName,
      creditorIban: sepaRemittanceItem.creditorIban,
      amount: sepaRemittanceItem.amount,
      endToEndId: sepaRemittanceItem.endToEndId,
      supplierPaymentId: sepaRemittanceItem.supplierPaymentId,
    })
    .from(sepaRemittanceItem)
    .innerJoin(supplierInvoice, eq(supplierInvoice.id, sepaRemittanceItem.supplierInvoiceId))
    .where(and(eq(sepaRemittanceItem.companyId, companyId), eq(sepaRemittanceItem.remittanceId, id)))
    .orderBy(sepaRemittanceItem.creditorName, sepaRemittanceItem.id);
  return { ...remittance, items };
}

function remittanceNumber(now: Date) {
  const stamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `REM${stamp}${crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}

export async function createRemittance(
  actor: Omit<TreasuryActor, "activeFiscalYearId">,
  input: { bankAccountId: string; executionDate: Date; items: RemittanceItemInput[]; now?: Date },
) {
  if (input.items.length === 0) throw new AccountingRuleError(422, "REMITTANCE_EMPTY", "Selecciona al menos una factura.");
  if (input.items.length > 500) throw new AccountingRuleError(422, "REMITTANCE_TOO_BIG", "Una remesa admite como máximo 500 pagos.");
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [account] = await tx
      .select({ id: bankAccount.id, iban: bankAccount.iban, bic: bankAccount.bic, isActive: bankAccount.isActive })
      .from(bankAccount)
      .where(and(eq(bankAccount.id, input.bankAccountId), eq(bankAccount.companyId, actor.companyId)))
      .limit(1);
    if (!account) throw new AccountingRuleError(404, "BANK_ACCOUNT_NOT_FOUND", "Cuenta bancaria no encontrada.");
    if (!account.isActive) throw new AccountingRuleError(409, "BANK_ACCOUNT_ARCHIVED", "La cuenta bancaria está archivada.");
    const [owner] = await tx
      .select({ name: company.name, legalName: company.legalName, vatNumber: company.vatNumber })
      .from(company)
      .where(eq(company.id, actor.companyId))
      .limit(1);

    const ids = [...new Set(input.items.map((item) => item.supplierInvoiceId))];
    if (ids.length !== input.items.length) throw new AccountingRuleError(422, "REMITTANCE_DUPLICATE", "Una factura aparece dos veces en la remesa.");
    const invoices = await tx
      .select({
        id: supplierInvoice.id,
        number: supplierInvoice.number,
        supplierDocumentNumber: supplierInvoice.supplierDocumentNumber,
        supplierPartnerId: supplierInvoice.supplierPartnerId,
        status: supplierInvoice.status,
        totalAmount: supplierInvoice.totalAmount,
        paid: sql<string>`coalesce((select sum(${supplierInvoicePayment.amountApplied}) from ${supplierInvoicePayment} where ${supplierInvoicePayment.supplierInvoiceId} = ${supplierInvoice.id}), 0)`,
        partnerName: partner.name,
      })
      .from(supplierInvoice)
      .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
      .where(and(eq(supplierInvoice.companyId, actor.companyId), inArray(supplierInvoice.id, ids)))
      .for("update", { of: supplierInvoice });
    const byId = new Map(invoices.map((row) => [row.id, row]));
    const alreadyQueued = await tx
      .select({ supplierInvoiceId: sepaRemittanceItem.supplierInvoiceId, number: sepaRemittance.number })
      .from(sepaRemittanceItem)
      .innerJoin(sepaRemittance, eq(sepaRemittance.id, sepaRemittanceItem.remittanceId))
      .where(and(eq(sepaRemittanceItem.companyId, actor.companyId), eq(sepaRemittance.status, "GENERATED"), inArray(sepaRemittanceItem.supplierInvoiceId, ids)));
    if (alreadyQueued.length > 0) {
      throw new AccountingRuleError(409, "REMITTANCE_QUEUED", `Alguna factura ya está en la remesa ${alreadyQueued[0].number}, pendiente de confirmar.`);
    }

    const number = remittanceNumber(now);
    const prepared = input.items.map((item, index) => {
      const row = byId.get(item.supplierInvoiceId);
      if (!row) throw new AccountingRuleError(404, "SUPPLIER_INVOICE_NOT_FOUND", "Una de las facturas no existe.");
      if (row.status === "VOID") throw new AccountingRuleError(409, "SUPPLIER_INVOICE_VOID", `La factura ${row.number} está anulada.`);
      const outstandingCents = Math.max(toCents(row.totalAmount) - toCents(row.paid), 0);
      const cents = toCents(item.amount);
      if (cents <= 0 || cents > outstandingCents) {
        throw new AccountingRuleError(422, "REMITTANCE_AMOUNT", `El importe de la factura ${row.number} debe estar entre 0,01 y lo pendiente (${(outstandingCents / 100).toFixed(2)}).`);
      }
      const iban = checkIban(item.iban);
      if (!iban.valid) throw new AccountingRuleError(422, "IBAN_INVALID", `IBAN de ${row.partnerName}: ${iban.reason}`);
      if (item.bic && !isValidBic(item.bic)) throw new AccountingRuleError(422, "BIC_INVALID", `El BIC de ${row.partnerName} no es válido.`);
      return {
        row,
        iban: iban.iban,
        bic: item.bic ? normalizeBic(item.bic) : null,
        amount: cents / 100,
        endToEndId: `${number}-${index + 1}`,
        remittanceInformation: `Factura ${row.supplierDocumentNumber || row.number}`,
      };
    });

    const pain: Pain001Input = {
      messageId: number,
      createdAt: now,
      executionDate: input.executionDate,
      debtor: { name: owner?.legalName || owner?.name || "Empresa", taxId: owner?.vatNumber ?? null, iban: account.iban, bic: account.bic },
      transfers: prepared.map((item) => ({
        endToEndId: item.endToEndId,
        amount: item.amount,
        creditorName: item.row.partnerName,
        creditorIban: item.iban,
        creditorBic: item.bic,
        remittanceInformation: item.remittanceInformation,
      })),
    };
    const errors = validatePain001Input(pain);
    if (errors.length > 0) throw new AccountingRuleError(422, "REMITTANCE_INVALID", errors.join(" "));
    const xml = buildPain001(pain);
    const totalCents = prepared.reduce((sum, item) => sum + toCents(item.amount), 0);

    const [created] = await tx
      .insert(sepaRemittance)
      .values({
        companyId: actor.companyId,
        bankAccountId: account.id,
        number,
        status: "GENERATED",
        executionDate: input.executionDate,
        totalAmount: (totalCents / 100).toFixed(2),
        itemCount: prepared.length,
        xml,
        createdByUserId: actor.actorUserId,
      })
      .returning({ id: sepaRemittance.id, number: sepaRemittance.number });
    await tx.insert(sepaRemittanceItem).values(prepared.map((item) => ({
      companyId: actor.companyId,
      remittanceId: created.id,
      supplierInvoiceId: item.row.id,
      supplierPartnerId: item.row.supplierPartnerId,
      creditorName: item.row.partnerName,
      creditorIban: item.iban,
      creditorBic: item.bic,
      amount: item.amount.toFixed(2),
      endToEndId: item.endToEndId,
      remittanceInformation: item.remittanceInformation,
    })));
    // Se recuerda el IBAN de cada proveedor para la próxima remesa.
    for (const item of prepared) {
      await tx
        .update(partnerBankAccount)
        .set({ isDefault: false, updatedAt: now })
        .where(and(eq(partnerBankAccount.companyId, actor.companyId), eq(partnerBankAccount.partnerId, item.row.supplierPartnerId)));
      await tx
        .insert(partnerBankAccount)
        .values({ companyId: actor.companyId, partnerId: item.row.supplierPartnerId, iban: normalizeIban(item.iban), bic: item.bic, isDefault: true })
        .onConflictDoUpdate({
          target: [partnerBankAccount.companyId, partnerBankAccount.partnerId, partnerBankAccount.iban],
          set: { bic: item.bic, isDefault: true, updatedAt: now },
        });
    }
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "treasury.remittance.create",
      entityName: "sepaRemittance",
      entityId: created.id,
      payload: { number, bankAccountId: account.id, total: (totalCents / 100).toFixed(2), items: prepared.length },
    }, tx);
    return created;
  });
}

/** "Remesa enviada/cargada": registra un pago por factura con la fecha de ejecución. */
export async function confirmRemittance(actor: TreasuryActor, id: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [remittance] = await tx
      .select({ id: sepaRemittance.id, number: sepaRemittance.number, status: sepaRemittance.status, bankAccountId: sepaRemittance.bankAccountId, executionDate: sepaRemittance.executionDate })
      .from(sepaRemittance)
      .where(and(eq(sepaRemittance.companyId, actor.companyId), eq(sepaRemittance.id, id)))
      .for("update")
      .limit(1);
    if (!remittance) throw new AccountingRuleError(404, "REMITTANCE_NOT_FOUND", "Remesa no encontrada.");
    if (remittance.status !== "GENERATED") throw new AccountingRuleError(409, "REMITTANCE_STATUS", "Solo se puede confirmar una remesa generada y pendiente.");
    const postedAt = await resolveOpenPostingDate(actor.companyId, remittance.executionDate, now, tx);
    const items = await tx
      .select({ id: sepaRemittanceItem.id, supplierInvoiceId: sepaRemittanceItem.supplierInvoiceId, amount: sepaRemittanceItem.amount, endToEndId: sepaRemittanceItem.endToEndId })
      .from(sepaRemittanceItem)
      .where(and(eq(sepaRemittanceItem.companyId, actor.companyId), eq(sepaRemittanceItem.remittanceId, remittance.id)));
    for (const item of items) {
      const created = await createSupplierPaymentForBank(tx, actor, {
        supplierInvoiceId: item.supplierInvoiceId,
        amount: Number(item.amount),
        postedAt,
        bankAccountId: remittance.bankAccountId,
        reference: `Remesa ${remittance.number} · ${item.endToEndId}`,
        notes: `Pago incluido en la remesa SEPA ${remittance.number}`,
      });
      await tx.update(sepaRemittanceItem).set({ supplierPaymentId: created.paymentId }).where(eq(sepaRemittanceItem.id, item.id));
    }
    await tx.update(sepaRemittance).set({ status: "CONFIRMED", confirmedAt: now }).where(eq(sepaRemittance.id, remittance.id));
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "treasury.remittance.confirm",
      entityName: "sepaRemittance",
      entityId: remittance.id,
      payload: { number: remittance.number, postedAt, payments: items.length },
    }, tx);
    return { id: remittance.id, payments: items.length };
  });
}

/** Deshace la confirmación: elimina los pagos (si ninguno está conciliado) y vuelve a "generada". */
export async function undoRemittanceConfirmation(actor: TreasuryActor, id: string) {
  return db.transaction(async (tx) => {
    const [remittance] = await tx
      .select({ id: sepaRemittance.id, number: sepaRemittance.number, status: sepaRemittance.status })
      .from(sepaRemittance)
      .where(and(eq(sepaRemittance.companyId, actor.companyId), eq(sepaRemittance.id, id)))
      .for("update")
      .limit(1);
    if (!remittance) throw new AccountingRuleError(404, "REMITTANCE_NOT_FOUND", "Remesa no encontrada.");
    if (remittance.status !== "CONFIRMED") throw new AccountingRuleError(409, "REMITTANCE_STATUS", "La remesa no está confirmada.");
    const items = await tx
      .select({ id: sepaRemittanceItem.id, supplierPaymentId: sepaRemittanceItem.supplierPaymentId })
      .from(sepaRemittanceItem)
      .where(and(eq(sepaRemittanceItem.companyId, actor.companyId), eq(sepaRemittanceItem.remittanceId, remittance.id)));
    const paymentIds = items.map((item) => item.supplierPaymentId).filter((value): value is string => Boolean(value));
    if (paymentIds.length > 0) {
      const applications = await tx
        .select({ id: supplierInvoicePayment.id })
        .from(supplierInvoicePayment)
        .where(and(eq(supplierInvoicePayment.companyId, actor.companyId), inArray(supplierInvoicePayment.supplierPaymentId, paymentIds)));
      const applicationIds = applications.map((row) => row.id);
      if (applicationIds.length > 0) {
        const [reconciled] = await tx
          .select({ id: bankTransactionAllocation.id })
          .from(bankTransactionAllocation)
          .where(and(eq(bankTransactionAllocation.companyId, actor.companyId), inArray(bankTransactionAllocation.supplierInvoicePaymentId, applicationIds)))
          .limit(1);
        const [matched] = await tx
          .select({ id: bankTransaction.id })
          .from(bankTransaction)
          .where(inArray(bankTransaction.matchedSupplierPaymentId, applicationIds))
          .limit(1);
        if (reconciled || matched) {
          throw new AccountingRuleError(409, "REMITTANCE_RECONCILED", "Algún pago de la remesa ya está conciliado con el banco. Deshaz primero esa conciliación.");
        }
      }
    }
    for (const paymentId of paymentIds) await removeTreasurySupplierPayment(tx, actor, paymentId);
    await tx.update(sepaRemittanceItem).set({ supplierPaymentId: null }).where(eq(sepaRemittanceItem.remittanceId, remittance.id));
    await tx.update(sepaRemittance).set({ status: "GENERATED", confirmedAt: null }).where(eq(sepaRemittance.id, remittance.id));
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "treasury.remittance.unconfirm",
      entityName: "sepaRemittance",
      entityId: remittance.id,
      payload: { number: remittance.number, removedPayments: paymentIds.length },
    }, tx);
    return { id: remittance.id, removedPayments: paymentIds.length };
  });
}

export async function cancelRemittance(actor: Omit<TreasuryActor, "activeFiscalYearId">, id: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(sepaRemittance)
      .set({ status: "CANCELLED", cancelledAt: now })
      .where(and(eq(sepaRemittance.companyId, actor.companyId), eq(sepaRemittance.id, id), eq(sepaRemittance.status, "GENERATED")))
      .returning({ id: sepaRemittance.id, number: sepaRemittance.number });
    if (!updated) throw new AccountingRuleError(409, "REMITTANCE_STATUS", "Solo se puede descartar una remesa generada y sin confirmar.");
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "treasury.remittance.cancel",
      entityName: "sepaRemittance",
      entityId: updated.id,
      payload: { number: updated.number },
    }, tx);
    return updated;
  });
}
