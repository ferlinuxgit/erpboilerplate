import { count, eq, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { journalEntry, journalLine } from "@/db/schema";
import { db } from "@/lib/db";
import type { ListParams, ListParamsConfig } from "@/lib/list-params";
import {
  countRows,
  listOrderBy,
  listWhere,
  paginate,
  unfilteredTotal,
  windowCount,
  windowTotals,
} from "@/server/lists/paginate";

/** Server-paginated journal (`/accounting/entries`), same rows as `listJournalEntries`. */

export const journalEntrySortKeys = ["postedAt", "number", "debit", "credit"] as const;
export type JournalEntrySortKey = (typeof journalEntrySortKeys)[number];

export const JOURNAL_ENTRIES_PAGE_SIZE = 20;
export const JOURNAL_ENTRIES_PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

export const journalEntryListConfig: ListParamsConfig<JournalEntrySortKey> = {
  sortKeys: journalEntrySortKeys,
  // Latest date first, then latest number (the tiebreaker): a new entry lands on page 1.
  defaultSort: { key: "postedAt", dir: "desc" },
  pageSizeOptions: JOURNAL_ENTRIES_PAGE_SIZE_OPTIONS,
  defaultPageSize: JOURNAL_ENTRIES_PAGE_SIZE,
};

export async function listJournalEntriesPage(companyId: string, params: ListParams<JournalEntrySortKey>) {
  // Debit/credit per entry, aggregated once and restricted to the company's entries.
  const lineTotals = db
    .select({
      journalEntryId: journalLine.journalEntryId,
      debit: sql<string>`sum(${journalLine.debit})`.as("debit"),
      credit: sql<string>`sum(${journalLine.credit})`.as("credit"),
    })
    .from(journalLine)
    .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
    .where(eq(journalEntry.companyId, companyId))
    .groupBy(journalLine.journalEntryId)
    .as("journal_entry_totals");
  const debit = sql<string>`coalesce(${lineTotals.debit}, 0)`;
  const credit = sql<string>`coalesce(${lineTotals.credit}, 0)`;

  const where = listWhere({
    base: [eq(journalEntry.companyId, companyId)],
    search: {
      q: params.q,
      columns: [journalEntry.number, journalEntry.reference, sql`${debit}::text`, sql`${credit}::text`],
    },
    dateRange: { column: journalEntry.postedAt, from: params.from, to: params.to },
  });
  const sortColumns: Record<JournalEntrySortKey, AnyColumn | SQL> = {
    postedAt: journalEntry.postedAt,
    number: journalEntry.number,
    debit,
    credit,
  };

  const result = await paginate({
    page: params.page,
    pageSize: params.pageSize,
    fetchPage: (limit, offset) =>
      db
        .select({
          id: journalEntry.id,
          number: journalEntry.number,
          postedAt: journalEntry.postedAt,
          reference: journalEntry.reference,
          isAutomatic: journalEntry.isAutomatic,
          reversedAt: journalEntry.reversedAt,
          reversesEntryId: journalEntry.reversesEntryId,
          sourceType: journalEntry.sourceType,
          debit,
          credit,
          total: windowCount(),
          ...windowTotals({ sumDebit: debit, sumCredit: credit }),
        })
        .from(journalEntry)
        .leftJoin(lineTotals, eq(lineTotals.journalEntryId, journalEntry.id))
        .where(where)
        // `number` is unique per company: stable order and "same date → latest number first".
        .orderBy(...listOrderBy(sortColumns, params, journalEntry.number))
        .limit(limit)
        .offset(offset),
    countAll: () =>
      countRows(
        db
          .select({ value: count() })
          .from(journalEntry)
          .leftJoin(lineTotals, eq(lineTotals.journalEntryId, journalEntry.id))
          .where(where),
      ),
  });

  const recordCount = await unfilteredTotal(params, result.total, () =>
    countRows(db.select({ value: count() }).from(journalEntry).where(eq(journalEntry.companyId, companyId))),
  );
  const firstRow = result.rows[0];

  return {
    ...result,
    unfilteredTotal: recordCount,
    totals: { debit: firstRow?.sumDebit ?? 0, credit: firstRow?.sumCredit ?? 0 },
    rows: result.rows.map((row) => ({
      id: row.id,
      number: row.number,
      postedAt: row.postedAt,
      reference: row.reference,
      isAutomatic: row.isAutomatic,
      reversedAt: row.reversedAt,
      reversesEntryId: row.reversesEntryId,
      sourceType: row.sourceType,
      debit: String(row.debit),
      credit: String(row.credit),
    })),
  };
}
