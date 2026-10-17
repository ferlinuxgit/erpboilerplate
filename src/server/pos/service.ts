import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";

import {
  bankAccount,
  customer,
  documentSeries,
  invoice,
  invoiceLine,
  invoiceLineTax,
  item,
  itemCategory,
  partner,
  payment,
  paymentMethod,
  posCashMovement,
  posRegister,
  posSession,
  posTicket,
  stockLocation,
  stockMovement,
  tax,
  user,
  warehouse,
} from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { HttpError } from "@/lib/http";
import { cartTotals, dailySales, exceedsSimplifiedLimit, expectedCash, remainingQuantities, splitRefund, validatePayment, type RefundMethod } from "@/modules/pos/model";
import { createAutomaticEntry, resolveBankLedgerAccountId } from "@/server/accounting/auto-post";
import { CASH_ACCOUNT_CODE, ensureSubaccount } from "@/server/accounting/subaccounts";
import { recordAudit } from "@/server/audit";
import { defaultSeriesFormat } from "@/lib/document-series-format";
import { findFiscalYearForDate } from "@/server/documents/series";
import { assertFiscalPeriodOpen } from "@/server/fiscal/locks";
import { assertItemsBelongToCompany } from "@/server/inventory/ownership";
import { refreshStockLocation } from "@/server/inventory/stock-location";
import { resolveInvoicePaymentMethods } from "@/server/invoices/payment-methods";
import { registerInvoicePayment, removeInvoicePayment } from "@/server/invoices/payments";
import { createCreditNote, createDraftInvoiceInTransaction, ensureCompanyDefaults, issueInvoiceInTransaction, loadStoredLines, resolveLineTaxes, type InvoiceActor } from "@/server/invoices/service";
import { isModuleEnabled } from "@/server/modules/service";
import { reservePartnerNumber } from "@/server/partners/numbers";
import { centsToNumber, computeEngineDocument, legacyLineTaxes, amountToCents } from "@/server/taxation/engine";
import { ensureCashPaymentMethod } from "@/server/treasury/cash-payment-method";
import { getInvoiceVerifactuInfo, getInvoiceVerifactuQrSvg } from "@/server/verifactu/service";

export type PosActor = InvoiceActor;

export const GENERIC_CUSTOMER_NAME = "Clientes varios (TPV)";

const money = (value: number) => (Math.round(value * 100) / 100).toFixed(2);
const num = (value: string | number | null | undefined) => Number(value ?? 0);

// ---------------------------------------------------------------------------------------------
// Cajas
// ---------------------------------------------------------------------------------------------

/** Cliente genérico de los tickets sin datos del cliente (factura simplificada, sin NIF). */
async function ensureGenericCustomer(client: DbClient, companyId: string, countryCode: string) {
  const [existing] = await client
    .select({ id: customer.id })
    .from(customer)
    .innerJoin(partner, eq(partner.id, customer.partnerId))
    .where(and(eq(customer.companyId, companyId), eq(customer.name, GENERIC_CUSTOMER_NAME), isNull(partner.taxId)))
    .limit(1);
  if (existing) return existing.id;
  const [createdPartner] = await client
    .insert(partner)
    .values({
      companyId,
      number: await reservePartnerNumber(client, companyId, "CUSTOMER"),
      type: "CUSTOMER",
      name: GENERIC_CUSTOMER_NAME,
      countryCode,
      paymentTermsDays: 0,
    })
    .returning({ id: partner.id });
  const [created] = await client
    .insert(customer)
    .values({ companyId, partnerId: createdPartner.id, name: GENERIC_CUSTOMER_NAME })
    .returning({ id: customer.id });
  return created.id;
}

/** Forma de pago «Tarjeta (TPV)» ligada al banco donde se abonan los cobros con tarjeta. */
async function ensureCardPaymentMethod(client: DbClient, companyId: string, bankAccountId: string) {
  const [bank] = await client
    .select({ id: bankAccount.id, name: bankAccount.bankName })
    .from(bankAccount)
    .where(and(eq(bankAccount.id, bankAccountId), eq(bankAccount.companyId, companyId)))
    .limit(1);
  if (!bank) throw new HttpError(404, "Cuenta bancaria no encontrada.");
  const [existing] = await client
    .select({ id: paymentMethod.id })
    .from(paymentMethod)
    .where(and(eq(paymentMethod.companyId, companyId), eq(paymentMethod.type, "CARD"), eq(paymentMethod.bankAccountId, bankAccountId)))
    .limit(1);
  if (existing) return existing.id;
  const [{ count }] = await client.select({ count: sql<number>`count(*)::int` }).from(paymentMethod).where(and(eq(paymentMethod.companyId, companyId), ilike(paymentMethod.code, "TPV-TARJETA%")));
  const [created] = await client
    .insert(paymentMethod)
    .values({ companyId, code: count === 0 ? "TPV-TARJETA" : `TPV-TARJETA-${count + 1}`, name: `Tarjeta (TPV) · ${bank.name}`, type: "CARD", bankAccountId })
    .returning({ id: paymentMethod.id });
  return created.id;
}

export type RegisterInput = {
  name: string;
  seriesCode: string;
  seriesPrefix: string;
  warehouseId?: string | null;
  cardBankAccountId?: string | null;
  simplifiedLimit: number;
  isActive?: boolean;
};

function normalizeSeriesCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 10) || "T";
}

async function assertWarehouse(client: DbClient, companyId: string, warehouseId: string) {
  const [row] = await client.select({ id: warehouse.id }).from(warehouse).where(and(eq(warehouse.id, warehouseId), eq(warehouse.companyId, companyId))).limit(1);
  if (!row) throw new HttpError(404, "Almacén no encontrado.");
}

export async function createRegister(actor: PosActor, input: RegisterInput) {
  return db.transaction(async (tx) => {
    if (input.warehouseId) await assertWarehouse(tx, actor.companyId, input.warehouseId);
    const customerId = await ensureGenericCustomer(tx, actor.companyId, actor.countryCode);
    const cash = await ensureCashPaymentMethod(tx, actor.companyId);
    if (!cash.id) throw new HttpError(500, "No se pudo preparar la forma de pago en efectivo.");
    const cardPaymentMethodId = input.cardBankAccountId ? await ensureCardPaymentMethod(tx, actor.companyId, input.cardBankAccountId) : null;
    const [created] = await tx
      .insert(posRegister)
      .values({
        companyId: actor.companyId,
        name: input.name.trim(),
        seriesCode: normalizeSeriesCode(input.seriesCode),
        seriesPrefix: input.seriesPrefix.trim() || "T",
        warehouseId: input.warehouseId || null,
        customerId,
        cashPaymentMethodId: cash.id,
        cardPaymentMethodId,
        simplifiedLimit: money(input.simplifiedLimit),
      })
      .onConflictDoNothing()
      .returning({ id: posRegister.id });
    if (!created) throw new HttpError(409, `Ya hay una caja llamada «${input.name.trim()}».`);
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "pos_register.create",
      entityName: "pos_register",
      entityId: created.id,
      payload: { name: input.name, seriesCode: input.seriesCode, warehouseId: input.warehouseId ?? null, card: Boolean(cardPaymentMethodId) },
    }, tx);
    return created;
  });
}

