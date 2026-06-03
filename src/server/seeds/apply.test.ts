import { beforeEach, describe, expect, it, vi } from "vitest";

import { accountChart, companySettings, documentSeries, journal, tax } from "@/db/schema";

const { recordAuditMock } = vi.hoisted(() => ({
  recordAuditMock: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => ({ db: { transaction: vi.fn() } }));
vi.mock("@/server/audit", () => ({ recordAudit: recordAuditMock }));

import { applyEsSeeds } from "@/server/seeds/apply";

function createSeedClient(options: { existingSalesInvoiceSeries?: boolean } = {}) {
  const inserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  let selectedTable: unknown;
  let documentSeriesSelectCount = 0;

  const client = {
    select: vi.fn(() => {
      const query = {
        from: vi.fn((table: unknown) => {
          selectedTable = table;
          if (table === documentSeries) documentSeriesSelectCount += 1;
          return query;
        }),
        where: vi.fn(() => query),
        limit: vi.fn(async () => {
          if (selectedTable === documentSeries) {
            const isSalesInvoicePreset = documentSeriesSelectCount === 4;
            return options.existingSalesInvoiceSeries && isSalesInvoicePreset ? [{ id: "series-sales-invoice" }] : [];
          }
          return [];
        }),
      };
      return query;
    }),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn(async (values: Record<string, unknown>) => {
        inserts.push({ table, values });
        return [];
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    })),
  };

  return { client, inserts };
}

describe("applyEsSeeds", () => {
  beforeEach(() => {
    recordAuditMock.mockClear();
  });

  it("creates the Spanish operational defaults without duplicating an existing invoice series", async () => {
    const { client, inserts } = createSeedClient({ existingSalesInvoiceSeries: true });

    await applyEsSeeds({
      tenantId: "tenant-1",
      companyId: "company-1",
      activeFiscalYearId: "fy-2026",
      actorUserId: "user-1",
      client: client as never,
    });

    expect(inserts.some((entry) => entry.table === companySettings)).toBe(true);
    expect(inserts.some((entry) => entry.table === accountChart && entry.values.code === "430000")).toBe(true);
    expect(inserts.some((entry) => entry.table === journal && entry.values.code === "VEN")).toBe(true);
    expect(inserts.some((entry) => entry.table === tax)).toBe(true);
    expect(inserts.some((entry) => entry.table === documentSeries && entry.values.type === "SALES_INVOICE")).toBe(false);
    expect(inserts.some((entry) => entry.table === documentSeries && entry.values.type === "SALES_QUOTE")).toBe(true);
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "onboarding.seed.apply",
        companyId: "company-1",
      }),
      client,
    );
  });
});
