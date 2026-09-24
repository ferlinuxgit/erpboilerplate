import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const seriesRows: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const recordAudit = vi.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined);
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ for: async () => seriesRows }) }) }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            updates.push(patch);
            return [{ ...seriesRows[0], ...patch }];
          },
        }),
      }),
    }),
    insert: () => ({ values: (value: Record<string, unknown>) => ({ returning: async () => [{ id: "new", ...value }] }) }),
  };
  return { seriesRows, updates, recordAudit, tx, db: { transaction: async (callback: (client: unknown) => unknown) => callback(tx) } };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/server/audit", () => ({ recordAudit: mocks.recordAudit }));

import { upsertDocumentSeries } from "@/server/documents/series-admin";

const actor = { tenantId: "t", companyId: "c", actorUserId: "u", fiscalYearId: "fy" };

beforeEach(() => {
  mocks.seriesRows.splice(0, mocks.seriesRows.length, { id: "s1", companyId: "c", fiscalYearId: "fy", type: "SALES_INVOICE", prefix: "FA", format: "{PREFIX}{NUMBER:6}", nextNumber: 10 });
  mocks.updates.length = 0;
  vi.clearAllMocks();
});

describe("upsertDocumentSeries", () => {
  it("rechaza mover el siguiente número hacia atrás", async () => {
    await expect(upsertDocumentSeries(actor, { type: "SALES_INVOICE", prefix: "FA", nextNumber: 3 })).rejects.toMatchObject({ status: 409 });
    expect(mocks.updates).toHaveLength(0);
  });

  it("exige confirmación y motivo para dejar huecos", async () => {
    await expect(upsertDocumentSeries(actor, { type: "SALES_INVOICE", prefix: "FA", nextNumber: 20 })).rejects.toMatchObject({
      status: 409,
      code: "SERIES_GAP",
      gap: { from: 10, to: 20, skipped: 10, reasonRequired: false },
    });
    await expect(upsertDocumentSeries(actor, { type: "SALES_INVOICE", prefix: "FA", nextNumber: 20, confirmGap: true, gapReason: "" })).rejects.toMatchObject({
      status: 409,
      code: "SERIES_GAP",
      gap: { reasonRequired: true },
    });
  });

  it("con confirmación salta, y audita el cambio y el hueco en la transacción", async () => {
    await upsertDocumentSeries(actor, { type: "SALES_INVOICE", prefix: "FA", nextNumber: 20, confirmGap: true, gapReason: "Migración desde el programa anterior" });

    expect(mocks.updates[0]).toMatchObject({ nextNumber: 20 });
    const actions = mocks.recordAudit.mock.calls.map((call) => (call[0] as { action: string }).action);
    expect(actions).toEqual(["documentSeries.update", "documentSeries.gap"]);
    expect(mocks.recordAudit.mock.calls[1]?.[0]).toMatchObject({ payload: { from: 10, to: 20, skipped: 10 } });
    expect(mocks.recordAudit.mock.calls[0]?.[1]).toBe(mocks.tx);
  });

  it("cambiar solo el prefijo no toca el contador", async () => {
    await upsertDocumentSeries(actor, { type: "SALES_INVOICE", prefix: "F26-", nextNumber: 10 });
    expect(mocks.updates[0]).toEqual({ prefix: "F26-", format: "{PREFIX}{NUMBER:6}" });
  });
});