export async function updateRegister(actor: PosActor, registerId: string, input: RegisterInput) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(posRegister).where(and(eq(posRegister.id, registerId), eq(posRegister.companyId, actor.companyId))).limit(1);
    if (!current) throw new HttpError(404, "Caja no encontrada.");
    if (input.warehouseId) await assertWarehouse(tx, actor.companyId, input.warehouseId);
    const cardPaymentMethodId = input.cardBankAccountId ? await ensureCardPaymentMethod(tx, actor.companyId, input.cardBankAccountId) : null;
    await tx
      .update(posRegister)
      .set({
        name: input.name.trim(),
        seriesCode: normalizeSeriesCode(input.seriesCode),
        seriesPrefix: input.seriesPrefix.trim() || "T",
        warehouseId: input.warehouseId || null,
        cardPaymentMethodId,
        simplifiedLimit: money(input.simplifiedLimit),
        isActive: input.isActive ?? current.isActive,
        updatedAt: new Date(),
      })
      .where(eq(posRegister.id, registerId));
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "pos_register.update",
      entityName: "pos_register",
      entityId: registerId,
      payload: { ...input },
    }, tx);
    return { id: registerId };
  });
}

export async function listRegisters(companyId: string) {
  const rows = await db
    .select({
      id: posRegister.id,
      name: posRegister.name,
      seriesCode: posRegister.seriesCode,
      seriesPrefix: posRegister.seriesPrefix,
      warehouseId: posRegister.warehouseId,
      warehouseName: warehouse.name,
      cardPaymentMethodId: posRegister.cardPaymentMethodId,
      cardBankAccountId: paymentMethod.bankAccountId,
      simplifiedLimit: posRegister.simplifiedLimit,
      isActive: posRegister.isActive,
    })
    .from(posRegister)
    .leftJoin(warehouse, eq(warehouse.id, posRegister.warehouseId))
    .leftJoin(paymentMethod, eq(paymentMethod.id, posRegister.cardPaymentMethodId))
    .where(eq(posRegister.companyId, companyId))
    .orderBy(asc(posRegister.name));
  const open = rows.length > 0
    ? await db
        .select({ id: posSession.id, registerId: posSession.registerId, openedAt: posSession.openedAt, openedByName: user.name })
        .from(posSession)
        .leftJoin(user, eq(user.id, posSession.openedByUserId))
        .where(and(eq(posSession.companyId, companyId), eq(posSession.status, "OPEN")))
    : [];
  return rows.map((row) => ({ ...row, simplifiedLimit: num(row.simplifiedLimit), openSession: open.find((session) => session.registerId === row.id) ?? null }));
}

async function loadRegister(client: DbClient, companyId: string, registerId: string) {
  const [row] = await client.select().from(posRegister).where(and(eq(posRegister.id, registerId), eq(posRegister.companyId, companyId))).limit(1);
  if (!row) throw new HttpError(404, "Caja no encontrada.");
  return row;
}

// ---------------------------------------------------------------------------------------------
// Sesiones (turnos de caja)
// ---------------------------------------------------------------------------------------------

export async function getOpenSession(companyId: string, registerId: string, client: DbClient = db) {
  const [row] = await client
    .select()
    .from(posSession)
    .where(and(eq(posSession.companyId, companyId), eq(posSession.registerId, registerId), eq(posSession.status, "OPEN")))
    .limit(1);
  return row ?? null;
}

export async function openSession(actor: PosActor, registerId: string, openingCash: number) {
  return db.transaction(async (tx) => {
    const register = await loadRegister(tx, actor.companyId, registerId);
    if (!register.isActive) throw new HttpError(409, "La caja está desactivada.");
    const [created] = await tx
      .insert(posSession)
      .values({ companyId: actor.companyId, registerId, openedByUserId: actor.actorUserId, openingCash: money(openingCash) })
      .onConflictDoNothing()
      .returning({ id: posSession.id });
    if (!created) throw new HttpError(409, "La caja ya está abierta.");
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "pos_session.open",
      entityName: "pos_session",
      entityId: created.id,
      payload: { registerId, register: register.name, openingCash },
    }, tx);
    return created;
  });
}

async function loadOpenSessionById(client: DbClient, companyId: string, sessionId: string) {
  const [row] = await client.select().from(posSession).where(and(eq(posSession.id, sessionId), eq(posSession.companyId, companyId))).for("update").limit(1);
  if (!row) throw new HttpError(404, "Sesión de caja no encontrada.");
  if (row.status !== "OPEN") throw new HttpError(409, "La caja ya está cerrada.");
  return row;
}

/** Asiento de caja (570) contra otra cuenta: traspasos con el banco y diferencias del arqueo. */
async function postCashEntry(
  client: DbClient,
  actor: PosActor,
  input: { amount: number; cashSide: "debit" | "credit"; counterpartAccountId: string; reference: string; sourceType: string; sourceId: string; action: string },
) {
  const cashAccount = await ensureSubaccount(actor.companyId, CASH_ACCOUNT_CODE, client);
  const amount = money(input.amount);
  await createAutomaticEntry({
    tenantId: actor.tenantId,
    companyId: actor.companyId,
    actorUserId: actor.actorUserId,
    postedAt: new Date(),
    reference: input.reference.slice(0, 200),
    dbClient: client,
    action: input.action,
    entityName: input.sourceType,
    entityId: input.sourceId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    lines: input.cashSide === "debit"
      ? [{ accountId: cashAccount.id, debit: amount, credit: 0 }, { accountId: input.counterpartAccountId, debit: 0, credit: amount }]
      : [{ accountId: input.counterpartAccountId, debit: amount, credit: 0 }, { accountId: cashAccount.id, debit: 0, credit: amount }],
  });
}

/**
 * Entrada o salida de efectivo del cajón. Con banco es un traspaso y se contabiliza: ingreso del
 * efectivo en el banco (572 a 570) o cambio retirado del banco (570 a 572). Sin banco solo cuenta en el
 * arqueo (los gastos pagados en efectivo se registran en Gastos).
 */
export async function addCashMovement(actor: PosActor, sessionId: string, input: { type: "IN" | "OUT"; amount: number; reason: string; bankAccountId?: string | null }) {
  if (!(input.amount > 0)) throw new HttpError(400, "El importe debe ser mayor que 0.");
  return db.transaction(async (tx) => {
    await loadOpenSessionById(tx, actor.companyId, sessionId);
    let bankLedgerId: string | null = null;
    if (input.bankAccountId) {
      const [bank] = await tx.select({ id: bankAccount.id }).from(bankAccount).where(and(eq(bankAccount.id, input.bankAccountId), eq(bankAccount.companyId, actor.companyId))).limit(1);
      if (!bank) throw new HttpError(404, "Cuenta bancaria no encontrada.");
      bankLedgerId = await resolveBankLedgerAccountId(tx, actor.companyId, { bankAccountId: bank.id });
      if (!bankLedgerId) throw new HttpError(422, "La cuenta bancaria no tiene cuenta contable (572…): asígnasela en Tesorería → Cuentas bancarias.");
      await assertFiscalPeriodOpen(actor.companyId, new Date(), tx);
    }
    const [created] = await tx
      .insert(posCashMovement)
      .values({ companyId: actor.companyId, sessionId, type: input.type, amount: money(input.amount), reason: input.reason.trim(), bankAccountId: input.bankAccountId || null, createdByUserId: actor.actorUserId })
      .returning({ id: posCashMovement.id });
    if (bankLedgerId) {
      await postCashEntry(tx, actor, {
        amount: input.amount,
        // Salida al banco: el efectivo sale de caja (haber 570). Entrada del banco: entra en caja (debe 570).
        cashSide: input.type === "IN" ? "debit" : "credit",
        counterpartAccountId: bankLedgerId,
        reference: `TPV: ${input.type === "IN" ? "cambio retirado del banco" : "ingreso de caja en el banco"} · ${input.reason.trim()}`,
        sourceType: "pos_cash_movement",
        sourceId: created.id,
        action: "accounting.autopost.posCashMovement",
      });
    }
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: input.type === "IN" ? "pos_cash.in" : "pos_cash.out",
      entityName: "pos_cash_movement",
      entityId: created.id,
      payload: { sessionId, amount: input.amount, reason: input.reason, bankAccountId: input.bankAccountId ?? null },
    }, tx);
    return created;
  });
}

