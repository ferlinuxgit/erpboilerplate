import { PgDialect } from "drizzle-orm/pg-core";
import { eq, type SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { invoice } from "@/db/schema";
import { buildListSearch, hasListFilters, parseListParams } from "@/lib/list-params";
import {
  dateRangeConditions,
  escapeLike,
  listOrderBy,
  listWhere,
  paginate,
  searchCondition,
  toServerListState,
  unfilteredTotal,
} from "@/server/lists/paginate";

const dialect = new PgDialect();
const render = (query: SQL | undefined) => (query ? dialect.sqlToQuery(query) : null);

const config = {
  sortKeys: ["number", "issueDate", "total"] as const,
  defaultSort: { key: "issueDate" as const, dir: "desc" as const },
  filters: { status: ["PENDING", "PAID"] },
};

describe("parseListParams", () => {
  it("applies defaults when the URL is empty", () => {
    expect(parseListParams({}, config)).toEqual({
      q: "",
      page: 1,
      pageSize: 25,
      sort: null,
      dir: "asc",
      orderKey: "issueDate",
      orderDir: "desc",
      filters: {},
      from: null,
      to: null,
    });
  });

  it("only accepts whitelisted sort keys and falls back to the default order", () => {
    const injected = parseListParams({ sort: "id; drop table invoice", dir: "asc" }, config);
    expect(injected.sort).toBeNull();
    expect(injected.orderKey).toBe("issueDate");
    expect(injected.orderDir).toBe("desc");

    const valid = parseListParams({ sort: "total", dir: "desc" }, config);
    expect(valid).toMatchObject({ sort: "total", orderKey: "total", orderDir: "desc" });
  });

  it("ignores filter values outside the allowed list (they would break SQL enums)", () => {
    expect(parseListParams({ status: "PAID" }, config).filters).toEqual({ status: "PAID" });
    expect(parseListParams({ status: "HACKED" }, config).filters).toEqual({});
    expect(parseListParams({ other: "x" }, config).filters).toEqual({});
  });

  it("validates page, page size and dates, and orders an inverted range", () => {
    const params = parseListParams({ page: "-3", pageSize: "7", from: "2026-13-01", to: "2026-02-30" }, config);
    expect(params).toMatchObject({ page: 1, pageSize: 25, from: null, to: null });

    const swapped = parseListParams({ page: "4", pageSize: "50", from: "2026-06-30", to: "2026-06-01" }, config);
    expect(swapped).toMatchObject({ page: 4, pageSize: 50, from: "2026-06-01", to: "2026-06-30" });
  });

  it("trims and bounds the search text and reads the first repeated value", () => {
    expect(parseListParams({ q: ["  acme  ", "other"] }, config).q).toBe("acme");
    expect(parseListParams({ q: "x".repeat(500) }, config).q).toHaveLength(100);
  });

  it("round-trips through buildListSearch", () => {
    const search = buildListSearch("tab=1", { q: "acme", page: 2, pageSize: 50, sort: "total", dir: "desc", from: "2026-01-01", filters: { status: "PAID" } }, ["status"]);
    expect(search).toBe("dir=desc&from=2026-01-01&page=2&pageSize=50&q=acme&sort=total&status=PAID&tab=1");
    expect(parseListParams(new URLSearchParams(search), config)).toMatchObject({
      q: "acme",
      page: 2,
      pageSize: 50,
      sort: "total",
      dir: "desc",
      from: "2026-01-01",
      filters: { status: "PAID" },
    });
    // Defaults are omitted to keep URLs short.
    expect(buildListSearch("", { q: " ", page: 1, pageSize: 25, sort: null, dir: "asc" })).toBe("");
  });

  it("detects active filters", () => {
    expect(hasListFilters({ q: "", filters: {}, from: null, to: null })).toBe(false);
    expect(hasListFilters({ q: "", filters: { status: "PAID" }, from: null, to: null })).toBe(true);
    expect(hasListFilters({ q: "", filters: {}, from: "2026-01-01", to: null })).toBe(true);
  });
});

describe("SQL builders", () => {
  it("escapes LIKE wildcards", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });

  it("requires every search term to match one of the columns", () => {
    const query = render(searchCondition("acme 2026", [invoice.number, invoice.notes]));
    expect(query?.sql).toBe(
      '(("invoice"."number" ilike $1 or "invoice"."notes" ilike $2) and ("invoice"."number" ilike $3 or "invoice"."notes" ilike $4))',
    );
    expect(query?.params).toEqual(["%acme%", "%acme%", "%2026%", "%2026%"]);
    expect(searchCondition("   ", [invoice.number])).toBeUndefined();
  });

  it("builds an inclusive UTC day range", () => {
    const [from, to] = dateRangeConditions(invoice.issueDate, "2026-03-01", "2026-03-31");
    expect(render(from)?.params).toEqual([new Date("2026-03-01T00:00:00.000Z")]);
    expect(render(to)?.sql).toBe('"invoice"."issueDate" < $1');
    expect(render(to)?.params).toEqual([new Date("2026-04-01T00:00:00.000Z")]);
    expect(dateRangeConditions(invoice.issueDate, null, null)).toEqual([]);
  });

  it("combines base, search, dates and filters, skipping empty parts", () => {
    const where = listWhere({
      base: [eq(invoice.companyId, "company-1")],
      search: { q: "", columns: [invoice.number] },
      dateRange: { column: invoice.issueDate, from: "2026-01-01", to: null },
      filters: [undefined, eq(invoice.paymentStatus, "PAID")],
    });
    const query = render(where);
    expect(query?.sql).toBe('("invoice"."companyId" = $1 and "invoice"."issueDate" >= $2 and "invoice"."paymentStatus" = $3)');
  });

  it("orders by the whitelisted column with nulls last and a stable tiebreaker", () => {
    const [primary, tiebreaker] = listOrderBy<"number" | "due">({ number: invoice.number, due: invoice.dueDate }, { orderKey: "due", orderDir: "asc" }, invoice.id);
    expect(render(primary)?.sql).toBe('"invoice"."dueDate" asc nulls last');
    expect(render(tiebreaker)?.sql).toBe('"invoice"."id" asc');
  });
});

