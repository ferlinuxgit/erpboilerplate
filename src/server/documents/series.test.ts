import { getTableName, type Table } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { reserveSeriesNumber } from "@/server/documents/series";
import { decideNextNumber } from "@/server/documents/series-admin";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/server/audit", () => ({ recordAudit: vi.fn() }));

type SeriesRow = { id: string; companyId: string; fiscalYearId: string; type: string; prefix: string; format: string; nextNumber: number };

function fakeClient(input: { yearForDate: { id: string; code: string } | null; series: SeriesRow[] }) {
  const updates: Array<{ patch: Record<string, unknown> }> = [];
  const inserts: Array<Record<string, unknown>> = [];
  const client = {
    select: () => {
      let table = "";
      const builder = {
        from: (value: Table) => { table = getTableName(value); return builder; },
        where: () => builder,
        orderBy: () => builder,
        limit: async () => (table === "fiscal_year" && input.yearForDate ? [{ ...input.yearForDate, isClosed: false }] : []),
        for: async () => input.series,
      };
      return builder;
    },
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            updates.push({ patch });
            return [{ format: "{PREFIX}{NUMBER:6}", prefix: "FA" }];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        inserts.push(value);
        return { onConflictDoNothing: () => ({ returning: async () => [{ id: "created", ...value }] }) };
      },
    }),
  };
  return { client: client as never, updates, inserts };
}

const series = (fiscalYearId: string, nextNumber: number, type = "SALES_INVOICE"): SeriesRow => ({
  id: `series-${fiscalYearId}-${type}`,
  companyId: "company-1",
  fiscalYearId,
  type,
  prefix: "FA",
  format: "{PREFIX}{NUMBER:6}",
  nextNumber,
});

describe("reserveSeriesNumber", () => {
  it("usa la serie del ejercicio de la fecha de emisión, no el ejercicio activo", async () => {
    const { client, updates } = fakeClient({ yearForDate: { id: "fy-2026", code: "2026" }, series: [series("fy-2025", 40), series("fy-2026", 41)] });

    const number = await reserveSeriesNumber(client, { companyId: "company-1", type: "SALES_INVOICE", referenceDate: new Date("2026-01-05"), fiscalYearId: "fy-2025" });

    expect(number).toBe("FA000041");
    expect(updates).toEqual([{ patch: { nextNumber: 42 } }]);
  });

  it("nunca reutiliza números: toma el máximo de todas las series del tipo", async () => {
    const { client } = fakeClient({ yearForDate: { id: "fy-2025", code: "2025" }, series: [series("fy-2025", 10), series("fy-2026", 25)] });
    const number = await reserveSeriesNumber(client, { companyId: "company-1", type: "SALES_INVOICE", referenceDate: new Date("2025-12-30") });
    expect(number).toBe("FA000025");
  });

  it("las facturas exigen un ejercicio para la fecha de emisión (sin caer al ejercicio activo)", async () => {
    const { client } = fakeClient({ yearForDate: null, series: [series("fy-2025", 1)] });
    await expect(reserveSeriesNumber(client, { companyId: "company-1", type: "SALES_INVOICE", referenceDate: new Date("2030-01-01"), fiscalYearId: "fy-2025" }))
      .rejects.toMatchObject({ status: 422 });
  });

  it("otros documentos pueden usar el ejercicio de respaldo si la fecha no tiene serie", async () => {
    const { client } = fakeClient({ yearForDate: null, series: [series("fy-2025", 7, "SALES_QUOTE")] });
    const number = await reserveSeriesNumber(client, { companyId: "company-1", type: "SALES_QUOTE", fiscalYearId: "fy-2025" });
    expect(number).toBe("FA000007");
  });

  it("crea la serie de rectificativas si falta en el ejercicio", async () => {
    const { client, inserts } = fakeClient({ yearForDate: { id: "fy-2026", code: "2026" }, series: [] });
    await reserveSeriesNumber(client, { companyId: "company-1", type: "CREDIT_NOTE", referenceDate: new Date("2026-03-01"), createIfMissing: { prefix: "R-" } });
    expect(inserts[0]).toMatchObject({ fiscalYearId: "fy-2026", type: "CREDIT_NOTE", prefix: "R-", nextNumber: 1 });
  });
});

describe("decideNextNumber (integridad de numeración)", () => {
  it("no cambia nada si se repite el valor actual", () => {
    expect(decideNextNumber({ requested: 5, current: 5, effective: 9 })).toEqual({ kind: "unchanged" });
    expect(decideNextNumber({ requested: undefined, current: 5, effective: 9 })).toEqual({ kind: "unchanged" });
  });

  it("rechaza retroceder por debajo del contador efectivo", () => {
    expect(decideNextNumber({ requested: 3, current: 9, effective: 9 })).toEqual({ kind: "backwards", effective: 9 });
  });

  it("detecta huecos al saltar hacia delante", () => {
    expect(decideNextNumber({ requested: 15, current: 9, effective: 9 })).toEqual({ kind: "gap", effective: 9, skipped: 6 });
  });

  it("sincroniza con el contador efectivo sin huecos", () => {
    expect(decideNextNumber({ requested: 9, current: 4, effective: 9 })).toEqual({ kind: "sync", nextNumber: 9 });
  });
});
