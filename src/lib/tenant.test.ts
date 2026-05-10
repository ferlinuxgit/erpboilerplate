import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, transactionMock } = vi.hoisted(() => {
  const transactionMock = vi.fn();

  function makeSelectQuery(selection: Record<string, unknown>) {
    let isMembershipLookup = Boolean(selection.membershipId);

    const query = {
      from: vi.fn(() => query),
      innerJoin: vi.fn(() => {
        isMembershipLookup = true;
        return query;
      }),
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(async () => (isMembershipLookup ? [] : [])),
    };

    return query;
  }

  const dbMock = {
    select: vi.fn(makeSelectQuery),
    transaction: transactionMock,
  };

  return { dbMock, transactionMock };
});

vi.mock("@/lib/db", () => ({ db: dbMock }));

describe("ensureUserTenant", () => {
  beforeEach(() => {
    vi.resetModules();
    dbMock.select.mockClear();
    transactionMock.mockReset();
    transactionMock.mockImplementation(async (callback) => {
      const rowsByInsert = [
        [{ id: "tenant-1", name: "Concurrent User Tenant", slug: "concurrent-user-tenant" }],
        [{ id: "membership-1", role: "OWNER" }],
        [{ id: "company-1", name: "Concurrent User Company", baseCurrencyCode: "EUR" }],
        [{ id: "fiscal-year-1", code: "2026" }],
      ];
      let insertIndex = 0;
      const tx = {
        insert: vi.fn(() => ({
          values: vi.fn(() => ({
            returning: vi.fn(async () => rowsByInsert[insertIndex++]),
          })),
        })),
      };

      return callback(tx);
    });
  });

  it("coalesces concurrent tenant provisioning for the same user", async () => {
    const { ensureUserTenant } = await import("@/lib/tenant");

    const [first, second] = await Promise.all([
      ensureUserTenant({ id: "user-1", name: "Concurrent User" }),
      ensureUserTenant({ id: "user-1", name: "Concurrent User" }),
    ]);

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(first.tenant.id).toBe("tenant-1");
    expect(second).toEqual(first);
  });
});
