import { beforeEach, describe, expect, it, vi } from "vitest";

const { applyCompanyTemplateMock, dbMock, transactionMock } = vi.hoisted(() => {
  const applyCompanyTemplateMock = vi.fn(async () => undefined);
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

  return { applyCompanyTemplateMock, dbMock, transactionMock };
});

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/server/seeds/apply", () => ({ applyCompanyTemplate: applyCompanyTemplateMock }));

describe("ensureUserTenant", () => {
  beforeEach(() => {
    vi.resetModules();
    dbMock.select.mockClear();
    transactionMock.mockReset();
    transactionMock.mockImplementation(async (callback) => {
      const rowsByInsert = [
        [{ id: "tenant-1", name: "Concurrent User Tenant", slug: "concurrent-user-tenant" }],
        [{ id: "membership-1", role: "OWNER" }],
        [{ id: "company-1", name: "Concurrent User Company", countryCode: "ES", baseCurrencyCode: "EUR" }],
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
    applyCompanyTemplateMock.mockClear();
  });

  it("coalesces concurrent tenant provisioning for the same user", async () => {
    const { ensureUserTenant } = await import("@/lib/tenant");

    const [first, second] = await Promise.all([
      ensureUserTenant({ id: "user-1", name: "Concurrent User" }),
      ensureUserTenant({ id: "user-1", name: "Concurrent User" }),
    ]);

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(applyCompanyTemplateMock).toHaveBeenCalledTimes(1);
    expect(applyCompanyTemplateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        companyId: "company-1",
        activeFiscalYearId: "fiscal-year-1",
        countryCode: "ES",
        actorUserId: "user-1",
        auditAction: "company.defaults.apply",
      }),
    );
    expect(first.tenant.id).toBe("tenant-1");
    expect(first.company.countryCode).toBe("ES");
    expect(second).toEqual(first);
  });
});