export type SessionSummary = {
  sales: { count: number; total: number; cash: number; card: number };
  refunds: { count: number; total: number; cash: number; card: number };
  cashIn: number;
  cashOut: number;
  openingCash: number;
  expectedCash: number;
  /** Ventas netas (ventas − devoluciones) por tipo de IVA. */
  taxBreakdown: Array<{ rate: number; base: number; tax: number }>;
  netTotal: number;
};

/** Totales de una sesión: ventas, devoluciones, efectivo esperado y desglose por IVA (informe Z). */
export async function computeSessionSummary(companyId: string, sessionId: string, client: DbClient = db): Promise<SessionSummary> {
  const [session] = await client.select().from(posSession).where(and(eq(posSession.id, sessionId), eq(posSession.companyId, companyId))).limit(1);
  if (!session) throw new HttpError(404, "Sesión de caja no encontrada.");
  const [tickets, movements] = await Promise.all([
    client.select({ kind: posTicket.kind, invoiceId: posTicket.invoiceId, totalAmount: posTicket.totalAmount, cashAmount: posTicket.cashAmount, cardAmount: posTicket.cardAmount }).from(posTicket).where(eq(posTicket.sessionId, sessionId)),
    client.select({ type: posCashMovement.type, amount: posCashMovement.amount }).from(posCashMovement).where(eq(posCashMovement.sessionId, sessionId)),
  ]);
  const sum = (rows: typeof tickets, key: "totalAmount" | "cashAmount" | "cardAmount") => centsToNumber(rows.reduce((total, row) => total + amountToCents(num(row[key])), 0));
  const sales = tickets.filter((ticket) => ticket.kind === "SALE");
  const refunds = tickets.filter((ticket) => ticket.kind === "REFUND");
  const cashIn = centsToNumber(movements.filter((movement) => movement.type === "IN").reduce((total, movement) => total + amountToCents(num(movement.amount)), 0));
  const cashOut = centsToNumber(movements.filter((movement) => movement.type === "OUT").reduce((total, movement) => total + amountToCents(num(movement.amount)), 0));

  // Desglose por IVA con las cuotas por tipo de cada factura (como se declaran).
  const invoiceIds = tickets.map((ticket) => ticket.invoiceId);
  const breakdown = new Map<number, { baseCents: number; taxCents: number }>();
  if (invoiceIds.length > 0) {
    const lines = await client
      .select({ id: invoiceLine.id, invoiceId: invoiceLine.invoiceId, quantity: invoiceLine.quantity, unitPrice: invoiceLine.unitPrice, discountPct: invoiceLine.discountPct, taxRate: invoiceLine.taxRate })
      .from(invoiceLine)
      .where(inArray(invoiceLine.invoiceId, invoiceIds));
    const lineTaxes = lines.length > 0
      ? await client.select({ invoiceLineId: invoiceLineTax.invoiceLineId, rate: invoiceLineTax.rate, kind: invoiceLineTax.kind, operation: invoiceLineTax.operation, name: invoiceLineTax.name }).from(invoiceLineTax).where(inArray(invoiceLineTax.invoiceLineId, lines.map((line) => line.id)))
      : [];
    const refundInvoices = new Set(refunds.map((ticket) => ticket.invoiceId));
    for (const invoiceId of invoiceIds) {
      const own = lines.filter((line) => line.invoiceId === invoiceId);
      const document = computeEngineDocument(own.map((line) => {
        const taxes = lineTaxes.filter((entry) => entry.invoiceLineId === line.id);
        return {
          quantity: num(line.quantity),
          unitPrice: num(line.unitPrice),
          discountPct: num(line.discountPct),
          taxes: taxes.length > 0
            ? taxes.map((entry) => ({ name: entry.name, rate: num(entry.rate), kind: entry.kind, operation: entry.operation === "SUBTRACT" ? "SUBTRACT" as const : "ADD" as const }))
            : legacyLineTaxes({ taxRate: num(line.taxRate) }),
        };
      }), { allowNegative: true });
      // Las líneas de una rectificativa ya van en negativo; por si acaso, se fuerza el signo.
      const sign = refundInvoices.has(invoiceId) && document.subtotalCents > 0 ? -1 : 1;
      for (const bucket of document.buckets.filter((entry) => entry.operation === "ADD")) {
        const current = breakdown.get(bucket.rate) ?? { baseCents: 0, taxCents: 0 };
        current.baseCents += sign * bucket.baseCents;
        current.taxCents += sign * bucket.amountCents;
        breakdown.set(bucket.rate, current);
      }
      if (document.buckets.every((entry) => entry.operation !== "ADD")) {
        const current = breakdown.get(0) ?? { baseCents: 0, taxCents: 0 };
        current.baseCents += sign * document.subtotalCents;
        breakdown.set(0, current);
      }
    }
  }
  const salesSummary = { count: sales.length, total: sum(sales, "totalAmount"), cash: sum(sales, "cashAmount"), card: sum(sales, "cardAmount") };
  const refundSummary = { count: refunds.length, total: sum(refunds, "totalAmount"), cash: sum(refunds, "cashAmount"), card: sum(refunds, "cardAmount") };
  const openingCash = num(session.openingCash);
  return {
    sales: salesSummary,
    refunds: refundSummary,
    cashIn,
    cashOut,
    openingCash,
    expectedCash: expectedCash({ openingCash, cashSales: salesSummary.cash, cashRefunds: refundSummary.cash, cashIn, cashOut }),
    taxBreakdown: [...breakdown.entries()].map(([rate, value]) => ({ rate, base: centsToNumber(value.baseCents), tax: centsToNumber(value.taxCents) })).sort((a, b) => b.rate - a.rate),
    netTotal: centsToNumber(amountToCents(salesSummary.total) - amountToCents(refundSummary.total)),
  };
}

