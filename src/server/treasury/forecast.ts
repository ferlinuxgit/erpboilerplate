import { and, desc, eq, gt, gte, isNotNull, sql } from "drizzle-orm";

import { bankAccount, bankReconciliationRule, bankTransaction, bankTransactionAllocation, journalLine } from "@/db/schema";
import { db } from "@/lib/db";
import { buildForecast, projectRecurring, startOfUtcDay, type ForecastItem } from "@/server/treasury/forecast-model";
import { listOpenCustomerInvoices, listOpenSupplierInvoices } from "@/server/treasury/workbench";

export type BalanceSource = "STATEMENT" | "LEDGER" | "MOVEMENTS";

export type AccountBalance = {
  id: string;
  bankName: string;
  iban: string;
  balance: number;
  source: BalanceSource;
  asOf: Date | null;
};

/**
 * Saldo actual de cada cuenta activa:
 * 1. el del último extracto importado con saldo (lo que dice el banco) más los movimientos posteriores;
 * 2. si no hay extracto con saldo, el saldo contable de su subcuenta 57x;
 * 3. si la cuenta no tiene subcuenta propia, la suma de sus movimientos.
 */
export async function getCurrentBankBalances(companyId: string): Promise<AccountBalance[]> {
  const accounts = await db
    .select({ id: bankAccount.id, bankName: bankAccount.bankName, iban: bankAccount.iban, accountId: bankAccount.accountId })
    .from(bankAccount)
    .where(and(eq(bankAccount.companyId, companyId), eq(bankAccount.isActive, true)))
    .orderBy(bankAccount.bankName, bankAccount.id);

  return Promise.all(accounts.map(async (account): Promise<AccountBalance> => {
    const [statement] = await db
      .select({ postedAt: bankTransaction.postedAt, balanceAfter: bankTransaction.balanceAfter })
      .from(bankTransaction)
      .where(and(eq(bankTransaction.bankAccountId, account.id), isNotNull(bankTransaction.balanceAfter)))
      .orderBy(desc(bankTransaction.postedAt), desc(bankTransaction.id))
      .limit(1);
    if (statement?.balanceAfter !== null && statement?.balanceAfter !== undefined) {
      const [after] = await db
        .select({ total: sql<string>`coalesce(sum(${bankTransaction.amount}), 0)` })
        .from(bankTransaction)
        .where(and(eq(bankTransaction.bankAccountId, account.id), gt(bankTransaction.postedAt, statement.postedAt)));
      return { ...account, balance: Number(statement.balanceAfter) + Number(after?.total ?? 0), source: "STATEMENT", asOf: statement.postedAt };
    }
    if (account.accountId) {
      const [ledger] = await db
        .select({ total: sql<string>`coalesce(sum(${journalLine.debit} - ${journalLine.credit}), 0)` })
        .from(journalLine)
        .where(eq(journalLine.accountId, account.accountId));
      return { ...account, balance: Number(ledger?.total ?? 0), source: "LEDGER", asOf: null };
    }
    const [movements] = await db
      .select({ total: sql<string>`coalesce(sum(${bankTransaction.amount}), 0)` })
      .from(bankTransaction)
      .where(eq(bankTransaction.bankAccountId, account.id));
    return { ...account, balance: Number(movements?.total ?? 0), source: "MOVEMENTS", asOf: null };
  }));
}

async function recurringHistory(companyId: string, since: Date) {
  const rows = await db
    .select({
      ruleId: bankReconciliationRule.id,
      ruleName: bankReconciliationRule.name,
      postedAt: bankTransaction.postedAt,
      amount: bankTransaction.amount,
    })
    .from(bankTransactionAllocation)
    .innerJoin(bankReconciliationRule, eq(bankReconciliationRule.id, bankTransactionAllocation.ruleId))
    .innerJoin(bankTransaction, eq(bankTransaction.id, bankTransactionAllocation.bankTransactionId))
    .where(and(
      eq(bankTransactionAllocation.companyId, companyId),
      eq(bankTransactionAllocation.kind, "ACCOUNT"),
      eq(bankReconciliationRule.isActive, true),
      gte(bankTransaction.postedAt, since),
    ));
  return rows.map((row) => ({ ...row, amount: Number(row.amount) }));
}

export async function getTreasuryForecast(companyId: string, options: { horizonDays: number; today?: Date }) {
  const today = startOfUtcDay(options.today ?? new Date());
  const [balances, receivables, payables, history] = await Promise.all([
    getCurrentBankBalances(companyId),
    listOpenCustomerInvoices(companyId, 2000),
    listOpenSupplierInvoices(companyId, 2000),
    recurringHistory(companyId, new Date(today.getTime() - 150 * 86_400_000)),
  ]);
  const items: ForecastItem[] = [
    ...receivables.map((row) => ({ id: row.id, kind: "receivable" as const, label: row.number, partnerName: row.partnerName, amount: row.outstanding, dueDate: row.dueDate, href: row.href })),
    ...payables.map((row) => ({ id: row.id, kind: "payable" as const, label: row.number, partnerName: row.partnerName, amount: -row.outstanding, dueDate: row.dueDate, href: row.href })),
    ...projectRecurring(history, today, options.horizonDays),
  ];
  const openingBalance = balances.reduce((sum, account) => sum + account.balance, 0);
  return { balances, forecast: buildForecast({ openingBalance, today, horizonDays: options.horizonDays, items }) };
}
