import { and, count, eq, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { bankAccount, bankTransaction, reconciliationStatusEnum } from "@/db/schema";
import { db } from "@/lib/db";
import type { ListParams, ListParamsConfig } from "@/lib/list-params";
import { countRows, listOrderBy, listWhere, paginate, unfilteredTotal, windowCount } from "@/server/lists/paginate";

/**
 * Server-paginated bank transactions (`/treasury/bank-transactions`). `bank_transaction`
 * has no companyId: rows are scoped through the inner join on `bank_account.companyId`.
 */

export const bankTransactionSortKeys = ["postedAt", "description", "amount", "status"] as const;
export type BankTransactionSortKey = (typeof bankTransactionSortKeys)[number];
export type BankTransactionFilterKey = "account" | "reconciliation";

/** `accountIds`: the company's own bank accounts (anything else in `?account=` is ignored). */
export function bankTransactionListConfig(accountIds: readonly string[]): ListParamsConfig<BankTransactionSortKey, BankTransactionFilterKey> {
  return {
    sortKeys: bankTransactionSortKeys,
    // Latest movement first (id breaks ties).
    defaultSort: { key: "postedAt", dir: "desc" },
    filters: { account: accountIds, reconciliation: reconciliationStatusEnum.enumValues },
  };
}

type ReconciliationStatus = (typeof reconciliationStatusEnum.enumValues)[number];

/**
 * Fixed scope of a page that embeds the list (e.g. only pending movements in reconciliation,
 * or one account). Unlike URL filters it also applies to the unfiltered total.
 */
export type BankTransactionScope = { bankAccountId?: string; reconciliationStatus?: ReconciliationStatus };

function scopeConditions(companyId: string, scope: BankTransactionScope = {}) {
  return and(
    eq(bankAccount.companyId, companyId),
    scope.bankAccountId ? eq(bankTransaction.bankAccountId, scope.bankAccountId) : undefined,
    scope.reconciliationStatus ? eq(bankTransaction.reconciliationStatus, scope.reconciliationStatus) : undefined,
  );
}

export async function listBankTransactionsPage(
  companyId: string,
  params: ListParams<BankTransactionSortKey, BankTransactionFilterKey>,
  scope: BankTransactionScope = {},
) {
  const where = listWhere({
    base: [scopeConditions(companyId, scope)],
    search: {
      q: params.q,
      columns: [bankAccount.bankName, bankAccount.iban, bankTransaction.description, sql`${bankTransaction.amount}::text`],
    },
    dateRange: { column: bankTransaction.postedAt, from: params.from, to: params.to },
    filters: [
      params.filters.account ? eq(bankTransaction.bankAccountId, params.filters.account) : undefined,
      params.filters.reconciliation
        ? eq(bankTransaction.reconciliationStatus, params.filters.reconciliation as (typeof reconciliationStatusEnum.enumValues)[number])
        : undefined,
    ],
  });
  const sortColumns: Record<BankTransactionSortKey, AnyColumn | SQL> = {
    postedAt: bankTransaction.postedAt,
    description: bankTransaction.description,
    amount: bankTransaction.amount,
    status: bankTransaction.reconciliationStatus,
  };

  const result = await paginate({
    page: params.page,
    pageSize: params.pageSize,
    fetchPage: (limit, offset) =>
      db
        .select({
          id: bankTransaction.id,
          bankAccountId: bankAccount.id,
          bankName: bankAccount.bankName,
          iban: bankAccount.iban,
          amount: bankTransaction.amount,
          description: bankTransaction.description,
          postedAt: bankTransaction.postedAt,
          reconciliationStatus: bankTransaction.reconciliationStatus,
          total: windowCount(),
        })
        .from(bankTransaction)
        .innerJoin(bankAccount, eq(bankTransaction.bankAccountId, bankAccount.id))
        .where(where)
        .orderBy(...listOrderBy(sortColumns, params, bankTransaction.id))
        .limit(limit)
        .offset(offset),
    countAll: () =>
      countRows(
        db
          .select({ value: count() })
          .from(bankTransaction)
          .innerJoin(bankAccount, eq(bankTransaction.bankAccountId, bankAccount.id))
          .where(where),
      ),
  });

  const recordCount = await unfilteredTotal(params, result.total, () =>
    countRows(
      db
        .select({ value: count() })
        .from(bankTransaction)
        .innerJoin(bankAccount, eq(bankTransaction.bankAccountId, bankAccount.id))
        .where(scopeConditions(companyId, scope)),
    ),
  );

  return {
    ...result,
    unfilteredTotal: recordCount,
    rows: result.rows.map((row) => ({
      id: row.id,
      bankAccountId: row.bankAccountId,
      bankName: row.bankName,
      iban: row.iban,
      amount: row.amount,
      description: row.description,
      postedAt: row.postedAt,
      reconciliationStatus: row.reconciliationStatus,
    })),
  };
}

/**
 * Movement counts and sums of a company (or one bank account) computed in SQL, so summary
 * cards never load the whole bank history.
 */
export async function bankTransactionStats(companyId: string, scope: BankTransactionScope = {}) {
  const [row] = await db
    .select({
      total: count(),
      pending: sql<number>`count(*) filter (where ${bankTransaction.reconciliationStatus} = 'PENDING')`.mapWith(Number),
      balance: sql<string>`coalesce(sum(${bankTransaction.amount}), 0)`,
      income: sql<string>`coalesce(sum(${bankTransaction.amount}) filter (where ${bankTransaction.amount} > 0), 0)`,
      outflow: sql<string>`coalesce(sum(${bankTransaction.amount}) filter (where ${bankTransaction.amount} < 0), 0)`,
    })
    .from(bankTransaction)
    .innerJoin(bankAccount, eq(bankTransaction.bankAccountId, bankAccount.id))
    .where(scopeConditions(companyId, scope));
  const total = Number(row?.total ?? 0);
  const pending = Number(row?.pending ?? 0);
  return {
    total,
    pending,
    reconciled: total - pending,
    balance: Number(row?.balance ?? 0),
    income: Number(row?.income ?? 0),
    outflow: Number(row?.outflow ?? 0),
  };
}

/** Latest movements (newest first), for summaries that link to the full paginated list. */
export async function recentBankTransactions(companyId: string, scope: BankTransactionScope = {}, limit = 20) {
  return db
    .select({
      id: bankTransaction.id,
      bankAccountId: bankAccount.id,
      bankName: bankAccount.bankName,
      iban: bankAccount.iban,
      amount: bankTransaction.amount,
      description: bankTransaction.description,
      postedAt: bankTransaction.postedAt,
      reconciliationStatus: bankTransaction.reconciliationStatus,
    })
    .from(bankTransaction)
    .innerJoin(bankAccount, eq(bankTransaction.bankAccountId, bankAccount.id))
    .where(scopeConditions(companyId, scope))
    .orderBy(sql`${bankTransaction.postedAt} desc`, sql`${bankTransaction.id} desc`)
    .limit(limit);
}