/** Cierra la caja con el efectivo contado: arqueo (diferencia) e informe Z congelado. */
export async function closeSession(actor: PosActor, sessionId: string, input: { countedCash: number; notes?: string | null; postDifference?: boolean }) {
  return db.transaction(async (tx) => {
    const session = await loadOpenSessionById(tx, actor.companyId, sessionId);
    const summary = await computeSessionSummary(actor.companyId, sessionId, tx);
    const difference = centsToNumber(amountToCents(input.countedCash) - amountToCents(summary.expectedCash));
    const closedAt = new Date();
    // Descuadre contabilizado: falta efectivo → 678 (gastos excepcionales); sobra → 778 (ingresos excepcionales).
    const postDifference = input.postDifference !== false && amountToCents(difference) !== 0;
    if (postDifference) {
      await assertFiscalPeriodOpen(actor.companyId, closedAt, tx);
      const counterpart = await ensureSubaccount(actor.companyId, difference < 0 ? "678" : "778", tx);
      await postCashEntry(tx, actor, {
        amount: Math.abs(difference),
        cashSide: difference > 0 ? "debit" : "credit",
        counterpartAccountId: counterpart.id,
        reference: `TPV: diferencia de caja (${difference < 0 ? "faltante" : "sobrante"}) al cerrar`,
        sourceType: "pos_session",
        sourceId: sessionId,
        action: "accounting.autopost.posCashDifference",
      });
    }
    await tx
      .update(posSession)
      .set({
        status: "CLOSED",
        closedAt,
        closedByUserId: actor.actorUserId,
        expectedCash: money(summary.expectedCash),
        countedCash: money(input.countedCash),
        difference: money(difference),
        closingNotes: input.notes?.trim() || null,
        closingReport: { ...summary, countedCash: input.countedCash, difference, differencePosted: postDifference, closedAt: closedAt.toISOString() },
      })
      .where(eq(posSession.id, sessionId));
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "pos_session.close",
      entityName: "pos_session",
      entityId: sessionId,
      payload: { registerId: session.registerId, expectedCash: summary.expectedCash, countedCash: input.countedCash, difference, differencePosted: postDifference, netTotal: summary.netTotal },
    }, tx);
    return { id: sessionId, summary, countedCash: input.countedCash, difference };
  });
}

// ---------------------------------------------------------------------------------------------
// Ventas
// ---------------------------------------------------------------------------------------------

/** Serie de tickets de la caja en el ejercicio de la fecha (la crea si aún no existe en ese ejercicio). */
async function ensurePosSeries(client: DbClient, companyId: string, date: Date, code: string, prefix: string) {
  const year = await findFiscalYearForDate(client, companyId, date);
  if (!year) throw new HttpError(422, "La fecha de hoy no pertenece a ningún ejercicio de la empresa. Abre el ejercicio en Configuración → Contabilidad.");
  const [existing] = await client
    .select({ id: documentSeries.id, isActive: documentSeries.isActive })
    .from(documentSeries)
    .where(and(eq(documentSeries.companyId, companyId), eq(documentSeries.fiscalYearId, year.id), eq(documentSeries.type, "SALES_INVOICE"), eq(documentSeries.code, code)))
    .limit(1);
  if (existing) {
    if (!existing.isActive) throw new HttpError(422, `La serie de tickets ${code} está desactivada. Actívala en Configuración → Documentos.`);
    return existing.id;
  }
  await client
    .insert(documentSeries)
    .values({ companyId, fiscalYearId: year.id, type: "SALES_INVOICE", code, name: "Tickets TPV", prefix, format: defaultSeriesFormat, nextNumber: 1, isDefault: false, isActive: true })
    .onConflictDoNothing();
  const [created] = await client
    .select({ id: documentSeries.id })
    .from(documentSeries)
    .where(and(eq(documentSeries.companyId, companyId), eq(documentSeries.fiscalYearId, year.id), eq(documentSeries.type, "SALES_INVOICE"), eq(documentSeries.code, code)))
    .limit(1);
  return created.id;
}

export type SaleLineInput = { itemId?: string | null; description: string; quantity: number; unitPrice: number; taxRate: number; taxId?: string | null };

export type SaleInput = {
  registerId: string;
  lines: SaleLineInput[];
  customerId?: string | null;
  payment: { cash: number; card: number; cashReceived?: number | null };
  clientRequestId: string;
};

export type SaleResult = { ticketId: string; invoiceId: string; number: string; total: number; change: number; warnings: string[] };

/**
 * Venta en el TPV, todo en una transacción: factura (simplificada si el cliente no tiene NIF) emitida
 * con su serie de tickets, asiento y registro VeriFactu; cobros en efectivo/tarjeta (caja 570 y banco);
 * salida de stock del almacén de la caja (si hay inventario) y el ticket en la sesión abierta.
 */
