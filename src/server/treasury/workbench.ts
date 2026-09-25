import { and, asc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";

import {
  accountChart,
  bankAccount,
  bankReconciliationRule,
  bankTransaction,
  bankTransactionAllocation,
  customer,
  invoice,
  invoicePayment,
  partner,
  payment,
  sepaDirectDebitItem,
  sepaDirectDebitRemittance,
  sepaRemittance,
  sepaRemittanceItem,
  supplierInvoice,
  supplierInvoicePayment,
  supplierPayment,
} from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import {
  loadPostingSettings,
  postBankTransaction,
  postBankTransactionAssignment,
  resolveBankLedgerAccountId,
  reverseAutomaticEntries,
} from "@/server/accounting/auto-post";
import { AccountingRuleError, isAccountingRuleError } from "@/server/accounting/errors";
import { recordAudit } from "@/server/audit";
import { resolveOpenPostingDate } from "@/server/fiscal/locks";
import { creditedByInvoiceSubquery, invoiceIsIssuedSql, netOutstandingSql, paidByInvoiceSubquery } from "@/server/invoices/sql";
import {
  createCustomerPaymentForBank,
  createSupplierPaymentForBank,
  removeTreasuryCustomerPayment,
  removeTreasurySupplierPayment,
  type TreasuryActor,
} from "@/server/treasury/bank-payments";
import {
  matchRule,
  rankSuggestions,
  resolutionOf,
  toCents,
  validateAllocations,
  type AllocationInput,
  type ExistingPaymentCandidate,
  type OpenInvoiceCandidate,
  type RuleCandidate,
  type Suggestion,
} from "@/server/treasury/matching";
import { returnedItemForMovement } from "@/server/sepa/direct-debits";
import { unreconcileBankTransaction } from "@/server/treasury/reconciliation";
import { createReconciliationRule, type RulePayload } from "@/server/treasury/rules";

/*
 * Mesa de conciliación: propuestas por movimiento y aplicación de repartos.
 *
 * Modelo contable (continúa el de `reconciliation.ts`):
 * - El movimiento importado está contabilizado Banco ↔ 555 (pendiente de identificar).
 * - Al aplicarlo se crea/vincula cada cobro o pago (Banco ↔ 430/400, en la subcuenta del banco del
 *   movimiento) y la parte asignada a cuentas se contabiliza Banco ↔ cuenta (origen
 *   `bankTransactionAssignment`). Después se revierte el apunte Banco ↔ 555: el banco queda con un
 *   único efecto igual al importe del extracto y 555 vuelve a cero.
 * - Deshacer hace lo contrario: elimina los cobros/pagos creados aquí (los ya existentes solo se
 *   desvinculan), revierte la asignación a cuentas y vuelve a contabilizar Banco ↔ 555.
 */

const WORKBENCH_LIMIT = 100;

export type WorkbenchMovement = {
  id: string;
  bankAccountId: string;
  bankName: string;
  amount: number;
  description: string;
  reference: string | null;
  postedAt: Date;
  suggestions: Suggestion[];
};

export type WorkbenchInvoiceOption = OpenInvoiceCandidate & { href: string };

/**
 * Cobros (invoicePayment) y pagos (supplierInvoicePayment) ya conciliados con algún movimiento:
 * por la columna del movimiento (conciliación antigua 1:1) o por una partida de la mesa.
 */
export async function usedPaymentIds(client: DbClient, companyId: string) {
  const [matched, allocated] = await Promise.all([
    client
      .select({ invoicePaymentId: bankTransaction.matchedInvoicePaymentId, supplierPaymentId: bankTransaction.matchedSupplierPaymentId })
      .from(bankTransaction)
      .innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.bankAccountId))
      .where(and(eq(bankAccount.companyId, companyId), eq(bankTransaction.reconciliationStatus, "RECONCILED"))),
    client
      .select({ invoicePaymentId: bankTransactionAllocation.invoicePaymentId, supplierPaymentId: bankTransactionAllocation.supplierInvoicePaymentId })
      .from(bankTransactionAllocation)
      .where(eq(bankTransactionAllocation.companyId, companyId)),
  ]);
  const rows = [...matched, ...allocated];
  return {
    customer: new Set(rows.map((row) => row.invoicePaymentId).filter((id): id is string => Boolean(id))),
    supplier: new Set(rows.map((row) => row.supplierPaymentId).filter((id): id is string => Boolean(id))),
  };
}

