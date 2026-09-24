import { and, or, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { hasListFilters, type ListParams, type ServerListState, type SortDirection } from "@/lib/list-params";

export type { ServerListState };

/**
 * Building blocks for server-side paginated lists on Drizzle.
 *
 * Typical use in a page:
 *
 * ```ts
 * const params = parseListParams(await searchParams, config);
 * const where = listWhere({
 *   base: [eq(invoice.companyId, companyId)],
 *   search: { q: params.q, columns: [invoice.number, customer.name] },
 *   dateRange: { column: invoice.issueDate, from: params.from, to: params.to },
 *   filters: [params.filters.status ? eq(invoice.paymentStatus, params.filters.status) : undefined],
 * });
 * const result = await paginate({
 *   page: params.page,
 *   pageSize: params.pageSize,
 *   fetchPage: (limit, offset) =>
 *     db.select({ ...columns, ...windowTotals({ totalAmount: invoice.totalAmount }) })
 *       .from(invoice).where(where)
 *       .orderBy(...listOrderBy(sortColumns, params, invoice.id))
 *       .limit(limit).offset(offset),
 *   countAll: () => countRows(db.select({ value: count() }).from(invoice).where(where)),
 * });
 * ```
 *
 * `count(*) over()` / `sum(...) over()` are evaluated over the whole filtered set before
 * LIMIT/OFFSET, so one query returns the page, the total count and footer totals.
 */

/** Escapes LIKE wildcards so user input is matched literally. */
export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** Splits a search into terms (max 5), so "acme 2026" matches rows containing both words. */
export function searchTerms(q: string) {
  return q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
}

type SearchTarget = AnyColumn | SQL;

/**
 * Every term must match (ILIKE, case/accent-sensitive as Postgres ILIKE) at least one column.
 * Columns can be SQL expressions, e.g. sql`${amount}::text`.
 */
export function searchCondition(q: string, columns: SearchTarget[]): SQL | undefined {
  const terms = searchTerms(q);
  if (terms.length === 0 || columns.length === 0) return undefined;
  return and(
    ...terms.map((term) => {
      const pattern = `%${escapeLike(term)}%`;
      return or(...columns.map((column) => sql`${column} ilike ${pattern}`));
    }),
  );
}

/** Inclusive date range on a timestamp column, using UTC calendar days (YYYY-MM-DD). */
export function dateRangeConditions(column: AnyColumn | SQL, from: string | null | undefined, to: string | null | undefined): SQL[] {
  const conditions: SQL[] = [];
  if (from) conditions.push(sql`${column} >= ${new Date(`${from}T00:00:00.000Z`)}`);
  if (to) {
    const end = new Date(`${to}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    conditions.push(sql`${column} < ${end}`);
  }
  return conditions;
}

export function listWhere(input: {
  base: Array<SQL | undefined>;
  search?: { q: string; columns: SearchTarget[] };
  dateRange?: { column: AnyColumn | SQL; from: string | null; to: string | null };
  filters?: Array<SQL | undefined>;
}): SQL | undefined {
  return and(
    ...input.base,
    input.search ? searchCondition(input.search.q, input.search.columns) : undefined,
    ...(input.dateRange ? dateRangeConditions(input.dateRange.column, input.dateRange.from, input.dateRange.to) : []),
    ...(input.filters ?? []),
  );
}

/**
 * ORDER BY for a whitelisted sort key plus a unique tiebreaker (stable pagination).
 * Nulls always go last, whatever the direction.
 */
export function listOrderBy<TSort extends string>(
  sortColumns: Record<TSort, AnyColumn | SQL>,
  params: { orderKey: TSort; orderDir: SortDirection },
  tiebreaker: AnyColumn,
): SQL[] {
  const column = sortColumns[params.orderKey];
  const direction = params.orderDir === "asc" ? sql`asc` : sql`desc`;
  return [sql`${column} ${direction} nulls last`, sql`${tiebreaker} ${direction}`];
}

/** `count(*) over()` column: filtered total repeated on every row. */
export function windowCount() {
  return sql<string>`count(*) over()`.mapWith(Number);
}

/** `sum(expr) over()` columns for footer totals over the whole filtered set (as numbers). */
export function windowTotals<TKey extends string>(expressions: Record<TKey, AnyColumn | SQL>) {
  return Object.fromEntries(
    Object.entries<AnyColumn | SQL>(expressions).map(([key, expression]) => [
      key,
      sql<string>`coalesce(sum(${expression}) over(), 0)`.mapWith(Number),
    ]),
  ) as Record<TKey, SQL<number>>;
}

export type PaginatedRows<TRow> = {
  rows: TRow[];
  /** Rows matching the filters (all pages). */
  total: number;
  /** Page actually returned (clamped when the requested page is past the end). */
  page: number;
  pageSize: number;
  pageCount: number;
};

export async function countRows(query: PromiseLike<Array<{ value: number | string }>>) {
  const [row] = await query;
  return Number(row?.value ?? 0);
}

/**
 * Runs a page query whose rows carry `total` (from `windowCount()`).
 * When the requested page is past the end (e.g. after deleting rows) it counts and
 * returns the last page instead of an empty one.
 */
export async function paginate<TRow extends { total: number | string }>(input: {
  page: number;
  pageSize: number;
  fetchPage: (limit: number, offset: number) => PromiseLike<TRow[]>;
  countAll: () => PromiseLike<number>;
}): Promise<PaginatedRows<TRow>> {
  const pageSize = Math.max(1, Math.floor(input.pageSize));
  let page = Math.max(1, Math.floor(input.page));
  let rows = await input.fetchPage(pageSize, (page - 1) * pageSize);
  let total = rows.length > 0 ? Number(rows[0].total) : 0;

  if (rows.length === 0 && page > 1) {
    total = await input.countAll();
    const lastPage = Math.max(1, Math.ceil(total / pageSize));
    if (lastPage < page) {
      page = lastPage;
      rows = total > 0 ? await input.fetchPage(pageSize, (page - 1) * pageSize) : [];
      if (rows.length > 0) total = Number(rows[0].total);
    }
  }

  return { rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/**
 * Number of records without search/filters, used for "N de M registros" and to tell
 * "no records yet" (show create action) from "no matches". Reuses the filtered total
 * when nothing is filtering.
 */
export async function unfilteredTotal(params: Pick<ListParams, "q" | "filters" | "from" | "to">, filteredTotal: number, countUnfiltered: () => PromiseLike<number>) {
  return hasListFilters(params) ? countUnfiltered() : filteredTotal;
}

export function toServerListState(params: ListParams, result: Pick<PaginatedRows<unknown>, "total" | "page" | "pageSize">, unfiltered: number): ServerListState {
  return {
    total: result.total,
    unfilteredTotal: unfiltered,
    page: result.page,
    pageSize: result.pageSize,
    q: params.q,
    sort: params.sort,
    dir: params.dir,
    from: params.from,
    to: params.to,
    filters: Object.fromEntries(Object.entries(params.filters).filter((entry): entry is [string, string] => Boolean(entry[1]))),
  };
}