export async function createSale(actor: PosActor, input: SaleInput): Promise<SaleResult> {
  const [previous] = await db
    .select({ id: posTicket.id, invoiceId: posTicket.invoiceId, totalAmount: posTicket.totalAmount, changeGiven: posTicket.changeGiven, number: invoice.number })
    .from(posTicket)
    .innerJoin(invoice, eq(invoice.id, posTicket.invoiceId))
    .where(and(eq(posTicket.companyId, actor.companyId), eq(posTicket.clientRequestId, input.clientRequestId)))
    .limit(1);
  // Reintento de la misma venta (doble clic, red): se devuelve el ticket ya hecho.
  if (previous) return { ticketId: previous.id, invoiceId: previous.invoiceId, number: previous.number, total: num(previous.totalAmount), change: num(previous.changeGiven), warnings: [] };

  if (input.lines.length === 0) throw new HttpError(400, "El ticket está vacío.");
  if (input.lines.some((line) => !(line.quantity > 0) || line.unitPrice < 0 || !line.description.trim())) throw new HttpError(400, "Revisa las líneas: cantidades positivas y precios no negativos.");
  const register = await loadRegister(db, actor.companyId, input.registerId);
  const session = await getOpenSession(actor.companyId, register.id);
  if (!session) throw new HttpError(409, "Abre la caja antes de vender.");
  await assertItemsBelongToCompany(db, actor.companyId, input.lines.map((line) => line.itemId));

  // El tipo de IVA de cada línea con impuesto configurado sale de ese impuesto, no de lo que envía la pantalla.
  const taxIds = [...new Set(input.lines.map((line) => line.taxId).filter((id): id is string => Boolean(id)))];
  const configuredRates = taxIds.length > 0
    ? new Map((await db.select({ id: tax.id, rate: tax.rate }).from(tax).where(and(eq(tax.companyId, actor.companyId), inArray(tax.id, taxIds), eq(tax.isActive, true)))).map((row) => [row.id, num(row.rate)]))
    : new Map<string, number>();
  if (configuredRates.size !== taxIds.length) throw new HttpError(400, "Algún impuesto de los artículos ya no está activo: recarga el TPV.");
  // Mismo cálculo que la pantalla: total = suma de los PVP, con el redondeo del IVA absorbido.
  const totals = cartTotals(input.lines.map((line, index) => ({
    key: String(index),
    itemId: line.itemId || null,
    description: line.description.trim(),
    quantity: line.quantity,
    unitPrice: Math.round(line.unitPrice * 100) / 100,
    taxRate: line.taxId ? configuredRates.get(line.taxId) ?? line.taxRate : line.taxRate,
    taxId: line.taxId || null,
  })));
  const resolved = await resolveLineTaxes(db, actor.companyId, totals.settled.map((line) => ({
    itemId: line.itemId,
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    ...(line.taxId ? { taxIds: [line.taxId] } : { taxRate: line.taxRate }),
  })), { requireActive: true });
  const paymentCheck = validatePayment(totals.total, input.payment);
  if (!paymentCheck.ok) throw new HttpError(400, paymentCheck.message);
  if (input.payment.card > 0 && !register.cardPaymentMethodId) throw new HttpError(409, "Esta caja no tiene configurado el cobro con tarjeta (Configuración → TPV).");

  const customerId = input.customerId || register.customerId;
  if (input.customerId) {
    const [owned] = await db.select({ id: customer.id }).from(customer).where(and(eq(customer.id, input.customerId), eq(customer.companyId, actor.companyId))).limit(1);
    if (!owned) throw new HttpError(404, "Cliente no encontrado.");
  }
  if (customerId === register.customerId && exceedsSimplifiedLimit(totals.total, num(register.simplifiedLimit))) {
    throw new HttpError(422, `El ticket supera el límite de factura simplificada (${num(register.simplifiedLimit).toFixed(2)} €): elige el cliente (con su NIF) para hacer factura completa.`);
  }

  const methodIds = [...(input.payment.cash > 0 || totals.total === 0 ? [register.cashPaymentMethodId] : []), ...(input.payment.card > 0 && register.cardPaymentMethodId ? [register.cardPaymentMethodId] : [])];
  const paymentMethods = (await resolveInvoicePaymentMethods(actor.companyId, methodIds)) ?? [];
  await ensureCompanyDefaults(actor);
  const inventoryEnabled = Boolean(register.warehouseId) && (await isModuleEnabled(actor.companyId, "inventory"));
  const warnings: string[] = [];
  const now = new Date();

  const result = await db.transaction(async (tx) => {
    const seriesId = await ensurePosSeries(tx, actor.companyId, now, register.seriesCode, register.seriesPrefix);
    const draft = await createDraftInvoiceInTransaction(tx, actor, {
      customerId,
      issueDate: now,
      dueDate: now,
      paymentMethods,
      lines: resolved,
      vatTreatment: null,
      notes: `Ticket TPV · ${register.name}`,
      seriesId,
      auditPayload: { origin: "pos", registerId: register.id, sessionId: session.id },
    });
    const issued = await issueInvoiceInTransaction(tx, actor, draft.id);
    const total = num(issued.totalAmount);
    if (amountToCents(total) !== amountToCents(totals.total)) throw new HttpError(409, "El total del ticket ha cambiado: vuelve a cobrarlo.");

    const paymentActor = { tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, activeFiscalYearId: actor.activeFiscalYearId };
    if (input.payment.cash > 0) {
      await registerInvoicePayment(paymentActor, { invoiceId: issued.id, amountApplied: input.payment.cash, postedAt: now, paymentMethodId: register.cashPaymentMethodId, reference: `Ticket ${issued.number} (efectivo)`, origin: "pos" }, tx);
    }
    if (input.payment.card > 0 && register.cardPaymentMethodId) {
      await registerInvoicePayment(paymentActor, { invoiceId: issued.id, amountApplied: input.payment.card, postedAt: now, paymentMethodId: register.cardPaymentMethodId, reference: `Ticket ${issued.number} (tarjeta)`, origin: "pos" }, tx);
    }

    if (inventoryEnabled && register.warehouseId) {
      await moveStock(tx, actor.companyId, register.warehouseId, resolved, "OUT", `pos-ticket:${issued.id}`, `Venta TPV ${issued.number}`, warnings);
    }

    const [ticket] = await tx
      .insert(posTicket)
      .values({
        companyId: actor.companyId,
        sessionId: session.id,
        kind: "SALE",
        invoiceId: issued.id,
        totalAmount: money(total),
        cashAmount: money(input.payment.cash),
        cardAmount: money(input.payment.card),
        cashReceived: input.payment.cash > 0 ? money(input.payment.cashReceived ?? input.payment.cash) : null,
        changeGiven: input.payment.cash > 0 ? money(paymentCheck.change) : null,
        clientRequestId: input.clientRequestId,
        createdByUserId: actor.actorUserId,
      })
      .returning({ id: posTicket.id });
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "pos_ticket.create",
      entityName: "pos_ticket",
      entityId: ticket.id,
      payload: { invoiceId: issued.id, number: issued.number, total, cash: input.payment.cash, card: input.payment.card, sessionId: session.id },
    }, tx);
    return { ticketId: ticket.id, invoiceId: issued.id, number: issued.number, total };
  });
  return { ...result, change: paymentCheck.change, warnings };
}

/** Salida (venta) o entrada (devolución) de stock de los artículos con control de stock. */
async function moveStock(
  client: DbClient,
  companyId: string,
  warehouseId: string,
  lines: Array<{ itemId?: string | null; quantity: number }>,
  type: "OUT" | "IN",
  reference: string,
  reason: string,
  warnings: string[],
) {
  const quantities = new Map<string, number>();
  for (const line of lines) if (line.itemId) quantities.set(line.itemId, (quantities.get(line.itemId) ?? 0) + line.quantity);
  if (quantities.size === 0) return;
  const products = await client
    .select({ id: item.id, name: item.name })
    .from(item)
    .where(and(eq(item.companyId, companyId), inArray(item.id, [...quantities.keys()]), eq(item.isService, false)));
  for (const product of products) {
    const quantity = quantities.get(product.id) ?? 0;
    await client.insert(stockMovement).values({
      companyId,
      itemId: product.id,
      warehouseId,
      movementType: type,
      quantity: quantity.toFixed(3),
      movedAt: new Date(),
      reason,
      reference,
    }).onConflictDoNothing();
    await refreshStockLocation({ companyId, itemId: product.id, warehouseId }, client);
    if (type === "OUT") {
      const [location] = await client
        .select({ currentQuantity: stockLocation.currentQuantity })
        .from(stockLocation)
        .where(and(eq(stockLocation.companyId, companyId), eq(stockLocation.itemId, product.id), eq(stockLocation.warehouseId, warehouseId)))
        .limit(1);
      // La venta ya ha ocurrido en el mostrador: no se bloquea, se avisa para revisar el inventario.
      if (num(location?.currentQuantity) < -0.0005) warnings.push(`Stock negativo de «${product.name}»: revisa el inventario.`);
    }
  }
}

async function loadSaleTicket(client: DbClient, companyId: string, ticketId: string) {
  const [ticket] = await client
    .select({
      id: posTicket.id,
      kind: posTicket.kind,
      invoiceId: posTicket.invoiceId,
      totalAmount: posTicket.totalAmount,
      number: invoice.number,
      createdAt: posTicket.createdAt,
      customerTaxId: sql<string | null>`${invoice.customerSnapshot}->>'taxId'`,
    })
    .from(posTicket)
    .innerJoin(invoice, eq(invoice.id, posTicket.invoiceId))
    .where(and(eq(posTicket.id, ticketId), eq(posTicket.companyId, companyId)))
    .limit(1);
  if (!ticket) throw new HttpError(404, "Ticket no encontrado.");
  if (ticket.kind !== "SALE") throw new HttpError(409, "Una devolución no se puede devolver.");
  return ticket;
}

/** Lo cobrado ahora mismo de una factura, por forma de pago (efectivo o tarjeta/banco). */
async function paidByMethod(client: DbClient, companyId: string, invoiceId: string) {
  const rows = await client
    .select({ id: payment.id, amount: payment.amount, paymentMethodId: payment.paymentMethodId, type: paymentMethod.type })
    .from(payment)
    .leftJoin(paymentMethod, eq(paymentMethod.id, payment.paymentMethodId))
    .where(and(eq(payment.companyId, companyId), eq(payment.invoiceId, invoiceId)));
  const sumCents = (filter: (row: (typeof rows)[number]) => boolean) => rows.filter(filter).reduce((total, row) => total + amountToCents(num(row.amount)), 0);
  return {
    rows,
    cash: centsToNumber(sumCents((row) => row.type === "CASH")),
    card: centsToNumber(sumCents((row) => row.type !== "CASH")),
    cardMethodId: rows.find((row) => row.type !== "CASH")?.paymentMethodId ?? null,
    cashMethodId: rows.find((row) => row.type === "CASH")?.paymentMethodId ?? null,
  };
}

