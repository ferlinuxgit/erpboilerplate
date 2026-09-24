import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { orderByCalls, preferredTenant, membershipRows } = vi.hoisted(() => ({
  orderByCalls: [] as unknown[][],
  preferredTenant: { current: null as string | null },
  membershipRows: { current: [] as Array<Record<string, unknown>> },
}));

vi.mock("@/lib/active-context", () => ({
  getActiveTenantCookie: async () => preferredTenant.current,
  getActiveContextCookies: async () => ({ tenantId: preferredTenant.current, companyId: null, fiscalYearId: null }),
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => {
      const chain = {
        from: vi.fn(() => chain),
        innerJoin: vi.fn(() => chain),
        where: vi.fn(() => chain),
        orderBy: vi.fn((...args: unknown[]) => {
          orderByCalls.push(args);
          return chain;
        }),
        limit: vi.fn(async () => membershipRows.current),
      };
      return chain;
    }),
  },
}));

const dialect = new PgDialect();

function row(tenantId: string) {
  return {
    membershipId: `m-${tenantId}`,
    role: "MEMBER",
    tenantId,
    tenantName: tenantId,
    tenantSlug: tenantId,
    companyId: `company-${tenantId}`,
    companyName: "Empresa",
    companyCountryCode: "ES",
    companyBaseCurrencyCode: "EUR",
    fiscalYearId: `fy-${tenantId}`,
    fiscalYearCode: "2026",
  };
}

describe("active tenant resolution", () => {
  beforeEach(() => {
    orderByCalls.length = 0;
    preferredTenant.current = null;
    membershipRows.current = [];
  });

  it("orders memberships by the preferred tenant first, then by the earliest membership", async () => {
    const { activeMembershipOrder } = await import("@/lib/tenant");

    const withoutPreference = activeMembershipOrder(null).map((entry) => dialect.sqlToQuery(entry));
    expect(withoutPreference[0].sql).toContain('"membership"."createdAt" asc');

    const withPreference = activeMembershipOrder("tenant-b").map((entry) => dialect.sqlToQuery(entry));
    expect(withPreference).toHaveLength(withoutPreference.length + 1);
    expect(withPreference[0].sql).toContain('case when "membership"."tenantId" = $1 then 0 else 1 end');
    expect(withPreference[0].params).toEqual(["tenant-b"]);
  });

  it("ensureUserTenant resolves the tenant chosen in the active-tenant cookie (validated by membership)", async () => {
    preferredTenant.current = "tenant-b";
    membershipRows.current = [row("tenant-b")];
    const { ensureUserTenant } = await import("@/lib/tenant");

    const context = await ensureUserTenant({ id: "user-1", name: "Ana" });

    expect(context.tenant.id).toBe("tenant-b");
    const [firstOrder] = orderByCalls[0] as Parameters<typeof dialect.sqlToQuery>[0][];
    expect(dialect.sqlToQuery(firstOrder).params).toEqual(["tenant-b"]);
  });
});