/** Facturas emitidas con pendiente neto (total + rectificativas − cobros) > 0. */
export async function listOpenCustomerInvoices(companyId: string, limit = 500): Promise<WorkbenchInvoiceOption[]> {
  const paid = paidByInvoiceSubquery(companyId);
  const credited = creditedByInvoiceSubquery(companyId);
  const outstanding = netOutstandingSql(paid, credited);
  const rows = await db
    .select({
      id: invoice.id,
      number: invoice.number,
      partnerId: customer.partnerId,
      partnerName: customer.name,
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
    .limit(limit);
  return rows.map((row) => ({ ...row, kind: "customer" as const, altNumber: null, href: `/invoices/${row.id}` }));
}

/** Facturas de proveedor no anuladas con pendiente (total − pagos) > 0. */
export async function listOpenSupplierInvoices(companyId: string, limit = 500): Promise<WorkbenchInvoiceOption[]> {
  const paid = db
    .select({
      supplierInvoiceId: supplierInvoicePayment.supplierInvoiceId,
      paidAmount: sql<string>`coalesce(sum(${supplierInvoicePayment.amountApplied}), 0)`.as("paidAmount"),
    })
    .from(supplierInvoicePayment)
    .where(eq(supplierInvoicePayment.companyId, companyId))
    .groupBy(supplierInvoicePayment.supplierInvoiceId)
    .as("supplier_paid");
  const outstanding = sql<string>`greatest(${supplierInvoice.totalAmount} - coalesce(${paid.paidAmount}, 0), 0)`;
  const rows = await db
    .select({
      id: supplierInvoice.id,
      number: supplierInvoice.number,
      altNumber: supplierInvoice.supplierDocumentNumber,
      partnerId: supplierInvoice.supplierPartnerId,
      partnerName: partner.name,
      outstanding: outstanding.mapWith(Number),
      dueDate: supplierInvoice.dueDate,
      issueDate: supplierInvoice.issueDate,
      origin: supplierInvoice.origin,
    })
    .from(supplierInvoice)
    .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
    .leftJoin(paid, eq(paid.supplierInvoiceId, supplierInvoice.id))
    .where(and(eq(supplierInvoice.companyId, companyId), ne(supplierInvoice.status, "VOID"), sql`${outstanding} > 0`))
    .orderBy(sql`${supplierInvoice.dueDate} asc nulls last`, asc(supplierInvoice.issueDate), asc(supplierInvoice.id))
    .limit(limit);
  return rows.map(({ origin, ...row }) => ({
    ...row,
    kind: "supplier" as const,
    href: origin === "EXPENSE" ? `/expenses/${row.id}` : `/purchases/supplier-invoices?q=${encodeURIComponent(row.number)}`,
  }));
}

async function listCandidatePayments(companyId: string, from: Date, to: Date): Promise<ExistingPaymentCandidate[]> {
  const [used, customerRows, supplierRows] = await Promise.all([
    usedPaymentIds(db, companyId),
    db
      .select({
        id: invoicePayment.id,
        number: payment.number,
        invoiceNumber: invoice.number,
        partnerName: customer.name,
        amount: invoicePayment.amountApplied,
        postedAt: payment.postedAt,
        // Cobros de una remesa de adeudos cobrada: el banco abona el total en un único apunte.
        remittanceId: sepaDirectDebitRemittance.id,
        remittanceNumber: sepaDirectDebitRemittance.number,
      })
      .from(invoicePayment)
      .innerJoin(payment, eq(payment.id, invoicePayment.paymentId))
      .innerJoin(invoice, eq(invoice.id, invoicePayment.invoiceId))
      .innerJoin(customer, eq(customer.id, invoice.customerId))
      .leftJoin(sepaDirectDebitItem, eq(sepaDirectDebitItem.paymentId, payment.id))
      .leftJoin(sepaDirectDebitRemittance, and(eq(sepaDirectDebitRemittance.id, sepaDirectDebitItem.remittanceId), eq(sepaDirectDebitRemittance.status, "COLLECTED")))
      .where(and(eq(invoicePayment.companyId, companyId), gte(payment.postedAt, from), lte(payment.postedAt, to))),
    db
      .select({
        id: supplierInvoicePayment.id,
        number: supplierPayment.number,
        invoiceNumber: supplierInvoice.number,
        partnerName: partner.name,
        amount: supplierInvoicePayment.amountApplied,
        postedAt: supplierPayment.postedAt,
        remittanceId: sepaRemittance.id,
        remittanceNumber: sepaRemittance.number,
      })
      .from(supplierInvoicePayment)
      .innerJoin(supplierPayment, eq(supplierPayment.id, supplierInvoicePayment.supplierPaymentId))
      .innerJoin(supplierInvoice, eq(supplierInvoice.id, supplierInvoicePayment.supplierInvoiceId))
      .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
      .leftJoin(sepaRemittanceItem, eq(sepaRemittanceItem.supplierPaymentId, supplierPayment.id))
      .leftJoin(sepaRemittance, and(eq(sepaRemittance.id, sepaRemittanceItem.remittanceId), eq(sepaRemittance.status, "CONFIRMED")))
      .where(and(eq(supplierInvoicePayment.companyId, companyId), gte(supplierPayment.postedAt, from), lte(supplierPayment.postedAt, to))),
  ]);
  return [
    ...customerRows.filter((row) => !used.customer.has(row.id)).map((row) => ({ ...row, kind: "customer" as const, amount: Number(row.amount) })),
    ...supplierRows.filter((row) => !used.supplier.has(row.id)).map((row) => ({ ...row, kind: "supplier" as const, amount: Number(row.amount) })),
  ];
}

/**
 * Candidatos para conciliar a mano un movimiento pendiente con un cobro/pago ya registrado del
 * mismo importe (API antigua `GET /api/treasury/reconcile`). Excluye los ya conciliados con otro
 * movimiento, tanto 1:1 como repartidos en la mesa de conciliación.
 */
export async function listManualMatchCandidates(companyId: string, transactionId: string) {
  const [row] = await db
    .select({ id: bankTransaction.id, amount: bankTransaction.amount, status: bankTransaction.reconciliationStatus })
    .from(bankTransaction)
    .innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.bankAccountId))
    .where(and(eq(bankTransaction.id, transactionId), eq(bankAccount.companyId, companyId)))
    .limit(1);
  if (!row) return null;
  const kind: "customer" | "supplier" = Number(row.amount) >= 0 ? "customer" : "supplier";
  if (row.status === "RECONCILED") return { kind, candidates: [] };
  const amount = (Math.abs(toCents(row.amount)) / 100).toFixed(2);
  const used = await usedPaymentIds(db, companyId);
  if (kind === "customer") {
    const rows = await db
      .select({ id: invoicePayment.id, number: payment.number, counterparty: customer.name, amount: invoicePayment.amountApplied, postedAt: payment.postedAt })
      .from(invoicePayment)
      .innerJoin(invoice, eq(invoice.id, invoicePayment.invoiceId))
      .innerJoin(customer, eq(customer.id, invoice.customerId))
      .innerJoin(payment, eq(payment.id, invoicePayment.paymentId))
      .where(and(eq(invoicePayment.companyId, companyId), eq(invoicePayment.amountApplied, amount)));
    return { kind, candidates: rows.filter((candidate) => !used.customer.has(candidate.id)) };
  }
  const rows = await db
    .select({ id: supplierInvoicePayment.id, number: supplierPayment.number, counterparty: partner.name, amount: supplierInvoicePayment.amountApplied, postedAt: supplierPayment.postedAt })
    .from(supplierInvoicePayment)
    .innerJoin(supplierInvoice, eq(supplierInvoice.id, supplierInvoicePayment.supplierInvoiceId))
    .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
    .innerJoin(supplierPayment, eq(supplierPayment.id, supplierInvoicePayment.supplierPaymentId))
    .where(and(eq(supplierInvoicePayment.companyId, companyId), eq(supplierInvoicePayment.amountApplied, amount)));
  return { kind, candidates: rows.filter((candidate) => !used.supplier.has(candidate.id)) };
}