async function returnedLinesOf(client: DbClient, ticketId: string) {
  const refunds = await client.select({ returnedLines: posTicket.returnedLines }).from(posTicket).where(eq(posTicket.refundOfTicketId, ticketId));
  return refunds.flatMap((refund) => refund.returnedLines ?? []);
}

/** Ticket para la pantalla de devolución: líneas, unidades que quedan por devolver y cómo se cobró. */
export async function getRefundableTicket(companyId: string, ticketId: string) {
  const ticket = await loadSaleTicket(db, companyId, ticketId);
  const [lines, returned, paid] = await Promise.all([loadStoredLines(db, ticket.invoiceId), returnedLinesOf(db, ticket.id), paidByMethod(db, companyId, ticket.invoiceId)]);
  const remaining = remainingQuantities(lines.map((line) => ({ id: line.lineId, quantity: line.quantity })), returned);
  return {
    ticket: { id: ticket.id, number: ticket.number, totalAmount: num(ticket.totalAmount), createdAt: ticket.createdAt },
    lines: lines.map((line) => ({
      id: line.lineId,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxRate: line.taxes?.find((entry) => entry.operation === "ADD")?.rate ?? line.taxRate ?? 0,
      remaining: remaining.get(line.lineId) ?? 0,
    })),
    paid: { cash: paid.cash, card: paid.card },
  };
}

export type RefundInput = {
  ticketId: string;
  registerId: string;
  /** Líneas y unidades a devolver; sin indicar, todo lo que quede por devolver. */
  lines?: Array<{ lineId: string; quantity: number }>;
  method?: RefundMethod;
  reason?: string | null;
  clientRequestId: string;
};

/**
 * Devolución (completa o de algunas líneas/unidades) de un ticket: rectificativa (R5 si era
 * simplificada, R1 si llevaba NIF; completa o parcial), el dinero sale por la vía elegida (los cobros se
 * reajustan con fecha de hoy), entra el stock devuelto y queda registrada en la sesión abierta. Se puede
 * devolver por partes hasta completar el ticket. Un reintento con la misma petición no duplica nada.
 */
export async function refundTicket(actor: PosActor, input: RefundInput) {
  const [previous] = await db
    .select({ id: posTicket.id, invoiceId: posTicket.invoiceId, cashAmount: posTicket.cashAmount, cardAmount: posTicket.cardAmount, number: invoice.number, totalAmount: posTicket.totalAmount })
    .from(posTicket)
    .innerJoin(invoice, eq(invoice.id, posTicket.invoiceId))
    .where(and(eq(posTicket.companyId, actor.companyId), eq(posTicket.clientRequestId, input.clientRequestId)))
    .limit(1);
  if (previous) return { ticketId: previous.id, creditNoteId: previous.invoiceId, number: previous.number, total: num(previous.totalAmount), cash: num(previous.cashAmount), card: num(previous.cardAmount) };

  const ticket = await loadSaleTicket(db, actor.companyId, input.ticketId);
  const register = await loadRegister(db, actor.companyId, input.registerId);
  const session = await getOpenSession(actor.companyId, register.id);
  if (!session) throw new HttpError(409, "Abre la caja antes de hacer una devolución.");

  const [lines, returnedBefore, paidBefore] = await Promise.all([loadStoredLines(db, ticket.invoiceId), returnedLinesOf(db, ticket.id), paidByMethod(db, actor.companyId, ticket.invoiceId)]);
  const remaining = remainingQuantities(lines.map((line) => ({ id: line.lineId, quantity: line.quantity })), returnedBefore);
  const requested = (input.lines ?? lines.map((line) => ({ lineId: line.lineId, quantity: remaining.get(line.lineId) ?? 0 })))
    .filter((entry) => entry.quantity > 0);
  if (requested.length === 0) throw new HttpError(409, `No queda nada por devolver del ticket ${ticket.number}.`);
  for (const entry of requested) {
    const left = remaining.get(entry.lineId);
    if (left === undefined) throw new HttpError(400, "Esa línea no es de este ticket.");
    if (entry.quantity > left + 0.0005) throw new HttpError(409, `Solo quedan ${left.toLocaleString("es-ES")} unidades por devolver de una línea.`);
  }
  const everything = returnedBefore.length === 0 && lines.every((line) => {
    const asked = requested.find((entry) => entry.lineId === line.lineId);
    return asked && Math.abs(asked.quantity - line.quantity) < 0.0005;
  });

  // Marca de la petición en el motivo: si el proceso se corta tras emitir la rectificativa, el reintento la reutiliza.
  const marker = `[${input.clientRequestId.slice(0, 8)}]`;
  const description = `Devolución en TPV del ticket ${ticket.number}${input.reason?.trim() ? `: ${input.reason.trim()}` : ""} ${marker}`.slice(0, 500);
  const [existingCredit] = await db
    .select({ id: invoice.id, number: invoice.number, issuedAt: invoice.issuedAt })
    .from(invoice)
    .where(and(eq(invoice.companyId, actor.companyId), eq(invoice.rectifiedInvoiceId, ticket.invoiceId), eq(invoice.invoiceType, "CREDIT_NOTE"), ilike(invoice.rectificationDescription, `%${marker}`)))
    .limit(1);
  const lineById = new Map(lines.map((line) => [line.lineId, line]));
  const credit = existingCredit?.issuedAt
    ? { id: existingCredit.id, number: existingCredit.number }
    : await createCreditNote(actor, ticket.invoiceId, {
      reason: ticket.customerTaxId ? "R1" : "R5",
      type: "DIFFERENCES",
      scope: everything ? "FULL" : "PARTIAL",
      description,
      ...(everything ? {} : {
        lines: requested.map((entry) => {
          const line = lineById.get(entry.lineId)!;
          const taxIds = (line.taxes ?? []).map((entryTax) => entryTax.id).filter((id): id is string => Boolean(id));
          return {
            itemId: line.itemId ?? null,
            description: line.description,
            quantity: entry.quantity,
            unitPrice: line.unitPrice,
            discountPct: line.discountPct ?? 0,
            ...(taxIds.length > 0 ? { taxIds } : { taxRate: line.taxRate ?? 0 }),
          };
        }),
      }),
    });
  if (!credit) throw new HttpError(404, "Ticket no encontrado.");
  const [creditRow] = await db.select({ totalAmount: invoice.totalAmount }).from(invoice).where(eq(invoice.id, credit.id)).limit(1);
  const refundTotal = Math.abs(num(creditRow?.totalAmount));
  const split = splitRefund(refundTotal, paidBefore, input.method ?? (paidBefore.cash > 0 ? "cash" : "card"));
  if (!split) throw new HttpError(409, "La devolución supera lo cobrado del ticket.");

  const inventoryEnabled = Boolean(register.warehouseId) && (await isModuleEnabled(actor.companyId, "inventory"));
  const now = new Date();
  return db.transaction(async (tx) => {
    // Los cobros se reajustan: se anulan (con fecha de hoy) y se vuelve a cobrar lo que se queda el cliente.
    const paid = await paidByMethod(tx, actor.companyId, ticket.invoiceId);
    for (const row of paid.rows) {
      await removeInvoicePayment({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId }, row.id, { postedAt: now, reason: description, origin: "pos.refund" }, tx);
    }
    const paymentActor = { tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, activeFiscalYearId: actor.activeFiscalYearId };
    const keepCash = centsToNumber(amountToCents(paid.cash) - amountToCents(split.cash));
    const keepCard = centsToNumber(amountToCents(paid.card) - amountToCents(split.card));
    if (keepCash > 0) {
      await registerInvoicePayment(paymentActor, { invoiceId: ticket.invoiceId, amountApplied: keepCash, postedAt: now, paymentMethodId: paid.cashMethodId ?? register.cashPaymentMethodId, reference: `Ticket ${ticket.number} tras devolución`, origin: "pos" }, tx);
    }
    if (keepCard > 0 && (paid.cardMethodId ?? register.cardPaymentMethodId)) {
      await registerInvoicePayment(paymentActor, { invoiceId: ticket.invoiceId, amountApplied: keepCard, postedAt: now, paymentMethodId: paid.cardMethodId ?? register.cardPaymentMethodId, reference: `Ticket ${ticket.number} tras devolución`, origin: "pos" }, tx);
    }
    if (inventoryEnabled && register.warehouseId) {
      await moveStock(tx, actor.companyId, register.warehouseId, requested.map((entry) => ({ itemId: lineById.get(entry.lineId)?.itemId ?? null, quantity: entry.quantity })), "IN", `pos-refund:${input.clientRequestId}`, `Devolución TPV ${ticket.number}`, []);
    }
    const [refund] = await tx
      .insert(posTicket)
      .values({
        companyId: actor.companyId,
        sessionId: session.id,
        kind: "REFUND",
        invoiceId: credit.id,
        refundOfTicketId: ticket.id,
        totalAmount: money(refundTotal),
        cashAmount: money(split.cash),
        cardAmount: money(split.card),
        returnedLines: requested,
        clientRequestId: input.clientRequestId,
        createdByUserId: actor.actorUserId,
      })
      .returning({ id: posTicket.id });
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "pos_ticket.refund",
      entityName: "pos_ticket",
      entityId: refund.id,
      payload: { ticketId: ticket.id, invoiceId: ticket.invoiceId, creditNoteId: credit.id, total: refundTotal, cash: split.cash, card: split.card, lines: requested, full: everything, sessionId: session.id },
    }, tx);
    return { ticketId: refund.id, creditNoteId: credit.id, number: credit.number, total: refundTotal, cash: split.cash, card: split.card };
  });
}

