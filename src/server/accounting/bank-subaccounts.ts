import { and, asc, eq, inArray, like, sql } from "drizzle-orm";

import { accountChart, bankAccount, bankTransaction, company, journalEntry, journalLine, payment, paymentMethod, supplierPayment } from "@/db/schema";
import type { DbClient } from "@/lib/db";
import {
  BANK_SUBACCOUNT_PREFIX,
  CASH_ACCOUNT_CODE,
  ensureBankSubaccount,
  ensureSubaccount,
  forgetChartMemo,
  getSubaccountLength,
} from "@/server/accounting/subaccounts";
import { canonicalSubaccountCode } from "@/server/accounting/subaccounts-model";
import { ensureCashPaymentMethod } from "@/server/treasury/cash-payment-method";

export type BankSubaccountReport = {
  companyId: string;
  companyName: string;
  applied: boolean;
  cashPaymentMethodCreated: boolean;
  banks: Array<{ bankName: string; iban: string; from: string | null; to: string }>;
  movedLines: Array<{ entry: string; concept: string | null; amount: string; from: string; to: string }>;
  /** Apuntes que siguen en la subcuenta genérica de bancos (sin banco ni efectivo identificable). */
  remainingGenericLines: number;
};

type MethodRow = { bankAccountId: string | null; type: string };

async function treasuryTotal(tx: DbClient, companyId: string) {
  const [row] = await tx
    .select({ net: sql<string>`coalesce(sum(${journalLine.debit} - ${journalLine.credit}), 0)::text` })
    .from(journalLine)
    .innerJoin(accountChart, eq(accountChart.id, journalLine.accountId))
    .where(and(eq(accountChart.companyId, companyId), like(accountChart.code, "57%")));
  return row?.net ?? "0";
}

/**
 * Da a cada cuenta bancaria su propia subcuenta 572 y mueve a ella los apuntes de la subcuenta
 * genérica de bancos (57200000) que vienen de sus cobros, pagos y movimientos; los cobros y pagos
 * con una forma de pago en efectivo pasan a caja (57000000). Crea la forma de pago «Efectivo».
 * Solo cambia la subcuenta dentro del grupo 57: el saldo total de tesorería no varía. Idempotente.
 */