export async function listRuleCandidates(companyId: string, client: DbClient = db): Promise<RuleCandidate[]> {
  const rows = await client
    .select({
      id: bankReconciliationRule.id,
      name: bankReconciliationRule.name,
      conceptContains: bankReconciliationRule.conceptContains,
      direction: bankReconciliationRule.direction,
      minAmount: bankReconciliationRule.minAmount,
      maxAmount: bankReconciliationRule.maxAmount,
      accountId: bankReconciliationRule.accountId,
      accountCode: accountChart.code,
      accountName: accountChart.name,
      partnerId: bankReconciliationRule.partnerId,
      partnerName: partner.name,
      autoApply: bankReconciliationRule.autoApply,
    })
    .from(bankReconciliationRule)
    .leftJoin(accountChart, eq(accountChart.id, bankReconciliationRule.accountId))
    .leftJoin(partner, eq(partner.id, bankReconciliationRule.partnerId))
    .where(and(eq(bankReconciliationRule.companyId, companyId), eq(bankReconciliationRule.isActive, true)))
    .orderBy(asc(bankReconciliationRule.createdAt));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    conceptContains: row.conceptContains,
    direction: (row.direction as RuleCandidate["direction"]) ?? "ANY",
    minAmount: row.minAmount === null ? null : Number(row.minAmount),
    maxAmount: row.maxAmount === null ? null : Number(row.maxAmount),
    accountId: row.accountId,
    accountLabel: row.accountCode ? `${row.accountCode} · ${row.accountName}` : null,
    partnerId: row.partnerId,
    partnerName: row.partnerName,
    autoApply: row.autoApply,
  }));
}