// ---------------------------------------------------------------------------------------------
// Datos para las pantallas
// ---------------------------------------------------------------------------------------------

export async function listPosCatalog(companyId: string, warehouseId: string | null, withStock: boolean) {
  const [items, defaultTax] = await Promise.all([
    db
      .select({
        id: item.id,
        sku: item.sku,
        name: item.name,
        salePrice: item.salePrice,
        isService: item.isService,
        categoryId: item.categoryId,
        categoryName: itemCategory.name,
        taxId: tax.id,
        taxRate: tax.rate,
        taxKind: tax.kind,
        taxActive: tax.isActive,
      })
      .from(item)
      .leftJoin(itemCategory, eq(itemCategory.id, item.categoryId))
      .leftJoin(tax, eq(tax.id, item.defaultTaxId))
      .where(and(eq(item.companyId, companyId), eq(item.isActive, true)))
      .orderBy(asc(itemCategory.name), asc(item.name))
      .limit(2000),
    db.select({ id: tax.id, rate: tax.rate }).from(tax).where(and(eq(tax.companyId, companyId), eq(tax.isDefault, true), eq(tax.isActive, true), eq(tax.kind, "VAT"))).limit(1),
  ]);
  const stock = withStock && warehouseId
    ? await db.select({ itemId: stockLocation.itemId, quantity: stockLocation.currentQuantity }).from(stockLocation).where(and(eq(stockLocation.companyId, companyId), eq(stockLocation.warehouseId, warehouseId)))
    : [];
  const stockByItem = new Map(stock.map((row) => [row.itemId, num(row.quantity)]));
  const fallback = defaultTax[0];
  return items.map((row) => {
    const usableTax = row.taxId && row.taxActive && row.taxKind === "VAT";
    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      unitPrice: num(row.salePrice),
      isService: row.isService,
      categoryName: row.categoryName,
      taxId: usableTax ? row.taxId : fallback?.id ?? null,
      taxRate: usableTax ? num(row.taxRate) : fallback ? num(fallback.rate) : 21,
      stock: withStock && !row.isService ? stockByItem.get(row.id) ?? 0 : null,
    };
  });
}

export async function listSessionTickets(companyId: string, sessionId: string) {
  return db
    .select({
      id: posTicket.id,
      kind: posTicket.kind,
      invoiceId: posTicket.invoiceId,
      number: invoice.number,
      totalAmount: posTicket.totalAmount,
      cashAmount: posTicket.cashAmount,
      cardAmount: posTicket.cardAmount,
      createdAt: posTicket.createdAt,
      refundOfTicketId: posTicket.refundOfTicketId,
      refundedAmount: sql<string>`coalesce((select sum(r."totalAmount") from ${posTicket} r where r."refundOfTicketId" = ${posTicket.id}), 0)`,
    })
    .from(posTicket)
    .innerJoin(invoice, eq(invoice.id, posTicket.invoiceId))
    .where(and(eq(posTicket.companyId, companyId), eq(posTicket.sessionId, sessionId)))
    .orderBy(desc(posTicket.createdAt));
}

/** Busca tickets de venta (para devoluciones de días anteriores) por número. */
export async function findTickets(companyId: string, query: string) {
  const pattern = `%${query.trim().replace(/[%_\\]/g, (match) => `\\${match}`)}%`;
  return db
    .select({ id: posTicket.id, invoiceId: posTicket.invoiceId, number: invoice.number, totalAmount: posTicket.totalAmount, createdAt: posTicket.createdAt })
    .from(posTicket)
    .innerJoin(invoice, eq(invoice.id, posTicket.invoiceId))
    .where(and(eq(posTicket.companyId, companyId), eq(posTicket.kind, "SALE"), or(ilike(invoice.number, pattern))))
    .orderBy(desc(posTicket.createdAt))
    .limit(20);
}

export async function listSessions(companyId: string, limit = 100) {
  return db
    .select({
      id: posSession.id,
      registerName: posRegister.name,
      status: posSession.status,
      openedAt: posSession.openedAt,
      closedAt: posSession.closedAt,
      openedByName: user.name,
      openingCash: posSession.openingCash,
      expectedCash: posSession.expectedCash,
      countedCash: posSession.countedCash,
      difference: posSession.difference,
      closingReport: posSession.closingReport,
    })
    .from(posSession)
    .innerJoin(posRegister, eq(posRegister.id, posSession.registerId))
    .leftJoin(user, eq(user.id, posSession.openedByUserId))
    .where(eq(posSession.companyId, companyId))
    .orderBy(desc(posSession.openedAt))
    .limit(limit);
}

