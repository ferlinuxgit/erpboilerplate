import { beforeEach, describe, expect, it, vi } from "vitest";

/** Apertura del ejercicio siguiente: se copian todas las series (código, nombre, por defecto, activa). */

const mocks = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const inserted: unknown[] = [];
  const makeChain = () => {
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "where", "limit", "innerJoin", "orderBy", "for"]) chain[method] = vi.fn(() => chain);
    chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(selectResults.shift() ?? []).then(resolve, reject);
    return chain;
  };
  const tx = {
    select: vi.fn(() => makeChain()),
    insert: vi.fn(() => ({
      values: vi.fn((values: unknown[]) => {
        inserted.push(values);
        return { onConflictDoNothing: vi.fn(() => ({ returning: vi.fn(async () => values.map((_, index) => ({ id: `new-${index}` }))) })) };
      }),
    })),
  };
  return {
    selectResults,
    inserted,
    tx,
    db: { transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)) },
    recordAudit: vi.fn(async () => undefined),
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/server/audit", () => ({ recordAudit: mocks.recordAudit }));

import { openNextFiscalYear } from "@/server/accounting/fiscal-years";

const year2026 = { id: "fy-2026", code: "2026", startsAt: new Date(Date.UTC(2026, 0, 1)), endsAt: new Date(Date.UTC(2026, 11, 31)), isClosed: false };
const year2027 = { id: "fy-2027", code: "2027", startsAt: new Date(Date.UTC(2027, 0, 1)), endsAt: new Date(Date.UTC(2027, 11, 31)), isClosed: false };

beforeEach(() => {
  mocks.selectResults.length = 0;
  mocks.inserted.length = 0;
  vi.clearAllMocks();
});

describe("openNextFiscalYear (series)", () => {
  it("copia todas las series del ejercicio con su código, nombre, serie por defecto y estado", async () => {
    const sourceSeries = [
      { type: "SALES_INVOICE", code: "GEN", name: "General", prefix: "F", format: "{PREFIX}{NUMBER:6}", nextNumber: 120, isDefault: true, isActive: true },
      { type: "SALES_INVOICE", code: "T", name: "Tickets", prefix: "T", format: "{PREFIX}{NUMBER:6}", nextNumber: 31, isDefault: false, isActive: true },
      { type: "SALES_INVOICE", code: "OLD", name: "Antigua", prefix: "O", format: "{PREFIX}{NUMBER:4}", nextNumber: 9, isDefault: false, isActive: false },
      { type: "CREDIT_NOTE", code: "GEN", name: "General", prefix: "R-", format: "{PREFIX}{NUMBER:6}", nextNumber: 4, isDefault: true, isActive: true },
    ];
    // origen bloqueado, ejercicio destino existente, series del origen, asiento de apertura (ninguno)
    mocks.selectResults.push([year2026], [year2027], sourceSeries, []);

    const result = await openNextFiscalYear({ tenantId: "t", companyId: "c", actorUserId: "u", fromFiscalYearId: "fy-2026" });

    expect(result.seriesCreated).toBe(4);
    expect(mocks.inserted[0]).toEqual(sourceSeries.map((series) => ({ companyId: "c", fiscalYearId: "fy-2027", ...series })));
  });
});