/** Movimientos pendientes con sus propuestas, más los datos que necesita la mesa (facturas abiertas y cuentas). */
export async function getReconciliationWorkbench(companyId: string, options: { bankAccountId?: string; limit?: number } = {}) {
  const movements = await db
    .select({
      id: bankTransaction.id,
      bankAccountId: bankTransaction.bankAccountId,
      bankName: bankAccount.bankName,
      amount: bankTransaction.amount,
      description: bankTransaction.description,
      reference: bankTransaction.reference,
      postedAt: bankTransaction.postedAt,
    })
    .from(bankTransaction)
    .innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.bankAccountId))
    .where(and(
      eq(bankAccount.companyId, companyId),
      eq(bankTransaction.reconciliationStatus, "PENDING"),
      options.bankAccountId ? eq(bankTransaction.bankAccountId, options.bankAccountId) : undefined,
    ))
    .orderBy(asc(bankTransaction.postedAt), asc(bankTransaction.id))
    .limit(options.limit ?? WORKBENCH_LIMIT);

  const times = movements.map((movement) => movement.postedAt.getTime());
  const from = new Date(Math.min(...times, Date.now()) - 7 * 86_400_000);
  const to = new Date(Math.max(...times, Date.now()) + 7 * 86_400_000);
  const [customerInvoices, supplierInvoices, payments, rules] = await Promise.all([
    listOpenCustomerInvoices(companyId),
    listOpenSupplierInvoices(companyId),
    movements.length ? listCandidatePayments(companyId, from, to) : Promise.resolve([]),
    listRuleCandidates(companyId),
  ]);
  const invoices = [...customerInvoices, ...supplierInvoices];

  const rows: WorkbenchMovement[] = movements.map((movement) => {
    const amount = Number(movement.amount);
    return {
      ...movement,
      amount,
      suggestions: rankSuggestions({ ...movement, amount }, { payments, invoices, rules }),
    };
  });
  return { movements: rows, customerInvoices, supplierInvoices, rules };
}

async function lockPendingMovement(client: DbClient, companyId: string, transactionId: string) {
  const [row] = await client
    .select({
      id: bankTransaction.id,
      bankAccountId: bankTransaction.bankAccountId,
      amount: bankTransaction.amount,
      description: bankTransaction.description,
      reference: bankTransaction.reference,
      postedAt: bankTransaction.postedAt,
      status: bankTransaction.reconciliationStatus,
    })
    .from(bankTransaction)
    .innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.bankAccountId))
    .where(and(eq(bankTransaction.id, transactionId), eq(bankAccount.companyId, companyId)))
    .for("update", { of: bankTransaction })
    .limit(1);
  if (!row) throw new AccountingRuleError(404, "BANK_TRANSACTION_NOT_FOUND", "Movimiento no encontrado.");
  return row;
}

async function assertAssignableAccounts(client: DbClient, companyId: string, bankAccountId: string, accountIds: string[]) {
  if (accountIds.length === 0) return new Map<string, { code: string; name: string }>();
  const [rows, settings, bankLedgerId] = await Promise.all([
    client
      .select({ id: accountChart.id, code: accountChart.code, name: accountChart.name })
      .from(accountChart)
      .where(and(eq(accountChart.companyId, companyId), inArray(accountChart.id, accountIds), eq(accountChart.isPostable, true))),
    loadPostingSettings(companyId, client),
    resolveBankLedgerAccountId(client, companyId, { bankAccountId }),
  ]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const accountId of accountIds) {
    const account = byId.get(accountId);
    if (!account) throw new AccountingRuleError(422, "ACCOUNT_INVALID", "La cuenta elegida no existe o no admite apuntes.");
    if (account.code === settings.codes.suspense || account.code.startsWith(settings.codes.suspense)) {
      throw new AccountingRuleError(422, "ACCOUNT_SUSPENSE", "La cuenta 555 es justo la de «pendiente de identificar»: elige la cuenta real del gasto o ingreso.");
    }
    if (account.id === bankLedgerId || (!bankLedgerId && account.code === settings.codes.bank)) {
      throw new AccountingRuleError(422, "ACCOUNT_SAME_BANK", "No puedes asignar un movimiento a la propia cuenta del banco.");
    }
  }
  return byId;
}