export async function assignBankSubaccounts(tx: DbClient, companyId: string, options: { apply: boolean }): Promise<BankSubaccountReport> {
  const [companyRow] = await tx.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1);
  if (!companyRow) throw new Error(`Empresa ${companyId} no encontrada.`);
  const totalBefore = await treasuryTotal(tx, companyId);
  const report: BankSubaccountReport = {
    companyId,
    companyName: companyRow.name,
    applied: options.apply,
    cashPaymentMethodCreated: (await ensureCashPaymentMethod(tx, companyId)).created,
    banks: [],
    movedLines: [],
    remainingGenericLines: 0,
  };

  const accountCodes = new Map<string, string>();
  const codeOf = async (accountId: string | null) => {
    if (!accountId) return null;
    if (!accountCodes.has(accountId)) {
      const [row] = await tx.select({ code: accountChart.code }).from(accountChart).where(eq(accountChart.id, accountId)).limit(1);
      accountCodes.set(accountId, row?.code ?? "?");
    }
    return accountCodes.get(accountId) ?? null;
  };

  const banks = await tx
    .select({ id: bankAccount.id, bankName: bankAccount.bankName, iban: bankAccount.iban, accountId: bankAccount.accountId })
    .from(bankAccount)
    .where(eq(bankAccount.companyId, companyId))
    .orderBy(asc(bankAccount.bankName), asc(bankAccount.id));
  const ledgerByBank = new Map<string, string>();
  for (const bank of banks) {
    const own = await ensureBankSubaccount(tx, companyId, bank);
    accountCodes.set(own.id, own.code);
    ledgerByBank.set(bank.id, own.id);
    if (own.id !== bank.accountId) {
      report.banks.push({ bankName: bank.bankName, iban: bank.iban, from: await codeOf(bank.accountId), to: own.code });
      await tx.update(bankAccount).set({ accountId: own.id }).where(eq(bankAccount.id, bank.id));
    }
  }

  const genericCode = canonicalSubaccountCode(BANK_SUBACCOUNT_PREFIX, await getSubaccountLength(companyId, tx));
  const [generic] = genericCode
    ? await tx.select({ id: accountChart.id }).from(accountChart).where(and(eq(accountChart.companyId, companyId), eq(accountChart.code, genericCode))).limit(1)
    : [];
  if (generic && genericCode) {
    const lines = await tx
      .select({
        id: journalLine.id,
        debit: journalLine.debit,
        credit: journalLine.credit,
        concept: journalLine.concept,
        entry: journalEntry.number,
        sourceType: journalEntry.sourceType,
        sourceId: journalEntry.sourceId,
      })
      .from(journalLine)
      .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
      .where(eq(journalLine.accountId, generic.id))
      .orderBy(asc(journalEntry.postedAt), asc(journalEntry.number));

    const methods = new Map<string, MethodRow>(
      (await tx.select({ id: paymentMethod.id, bankAccountId: paymentMethod.bankAccountId, type: paymentMethod.type }).from(paymentMethod).where(eq(paymentMethod.companyId, companyId)))
        .map((row) => [row.id, row]),
    );
    const ids = (type: string[]) => [...new Set(lines.filter((line) => line.sourceId && type.includes(line.sourceType ?? "")).map((line) => line.sourceId as string))];
    const paymentIds = ids(["payment"]);
    const supplierPaymentIds = ids(["supplierPayment"]);
    const transactionIds = ids(["bankTransaction", "bankTransactionAssignment"]);
    const customerPayments = new Map(
      (paymentIds.length ? await tx.select({ id: payment.id, methodId: payment.paymentMethodId }).from(payment).where(inArray(payment.id, paymentIds)) : [])
        .map((row) => [row.id, { bankAccountId: null as string | null, methodId: row.methodId }]),
    );
    const supplierPayments = new Map(
      (supplierPaymentIds.length ? await tx.select({ id: supplierPayment.id, bankAccountId: supplierPayment.bankAccountId, methodId: supplierPayment.paymentMethodId }).from(supplierPayment).where(inArray(supplierPayment.id, supplierPaymentIds)) : [])
        .map((row) => [row.id, row]),
    );
    const transactions = new Map(
      (transactionIds.length ? await tx.select({ id: bankTransaction.id, bankAccountId: bankTransaction.bankAccountId }).from(bankTransaction).where(inArray(bankTransaction.id, transactionIds)) : [])
        .map((row) => [row.id, { bankAccountId: row.bankAccountId as string | null, methodId: null as string | null }]),
    );

    let cashAccountId: string | null = null;
    const moves = new Map<string, string[]>();
    for (const line of lines) {
      const source = !line.sourceId ? undefined
        : line.sourceType === "payment" ? customerPayments.get(line.sourceId)
        : line.sourceType === "supplierPayment" ? supplierPayments.get(line.sourceId)
        : line.sourceType === "bankTransaction" || line.sourceType === "bankTransactionAssignment" ? transactions.get(line.sourceId)
        : undefined;
      const method = source?.methodId ? methods.get(source.methodId) : undefined;
      const bankId = source?.bankAccountId ?? method?.bankAccountId ?? null;
      let target = bankId ? ledgerByBank.get(bankId) ?? null : null;
      if (!target && !bankId && method?.type === "CASH") {
        cashAccountId ??= (await ensureSubaccount(companyId, CASH_ACCOUNT_CODE, tx)).id;
        target = cashAccountId;
      }
      if (!target || target === generic.id) {
        report.remainingGenericLines += 1;
        continue;
      }
      moves.set(target, [...(moves.get(target) ?? []), line.id]);
      report.movedLines.push({
        entry: line.entry,
        concept: line.concept,
        amount: Number(line.debit) > 0 ? line.debit : `-${line.credit}`,
        from: genericCode,
        to: (await codeOf(target)) ?? "?",
      });
    }
    for (const [accountId, lineIds] of moves) {
      await tx.update(journalLine).set({ accountId }).where(inArray(journalLine.id, lineIds));
    }
  }

  forgetChartMemo(tx);
  const totalAfter = await treasuryTotal(tx, companyId);
  if (Number(totalBefore) !== Number(totalAfter)) {
    throw new Error(`El saldo de tesorería (grupo 57) cambiaría de ${totalBefore} a ${totalAfter}: se deshace la empresa.`);
  }
  return report;
}

class DryRunRollback extends Error {
  constructor(readonly report: BankSubaccountReport) {
    super("dry-run");
  }
}

type TransactionalDb = { transaction: <T>(work: (tx: DbClient) => Promise<T>) => Promise<T> };

/** Una transacción por empresa; en ensayo (por defecto) se ejecuta todo y se deshace al final. */
export async function runBankSubaccountAssignment(database: TransactionalDb, options: { apply: boolean; companyId: string }) {
  try {
    return await database.transaction(async (tx) => {
      const report = await assignBankSubaccounts(tx, options.companyId, options);
      if (!options.apply) throw new DryRunRollback(report);
      return report;
    });
  } catch (error) {
    if (error instanceof DryRunRollback) return error.report;
    throw error;
  }
}

export function formatBankSubaccountReport(report: BankSubaccountReport) {
  const out = [`== ${report.companyName} (${report.companyId}) · ${report.applied ? "APLICADO" : "ENSAYO (sin cambios)"}`];
  out.push(report.cashPaymentMethodCreated ? "  + Forma de pago «Efectivo» creada (se contabiliza en caja 57000000)." : "  · Ya tenía forma de pago en efectivo.");
  if (report.banks.length === 0) out.push("  · Todos los bancos tenían ya su subcuenta propia.");
  for (const bank of report.banks) out.push(`  + ${bank.bankName} ···${bank.iban.replace(/\s+/g, "").slice(-4)}: ${bank.from ?? "sin subcuenta (572 genérica)"} → ${bank.to}`);
  for (const line of report.movedLines) out.push(`    ${line.entry} ${line.amount.padStart(10)}  ${line.from} → ${line.to}  ${line.concept ?? ""}`);
  out.push(`  Apuntes movidos: ${report.movedLines.length} · siguen en la 572 genérica: ${report.remainingGenericLines}`);
  return out.join("\n");
}