describe("paginate", () => {
  it("reads the filtered total from the window count of the first row", async () => {
    const fetchPage = vi.fn(async () => [{ id: "a", total: "42" }, { id: "b", total: "42" }]);
    const countAll = vi.fn(async () => 0);
    const result = await paginate({ page: 2, pageSize: 10, fetchPage, countAll });
    expect(fetchPage).toHaveBeenCalledWith(10, 10);
    expect(countAll).not.toHaveBeenCalled();
    expect(result).toMatchObject({ total: 42, page: 2, pageCount: 5 });
  });

  it("returns the last page when the requested one is past the end", async () => {
    const fetchPage = vi.fn(async (_limit: number, offset: number) => (offset === 20 ? [{ id: "z", total: 23 }] : []));
    const result = await paginate({ page: 9, pageSize: 10, fetchPage, countAll: async () => 23 });
    expect(fetchPage).toHaveBeenLastCalledWith(10, 20);
    expect(result).toMatchObject({ page: 3, total: 23, pageCount: 3, rows: [{ id: "z", total: 23 }] });
  });

  it("returns an empty first page without counting", async () => {
    const countAll = vi.fn(async () => 0);
    const result = await paginate({ page: 1, pageSize: 25, fetchPage: async () => [], countAll });
    expect(countAll).not.toHaveBeenCalled();
    expect(result).toMatchObject({ rows: [], total: 0, page: 1, pageCount: 1 });
  });

  it("counts the unfiltered total only when something filters", async () => {
    const count = vi.fn(async () => 99);
    await expect(unfilteredTotal({ q: "", filters: {}, from: null, to: null }, 7, count)).resolves.toBe(7);
    expect(count).not.toHaveBeenCalled();
    await expect(unfilteredTotal({ q: "acme", filters: {}, from: null, to: null }, 7, count)).resolves.toBe(99);
  });

  it("maps params and result to the ResourceList server state", () => {
    const params = parseListParams({ q: "acme", status: "PAID", sort: "total", dir: "desc" }, config);
    expect(toServerListState(params, { total: 3, page: 1, pageSize: 25 }, 10)).toEqual({
      total: 3,
      unfilteredTotal: 10,
      page: 1,
      pageSize: 25,
      q: "acme",
      sort: "total",
      dir: "desc",
      from: null,
      to: null,
      filters: { status: "PAID" },
    });
  });
});
