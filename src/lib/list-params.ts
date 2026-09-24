/**
 * URL contract of server-paginated lists (`ResourceList` in server mode):
 *
 *   ?q=&page=&pageSize=&sort=&dir=&from=&to=&<filterKey>=
 *
 * Pure and client-safe: the page (server) parses the params with
 * `parseListParams` and the list (client) writes them back with
 * `buildListSearch`, so both sides always agree on names and defaults.
 */

export type SortDirection = "asc" | "desc";

export const LIST_PARAM = {
  q: "q",
  page: "page",
  pageSize: "pageSize",
  sort: "sort",
  dir: "dir",
  from: "from",
  to: "to",
} as const;

export const DEFAULT_LIST_PAGE_SIZE = 25;
export const LIST_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
/** Longest search accepted; longer input is truncated (keeps ILIKE patterns cheap). */
export const MAX_LIST_QUERY_LENGTH = 100;

export type RawSearchParams = Record<string, string | string[] | undefined>;

export type ListParamsConfig<TSort extends string = string, TFilter extends string = string> = {
  /** Whitelisted sort keys. Anything else falls back to the default sort. */
  sortKeys: readonly TSort[];
  /** Order used when no (valid) sort is requested. Newest first keeps new records on page 1. */
  defaultSort: { key: TSort; dir: SortDirection };
  /** Allowed values per filter key; unknown values are ignored (never reach SQL enums). */
  filters?: Partial<Record<TFilter, readonly string[]>>;
  pageSizeOptions?: readonly number[];
  defaultPageSize?: number;
};

export type ListParams<TSort extends string = string, TFilter extends string = string> = {
  q: string;
  page: number;
  pageSize: number;
  /** Requested sort key, or null when the default order applies. */
  sort: TSort | null;
  dir: SortDirection;
  /** Effective order (requested or default). */
  orderKey: TSort;
  orderDir: SortDirection;
  filters: Partial<Record<TFilter, string>>;
  /** Inclusive dates as YYYY-MM-DD. */
  from: string | null;
  to: string | null;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(value: string | null | undefined): value is string {
  if (!value || !DATE_KEY.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseListParams<TSort extends string, TFilter extends string = string>(
  raw: RawSearchParams | URLSearchParams | undefined,
  config: ListParamsConfig<TSort, TFilter>,
): ListParams<TSort, TFilter> {
  const get = (key: string) => (raw instanceof URLSearchParams ? raw.get(key) ?? undefined : first(raw?.[key]));
  const pageSizeOptions = config.pageSizeOptions ?? LIST_PAGE_SIZE_OPTIONS;
  const defaultPageSize = config.defaultPageSize ?? DEFAULT_LIST_PAGE_SIZE;

  const q = (get(LIST_PARAM.q) ?? "").trim().slice(0, MAX_LIST_QUERY_LENGTH);
  const requestedPage = Number.parseInt(get(LIST_PARAM.page) ?? "", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 100_000) : 1;
  const requestedSize = Number.parseInt(get(LIST_PARAM.pageSize) ?? "", 10);
  const pageSize = pageSizeOptions.includes(requestedSize) ? requestedSize : defaultPageSize;

  const requestedSort = get(LIST_PARAM.sort);
  const sort = requestedSort && (config.sortKeys as readonly string[]).includes(requestedSort) ? (requestedSort as TSort) : null;
  const requestedDir = get(LIST_PARAM.dir);
  const dir: SortDirection = requestedDir === "asc" || requestedDir === "desc" ? requestedDir : "asc";

  const filters: Partial<Record<TFilter, string>> = {};
  for (const [key, allowed] of Object.entries(config.filters ?? {}) as Array<[TFilter, readonly string[] | undefined]>) {
    const value = get(key);
    if (value && allowed?.includes(value)) filters[key] = value;
  }

  let from = get(LIST_PARAM.from) ?? null;
  let to = get(LIST_PARAM.to) ?? null;
  if (!isDateKey(from)) from = null;
  if (!isDateKey(to)) to = null;
  if (from && to && from > to) [from, to] = [to, from];

  return {
    q,
    page,
    pageSize,
    sort,
    dir,
    orderKey: sort ?? config.defaultSort.key,
    orderDir: sort ? dir : config.defaultSort.dir,
    filters,
    from,
    to,
  };
}

/** True when search, filters or dates narrow the list (the unfiltered total then needs its own count). */
export function hasListFilters(params: Pick<ListParams, "q" | "filters" | "from" | "to">) {
  return Boolean(params.q || params.from || params.to || Object.values(params.filters).some(Boolean));
}

export type ListSearchState = {
  q?: string;
  page?: number;
  pageSize?: number;
  defaultPageSize?: number;
  sort?: string | null;
  dir?: SortDirection | null;
  from?: string | null;
  to?: string | null;
  filters?: Record<string, string | null | undefined>;
};

/**
 * Serialises list state into the URL, keeping unrelated params and omitting defaults
 * (page 1, default page size, empty values) so URLs stay short and shareable.
 */
export function buildListSearch(current: string | URLSearchParams, state: ListSearchState, filterKeys: readonly string[] = []) {
  const params = new URLSearchParams(current);
  const set = (key: string, value: string | number | null | undefined, omit?: string | number) => {
    if (value === null || value === undefined || value === "" || value === omit) params.delete(key);
    else params.set(key, String(value));
  };
  set(LIST_PARAM.q, state.q?.trim());
  set(LIST_PARAM.page, state.page, 1);
  set(LIST_PARAM.pageSize, state.pageSize, state.defaultPageSize ?? DEFAULT_LIST_PAGE_SIZE);
  set(LIST_PARAM.sort, state.sort ?? null);
  set(LIST_PARAM.dir, state.sort ? state.dir : null);
  set(LIST_PARAM.from, state.from);
  set(LIST_PARAM.to, state.to);
  for (const key of filterKeys) set(key, state.filters?.[key]);
  params.sort();
  return params.toString();
}

/** Shape passed from a page to `ResourceList` (`server` prop). */
export type ServerListState = {
  /** Rows matching search and filters (all pages). */
  total: number;
  /** Rows without search/filters: tells "no records yet" from "no matches". */
  unfilteredTotal: number;
  page: number;
  pageSize: number;
  q: string;
  sort: string | null;
  dir: SortDirection;
  from: string | null;
  to: string | null;
  filters: Record<string, string>;
};