export type ApplyAllocationsInput = {
  transactionId: string;
  allocations: AllocationInput[];
  /** Regla de la que viene la propuesta (se cuenta su uso). */
  ruleId?: string | null;
  /** "Recordar para la próxima vez": crea una regla con la cuenta asignada. */
  remember?: RulePayload | null;
  now?: Date;
};

/** Aplica un reparto a un movimiento pendiente dentro de la transacción recibida. */
export async function applyAllocationsInTx(client: DbClient, actor: TreasuryActor, input: ApplyAllocationsInput) {
  const movement = await lockPendingMovement(client, actor.companyId, input.transactionId);
  if (movement.status === "RECONCILED") throw new AccountingRuleError(409, "ALREADY_RECONCILED", "Este movimiento ya está conciliado. Deshazlo primero si quieres cambiarlo.");
  const movementAmount = Number(movement.amount);
  const errors = validateAllocations(movementAmount, input.allocations);
  if (errors.length > 0) throw new AccountingRuleError(422, "ALLOCATION_INVALID", errors.join(" "));

  const now = input.now ?? new Date();
  // Fecha del movimiento si su periodo está abierto; si está presentado/cerrado, hoy.
  const postingDate = await resolveOpenPostingDate(actor.companyId, movement.postedAt, now, client);
  const accountAllocations = input.allocations.filter((allocation) => allocation.type === "ACCOUNT");
  const accounts = await assertAssignableAccounts(client, actor.companyId, movement.bankAccountId, [...new Set(accountAllocations.map((allocation) => allocation.targetId))]);

  const used = input.allocations.some((allocation) => allocation.type === "CUSTOMER_PAYMENT" || allocation.type === "SUPPLIER_PAYMENT")
    ? await usedPaymentIds(client, actor.companyId)
    : { customer: new Set<string>(), supplier: new Set<string>() };

  const rows: Array<typeof bankTransactionAllocation.$inferInsert> = [];
  const created: string[] = [];
  const base = { companyId: actor.companyId, bankTransactionId: movement.id, ruleId: input.ruleId ?? null, createdPayment: false };
  for (const allocation of input.allocations) {
    const amount = (toCents(allocation.amount) / 100).toFixed(2);
    if (allocation.type === "CUSTOMER_INVOICE") {
      const result = await createCustomerPaymentForBank(client, actor, {
        invoiceId: allocation.targetId,
        amount: Number(amount),
        postedAt: postingDate,
        bankAccountId: movement.bankAccountId,
        reference: `Cobro por banco · ${movement.description}`,
      });
      created.push(result.number);
      rows.push({ ...base, kind: "CUSTOMER_PAYMENT", invoicePaymentId: result.applicationId, paymentId: result.paymentId, amount, createdPayment: true });
    } else if (allocation.type === "SUPPLIER_INVOICE") {
      const result = await createSupplierPaymentForBank(client, actor, {
        supplierInvoiceId: allocation.targetId,
        amount: Number(amount),
        postedAt: postingDate,
        bankAccountId: movement.bankAccountId,
        reference: `Pago por banco · ${movement.description}`,
      });
      created.push(result.number);
      rows.push({ ...base, kind: "SUPPLIER_PAYMENT", supplierInvoicePaymentId: result.applicationId, supplierPaymentId: result.paymentId, amount, createdPayment: true });
    } else if (allocation.type === "CUSTOMER_PAYMENT") {
      const [existing] = await client
        .select({ id: invoicePayment.id, paymentId: invoicePayment.paymentId, amountApplied: invoicePayment.amountApplied })
        .from(invoicePayment)
        .where(and(eq(invoicePayment.id, allocation.targetId), eq(invoicePayment.companyId, actor.companyId)))
        .limit(1);
      if (!existing) throw new AccountingRuleError(422, "MATCH_INVALID", "El cobro elegido no existe.");
      if (toCents(existing.amountApplied) !== toCents(amount)) throw new AccountingRuleError(422, "MATCH_AMOUNT", "Un cobro ya registrado se concilia por su importe completo.");
      if (used.customer.has(existing.id)) throw new AccountingRuleError(409, "MATCH_USED", "Ese cobro ya está conciliado con otro movimiento.");
      used.customer.add(existing.id);
      rows.push({ ...base, kind: "CUSTOMER_PAYMENT", invoicePaymentId: existing.id, paymentId: existing.paymentId, amount });
    } else if (allocation.type === "SUPPLIER_PAYMENT") {
      const [existing] = await client
        .select({ id: supplierInvoicePayment.id, paymentId: supplierInvoicePayment.supplierPaymentId, amountApplied: supplierInvoicePayment.amountApplied })
        .from(supplierInvoicePayment)
        .where(and(eq(supplierInvoicePayment.id, allocation.targetId), eq(supplierInvoicePayment.companyId, actor.companyId)))
        .limit(1);
      if (!existing) throw new AccountingRuleError(422, "MATCH_INVALID", "El pago elegido no existe.");
      if (toCents(existing.amountApplied) !== toCents(amount)) throw new AccountingRuleError(422, "MATCH_AMOUNT", "Un pago ya registrado se concilia por su importe completo.");
      if (used.supplier.has(existing.id)) throw new AccountingRuleError(409, "MATCH_USED", "Ese pago ya está conciliado con otro movimiento.");
      used.supplier.add(existing.id);
      rows.push({ ...base, kind: "SUPPLIER_PAYMENT", supplierInvoicePaymentId: existing.id, supplierPaymentId: existing.paymentId, amount });
    } else {
      rows.push({ ...base, kind: "ACCOUNT", accountId: allocation.targetId, amount });
    }
  }

  const reversed = await reverseAutomaticEntries({
    tenantId: actor.tenantId,
    companyId: actor.companyId,
    actorUserId: actor.actorUserId,
    postedAt: postingDate,
    reference: `Conciliación movimiento ${movement.description}`.slice(0, 200),
    sourceType: "bankTransaction",
    sourceId: movement.id,
    reason: "Movimiento identificado: se anula el apunte pendiente de aplicación (555)",
    dbClient: client,
  });
  if (accountAllocations.length > 0) {
    await postBankTransactionAssignment({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      postedAt: postingDate,
      reference: `Movimiento asignado a cuenta · ${movement.description}`.slice(0, 200),
      bankTransactionId: movement.id,
      bankAccountId: movement.bankAccountId,
      movementAmount,
      allocations: accountAllocations.map((allocation) => ({ accountId: allocation.targetId, amount: allocation.amount })),
      dbClient: client,
    });
  }
  await client.insert(bankTransactionAllocation).values(rows);

  const single = rows.length === 1 ? rows[0] : null;
  const resolution = resolutionOf(input.allocations);
  await client
    .update(bankTransaction)
    .set({
      reconciliationStatus: "RECONCILED",
      reconciledAt: now,
      resolution,
      matchedInvoicePaymentId: single?.kind === "CUSTOMER_PAYMENT" ? single.invoicePaymentId ?? null : null,
      matchedSupplierPaymentId: single?.kind === "SUPPLIER_PAYMENT" ? single.supplierInvoicePaymentId ?? null : null,
    })
    .where(eq(bankTransaction.id, movement.id));

  if (input.ruleId) {
    await client
      .update(bankReconciliationRule)
      .set({ timesApplied: sql`${bankReconciliationRule.timesApplied} + 1`, lastAppliedAt: now })
      .where(and(eq(bankReconciliationRule.id, input.ruleId), eq(bankReconciliationRule.companyId, actor.companyId)));
  }
  let rememberedRuleId: string | null = null;
  if (input.remember) {
    const rule = await createReconciliationRule(actor, input.remember, client);
    rememberedRuleId = rule.id;
  }

  await recordAudit({
    tenantId: actor.tenantId,
    companyId: actor.companyId,
    actorUserId: actor.actorUserId,
    action: "treasury.reconcile.apply",
    entityName: "bankTransaction",
    entityId: movement.id,
    payload: {
      resolution,
      postingDate,
      reversedEntries: reversed,
      allocations: input.allocations.map((allocation) => ({ type: allocation.type, targetId: allocation.targetId, amount: allocation.amount })),
      createdPayments: created,
      ruleId: input.ruleId ?? null,
      rememberedRuleId,
    },
  }, client);

  return {
    transactionId: movement.id,
    resolution,
    createdPayments: created,
    accounts: accountAllocations.map((allocation) => accounts.get(allocation.targetId)?.code ?? ""),
    rememberedRuleId,
  };
}