export async function getSession(companyId: string, sessionId: string) {
  const [row] = await db
    .select({
      id: posSession.id,
      registerId: posSession.registerId,
      registerName: posRegister.name,
      status: posSession.status,
      openedAt: posSession.openedAt,
      closedAt: posSession.closedAt,
      openingCash: posSession.openingCash,
      expectedCash: posSession.expectedCash,
      countedCash: posSession.countedCash,
      difference: posSession.difference,
      closingNotes: posSession.closingNotes,
      closingReport: posSession.closingReport,
    })
    .from(posSession)
    .innerJoin(posRegister, eq(posRegister.id, posSession.registerId))
    .where(and(eq(posSession.id, sessionId), eq(posSession.companyId, companyId)))
    .limit(1);
  if (!row) return null;
  const [tickets, movements, summary] = await Promise.all([
    listSessionTickets(companyId, sessionId),
    db.select().from(posCashMovement).where(eq(posCashMovement.sessionId, sessionId)).orderBy(asc(posCashMovement.createdAt)),
    row.status === "CLOSED" && row.closingReport ? Promise.resolve(row.closingReport as unknown as SessionSummary) : computeSessionSummary(companyId, sessionId),
  ]);
  return { session: row, tickets, movements, summary };
}

export async function listBankAccountOptions(companyId: string) {
  return db.select({ id: bankAccount.id, name: bankAccount.bankName, iban: bankAccount.iban }).from(bankAccount).where(eq(bankAccount.companyId, companyId)).orderBy(asc(bankAccount.bankName));
}

export async function listWarehouseOptions(companyId: string) {
  return db.select({ id: warehouse.id, name: warehouse.name }).from(warehouse).where(and(eq(warehouse.companyId, companyId), eq(warehouse.isActive, true))).orderBy(asc(warehouse.name));
}

/** Ticket imprimible (80 mm): datos de la factura simplificada, desglose de IVA, cobro y QR VeriFactu. */
export async function getTicketPrint(companyId: string, invoiceId: string) {
  const [row] = await db
    .select({
      id: invoice.id,
      number: invoice.number,
      issueDate: invoice.issueDate,
      issuedAt: invoice.issuedAt,
      invoiceType: invoice.invoiceType,
      rectifiedInvoiceId: invoice.rectifiedInvoiceId,
      issuerSnapshot: invoice.issuerSnapshot,
      customerSnapshot: invoice.customerSnapshot,
      totalAmount: invoice.totalAmount,
    })
    .from(invoice)
    .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId)))
    .limit(1);
  if (!row || !row.issuedAt) return null;
  const [lines, [ticket], [original]] = await Promise.all([
    loadStoredLines(db, invoiceId),
    db.select({ kind: posTicket.kind, cashAmount: posTicket.cashAmount, cardAmount: posTicket.cardAmount, cashReceived: posTicket.cashReceived, changeGiven: posTicket.changeGiven, registerName: posRegister.name })
      .from(posTicket)
      .innerJoin(posSession, eq(posSession.id, posTicket.sessionId))
      .innerJoin(posRegister, eq(posRegister.id, posSession.registerId))
      .where(and(eq(posTicket.invoiceId, invoiceId), eq(posTicket.companyId, companyId)))
      .limit(1),
    row.rectifiedInvoiceId ? db.select({ number: invoice.number }).from(invoice).where(eq(invoice.id, row.rectifiedInvoiceId)).limit(1) : Promise.resolve([]),
  ]);
  const totals = calculateInvoiceTotals(lines, { allowNegative: row.invoiceType === "CREDIT_NOTE" });
  const verifactuInfo = await getInvoiceVerifactuInfo(companyId, invoiceId);
  return {
    invoice: { ...row, totalAmount: num(row.totalAmount) },
    lines: lines.map((line, index) => ({ description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, total: totals.lines[index]?.lineTotal ?? 0 })),
    totals: {
      subtotal: totals.subtotal,
      tax: totals.taxAmount,
      total: totals.totalAmount,
      breakdown: totals.taxBuckets.filter((bucket) => bucket.operation === "ADD").map((bucket) => ({ rate: bucket.rate, base: bucket.baseAmount, tax: bucket.amount })),
    },
    payment: ticket ? { kind: ticket.kind, cash: num(ticket.cashAmount), card: num(ticket.cardAmount), cashReceived: ticket.cashReceived === null ? null : num(ticket.cashReceived), change: ticket.changeGiven === null ? null : num(ticket.changeGiven), registerName: ticket.registerName } : null,
    originalNumber: original?.number ?? null,
    verifactu: verifactuInfo ? { svg: await getInvoiceVerifactuQrSvg(verifactuInfo), legends: verifactuInfo.legends } : null,
  };
}

/** Informe del TPV: ventas netas por día, por caja y por forma de cobro en los últimos `days` días. */
export async function getPosReport(companyId: string, options: { days?: number; timeZone?: string; now?: Date } = {}) {
  const days = options.days ?? 30;
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - (days + 1) * 86_400_000);
  const rows = await db
    .select({ kind: posTicket.kind, totalAmount: posTicket.totalAmount, cashAmount: posTicket.cashAmount, cardAmount: posTicket.cardAmount, createdAt: posTicket.createdAt, registerName: posRegister.name })
    .from(posTicket)
    .innerJoin(posSession, eq(posSession.id, posTicket.sessionId))
    .innerJoin(posRegister, eq(posRegister.id, posSession.registerId))
    .where(and(eq(posTicket.companyId, companyId), sql`${posTicket.createdAt} >= ${since}`));
  const series = dailySales(rows.map((row) => ({ kind: row.kind, total: num(row.totalAmount), createdAt: row.createdAt })), now, days, options.timeZone);
  const inRange = new Set(series.categories.map((day) => day.key));
  const dayOf = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: options.timeZone ?? "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const tickets = rows.filter((row) => inRange.has(dayOf(row.createdAt)));
  const signed = (row: (typeof rows)[number], key: "totalAmount" | "cashAmount" | "cardAmount") => (row.kind === "REFUND" ? -1 : 1) * amountToCents(num(row[key]));
  const sales = tickets.filter((row) => row.kind === "SALE");
  const byRegister = new Map<string, number>();
  for (const row of tickets) byRegister.set(row.registerName, (byRegister.get(row.registerName) ?? 0) + signed(row, "totalAmount"));
  const salesCents = sales.reduce((total, row) => total + amountToCents(num(row.totalAmount)), 0);
  return {
    ...series,
    netTotal: centsToNumber(tickets.reduce((total, row) => total + signed(row, "totalAmount"), 0)),
    cash: centsToNumber(tickets.reduce((total, row) => total + signed(row, "cashAmount"), 0)),
    card: centsToNumber(tickets.reduce((total, row) => total + signed(row, "cardAmount"), 0)),
    ticketCount: sales.length,
    refundCount: tickets.length - sales.length,
    averageTicket: sales.length > 0 ? centsToNumber(Math.round(salesCents / sales.length)) : 0,
    byRegister: [...byRegister.entries()].map(([name, cents]) => ({ name, net: centsToNumber(cents) })).sort((a, b) => b.net - a.net),
  };
}

/** Panel de inicio: ventas netas de hoy, tickets y cajas abiertas. */
export async function getPosToday(companyId: string, timeZone?: string) {
  const [report, [open]] = await Promise.all([
    getPosReport(companyId, { days: 1, timeZone }),
    db.select({ count: sql<number>`count(*)::int` }).from(posSession).where(and(eq(posSession.companyId, companyId), eq(posSession.status, "OPEN"))),
  ]);
  return { net: report.netTotal, tickets: report.ticketCount, openRegisters: open?.count ?? 0 };
}