export function applyAllocations(actor: TreasuryActor, input: ApplyAllocationsInput) {
  return db.transaction((tx) => applyAllocationsInTx(tx, actor, input));
}

/** Deshace la conciliación de un movimiento (cualquiera que fuera su resolución). */
export async function undoReconciliationInTx(client: DbClient, actor: Omit<TreasuryActor, "activeFiscalYearId">, transactionId: string, now = new Date()) {
  const movement = await lockPendingMovement(client, actor.companyId, transactionId);
  if (movement.status !== "RECONCILED") throw new AccountingRuleError(409, "NOT_RECONCILED", "El movimiento ya está pendiente de conciliar.");
  const returned = await returnedItemForMovement(client, actor.companyId, movement.id);
  if (returned) {
    throw new AccountingRuleError(409, "RETURN_MOVEMENT", `Este cargo es la devolución del recibo ${returned.endToEndId}: gestiónalo desde su remesa de cobros.`);
  }
  const allocations = await client
    .select({
      id: bankTransactionAllocation.id,
      kind: bankTransactionAllocation.kind,
      paymentId: bankTransactionAllocation.paymentId,
      supplierPaymentId: bankTransactionAllocation.supplierPaymentId,
      createdPayment: bankTransactionAllocation.createdPayment,
    })
    .from(bankTransactionAllocation)
    .where(and(eq(bankTransactionAllocation.bankTransactionId, movement.id), eq(bankTransactionAllocation.companyId, actor.companyId)));

  // Conciliaciones anteriores a la mesa (un único cobro/pago en las columnas del movimiento).
  if (allocations.length === 0) {
    const updated = await unreconcileBankTransaction(client, { ...actor, transactionId, now });
    return { transactionId: updated.id, removedPayments: 0 };
  }

  const postingDate = await resolveOpenPostingDate(actor.companyId, movement.postedAt, now, client);
  // Primero se desvincula (las FK de las partidas pasan a null al borrar cobros/pagos).
  await client.delete(bankTransactionAllocation).where(eq(bankTransactionAllocation.bankTransactionId, movement.id));
  let removedPayments = 0;
  for (const allocation of allocations) {
    if (!allocation.createdPayment) continue;
    if (allocation.kind === "CUSTOMER_PAYMENT" && allocation.paymentId) {
      if (await removeTreasuryCustomerPayment(client, actor, allocation.paymentId)) removedPayments += 1;
    } else if (allocation.kind === "SUPPLIER_PAYMENT" && allocation.supplierPaymentId) {
      if (await removeTreasurySupplierPayment(client, actor, allocation.supplierPaymentId)) removedPayments += 1;
    }
  }
  await reverseAutomaticEntries({
    tenantId: actor.tenantId,
    companyId: actor.companyId,
    actorUserId: actor.actorUserId,
    postedAt: postingDate,
    reference: `Deshacer asignación · ${movement.description}`.slice(0, 200),
    sourceType: "bankTransactionAssignment",
    sourceId: movement.id,
    reason: "Asignación a cuenta deshecha: el movimiento vuelve a pendiente",
    dbClient: client,
  });
  await postBankTransaction({
    tenantId: actor.tenantId,
    companyId: actor.companyId,
    actorUserId: actor.actorUserId,
    bankTransactionId: movement.id,
    bankAccountId: movement.bankAccountId,
    postedAt: postingDate,
    reference: `Movimiento pendiente de identificar · ${movement.description}`.slice(0, 200),
    amount: Number(movement.amount),
    dbClient: client,
  });
  await client
    .update(bankTransaction)
    .set({ reconciliationStatus: "PENDING", reconciledAt: null, resolution: null, matchedInvoicePaymentId: null, matchedSupplierPaymentId: null })
    .where(eq(bankTransaction.id, movement.id));
  await recordAudit({
    tenantId: actor.tenantId,
    companyId: actor.companyId,
    actorUserId: actor.actorUserId,
    action: "treasury.reconcile.undo",
    entityName: "bankTransaction",
    entityId: movement.id,
    payload: { postingDate, removedPayments, allocations: allocations.length },
  }, client);
  return { transactionId: movement.id, removedPayments };
}

export function undoReconciliation(actor: Omit<TreasuryActor, "activeFiscalYearId">, transactionId: string) {
  return db.transaction((tx) => undoReconciliationInTx(tx, actor, transactionId));
}

type BulkResult = { applied: Array<{ transactionId: string; title: string }>; skipped: Array<{ transactionId: string; reason: string }> };

/**
 * "Aceptar todas las seguras": aplica la mejor propuesta de cada movimiento cuando es segura.
 * Cada movimiento va en su propia transacción; si uno falla (periodo cerrado…) se informa y sigue.
 */
export async function acceptSafeSuggestions(actor: TreasuryActor, options: { bankAccountId?: string; transactionIds?: string[] } = {}): Promise<BulkResult> {
  const workbench = await getReconciliationWorkbench(actor.companyId, { bankAccountId: options.bankAccountId });
  const wanted = options.transactionIds ? new Set(options.transactionIds) : null;
  const result: BulkResult = { applied: [], skipped: [] };
  for (const movement of workbench.movements) {
    if (wanted && !wanted.has(movement.id)) continue;
    const best = movement.suggestions[0];
    if (!best?.safe) continue;
    try {
      await applyAllocations(actor, { transactionId: movement.id, allocations: best.allocations, ruleId: best.ruleId ?? null });
      result.applied.push({ transactionId: movement.id, title: best.title });
    } catch (error) {
      if (!isAccountingRuleError(error)) throw error;
      result.skipped.push({ transactionId: movement.id, reason: error.message });
    }
  }
  return result;
}

/** Tras importar: aplica las reglas marcadas como "aplicar automáticamente" (solo si casa una). */
export async function autoApplyRules(actor: TreasuryActor, transactionIds: string[]) {
  if (transactionIds.length === 0) return { applied: 0, skipped: 0 };
  const rules = (await listRuleCandidates(actor.companyId)).filter((rule) => rule.autoApply && rule.accountId);
  if (rules.length === 0) return { applied: 0, skipped: 0 };
  const movements = await db
    .select({ id: bankTransaction.id, amount: bankTransaction.amount, description: bankTransaction.description, reference: bankTransaction.reference })
    .from(bankTransaction)
    .innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.bankAccountId))
    .where(and(eq(bankAccount.companyId, actor.companyId), inArray(bankTransaction.id, transactionIds), eq(bankTransaction.reconciliationStatus, "PENDING")));
  let applied = 0;
  let skipped = 0;
  for (const movement of movements) {
    const amount = Number(movement.amount);
    const matches = rules.filter((rule) => matchRule(rule, { ...movement, amount }));
    if (matches.length !== 1) continue;
    const rule = matches[0];
    try {
      await applyAllocations(actor, {
        transactionId: movement.id,
        allocations: [{ type: "ACCOUNT", targetId: rule.accountId as string, amount: Math.abs(amount) }],
        ruleId: rule.id,
      });
      applied += 1;
    } catch (error) {
      if (!isAccountingRuleError(error)) throw error;
      skipped += 1;
    }
  }
  return { applied, skipped };
}

/** Partidas de un movimiento conciliado, para enseñarlas en su ficha. */
export async function listTransactionAllocations(companyId: string, transactionId: string) {
  return db
    .select({
      id: bankTransactionAllocation.id,
      kind: bankTransactionAllocation.kind,
      amount: bankTransactionAllocation.amount,
      createdPayment: bankTransactionAllocation.createdPayment,
      accountCode: accountChart.code,
      accountName: accountChart.name,
      paymentNumber: payment.number,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      supplierPaymentNumber: supplierPayment.number,
      supplierInvoiceId: supplierInvoice.id,
      supplierInvoiceNumber: supplierInvoice.number,
      supplierInvoiceOrigin: supplierInvoice.origin,
    })
    .from(bankTransactionAllocation)
    .leftJoin(accountChart, eq(accountChart.id, bankTransactionAllocation.accountId))
    .leftJoin(payment, eq(payment.id, bankTransactionAllocation.paymentId))
    .leftJoin(invoice, eq(invoice.id, payment.invoiceId))
    .leftJoin(supplierPayment, eq(supplierPayment.id, bankTransactionAllocation.supplierPaymentId))
    .leftJoin(supplierInvoice, eq(supplierInvoice.id, supplierPayment.supplierInvoiceId))
    .where(and(eq(bankTransactionAllocation.companyId, companyId), eq(bankTransactionAllocation.bankTransactionId, transactionId)))
    .orderBy(asc(bankTransactionAllocation.createdAt));
}

/** Cuentas imputables para "Asignar a cuenta" (sin 555; la del propio banco se rechaza al aplicar). */
export async function listAssignableAccounts(companyId: string) {
  const settings = await loadPostingSettings(companyId);
  return db
    .select({ id: accountChart.id, code: accountChart.code, name: accountChart.name })
    .from(accountChart)
    .where(and(
      eq(accountChart.companyId, companyId),
      eq(accountChart.isPostable, true),
      sql`${accountChart.code} not like ${`${settings.codes.suspense}%`}`,
    ))
    .orderBy(asc(accountChart.code));
}
