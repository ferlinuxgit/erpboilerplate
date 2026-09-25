import { getTableName, type Table } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { assertSelectableSeries, effectiveNextNumber, reserveSeriesNumber, reserveSeriesNumberDetailed, selectSeriesForYear } from "@/server/documents/series";
import { decideNextNumber } from "@/server/documents/series-admin";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/server/audit", () => ({ recordAudit: vi.fn() }));

type SeriesType = "SALES_INVOICE" | "CREDIT_NOTE" | "SALES_QUOTE";
type SeriesRow = { id: string; companyId: string; fiscalYearId: string; type: SeriesType; prefix: string; format: string; nextNumber: number; code?: string; name?: string; isDefault?: boolean; isActive?: boolean };

function fakeClient(input: { yearForDate: { id: string; code: string } | null; series: SeriesRow[]; prefixForUpdate?: string }) {
  const updates: Array<{ patch: Record<string, unknown>; where?: unknown }> = [];
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
            return [{ format: "{PREFIX}{NUMBER:6}", prefix: input.prefixForUpdate ?? "FA" }];
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

const series = (fiscalYearId: string, nextNumber: number, type: SeriesType = "SALES_INVOICE"): SeriesRow => ({
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

const named = (id: string, fiscalYearId: string, code: string, nextNumber: number, patch: Partial<SeriesRow> = {}): SeriesRow => ({
  id,
  companyId: "company-1",
  fiscalYearId,
  type: "SALES_INVOICE",
  prefix: code,
  format: "{PREFIX}{NUMBER:6}",
  nextNumber,
  code,
  name: code === "GEN" ? "General" : "Tickets",
  isDefault: code === "GEN",
  isActive: true,
  ...patch,
});

describe("series múltiples", () => {
  const rows = [
    named("gen-2025", "fy-2025", "GEN", 120),
    named("t-2025", "fy-2025", "T", 30),
    named("gen-2026", "fy-2026", "GEN", 5),
    named("t-2026", "fy-2026", "T", 2),
  ];

  it("sin serie elegida usa la de por defecto del ejercicio", () => {
    expect(selectSeriesForYear(rows, "fy-2026")?.id).toBe("gen-2026");
  });

  it("con una serie elegida de otro ejercicio usa la del mismo código en el ejercicio de la fecha", () => {
    expect(selectSeriesForYear(rows, "fy-2026", rows[1])?.id).toBe("t-2026");
    expect(selectSeriesForYear(rows, "fy-2027", rows[1])).toBeUndefined();
  });

  it("si ninguna está marcada por defecto, toma la primera activa por código", () => {
    const noDefault = [named("b", "fy", "B", 1, { isDefault: false }), named("a", "fy", "A", 1, { isDefault: false, isActive: false }), named("c", "fy", "C", 1, { isDefault: false })];
    expect(selectSeriesForYear(noDefault, "fy")?.id).toBe("b");
  });

  it("cada serie numera por separado y es correlativa entre ejercicios", () => {
    expect(effectiveNextNumber(rows, rows[2]!)).toBe(120);
    expect(effectiveNextNumber(rows, rows[3]!)).toBe(30);
  });

  it("reserva en la serie elegida con su propio contador", async () => {
    const { client, updates } = fakeClient({ yearForDate: { id: "fy-2026", code: "2026" }, series: rows, prefixForUpdate: "T" });
    const result = await reserveSeriesNumberDetailed(client, { companyId: "company-1", type: "SALES_INVOICE", referenceDate: new Date("2026-02-01"), seriesId: "t-2025" });
    expect(result).toEqual({ number: "T000030", seriesId: "t-2026" });
    expect(updates).toEqual([{ patch: { nextNumber: 31 } }]);
  });

  it("sin serie elegida reserva en la serie por defecto, sin mezclar con otras series", async () => {
    const { client, updates } = fakeClient({ yearForDate: { id: "fy-2026", code: "2026" }, series: rows });
    const result = await reserveSeriesNumberDetailed(client, { companyId: "company-1", type: "SALES_INVOICE", referenceDate: new Date("2026-02-01") });
    expect(result.seriesId).toBe("gen-2026");
    expect(updates).toEqual([{ patch: { nextNumber: 121 } }]);
  });

  it("rechaza una serie que no es de la empresa o del tipo", async () => {
    const { client, updates } = fakeClient({ yearForDate: { id: "fy-2026", code: "2026" }, series: rows });
    await expect(reserveSeriesNumber(client, { companyId: "company-1", type: "SALES_INVOICE", referenceDate: new Date("2026-02-01"), seriesId: "otra-empresa" }))
      .rejects.toMatchObject({ status: 422 });
    expect(updates).toHaveLength(0);
  });

  it("rechaza una serie que no existe en el ejercicio de la fecha de emisión", async () => {
    const { client } = fakeClient({ yearForDate: { id: "fy-2026", code: "2026" }, series: [named("gen-2026", "fy-2026", "GEN", 1), named("exp-2025", "fy-2025", "EXP", 4)] });
    await expect(reserveSeriesNumber(client, { companyId: "company-1", type: "SALES_INVOICE", referenceDate: new Date("2026-02-01"), seriesId: "exp-2025" }))
      .rejects.toThrow(/no existe en el ejercicio 2026/);
  });

  it("rechaza una serie desactivada", async () => {
    const { client } = fakeClient({ yearForDate: { id: "fy-2026", code: "2026" }, series: [named("gen-2026", "fy-2026", "GEN", 1), named("t-2026", "fy-2026", "T", 1, { isActive: false })] });
    await expect(reserveSeriesNumber(client, { companyId: "company-1", type: "SALES_INVOICE", referenceDate: new Date("2026-02-01"), seriesId: "t-2026" }))
      .rejects.toThrow(/desactivada/);
  });

  it("con una serie elegida no crea series automáticamente", async () => {
    const { client, inserts } = fakeClient({ yearForDate: { id: "fy-2027", code: "2027" }, series: [named("r-2026", "fy-2026", "R", 3, { type: "CREDIT_NOTE" })] });
    await expect(reserveSeriesNumber(client, { companyId: "company-1", type: "CREDIT_NOTE", referenceDate: new Date("2027-01-10"), seriesId: "r-2026", createIfMissing: { prefix: "R-" } }))
      .rejects.toMatchObject({ status: 422 });
    expect(inserts).toHaveLength(0);
  });
});

describe("assertSelectableSeries (borradores)", () => {
  function clientReturning(row: Record<string, unknown> | null) {
    const builder = { from: () => builder, where: () => builder, limit: async () => (row ? [row] : []) };
    return { select: () => builder } as never;
  }

  it("acepta una serie activa del tipo", async () => {
    await expect(assertSelectableSeries(clientReturning({ id: "s", type: "SALES_INVOICE", isActive: true, name: "Tickets" }), "company-1", "s", ["SALES_INVOICE"])).resolves.toMatchObject({ id: "s" });
  });

  it("rechaza series de otro tipo, inexistentes (u otra empresa) o desactivadas", async () => {
    await expect(assertSelectableSeries(clientReturning({ id: "s", type: "CREDIT_NOTE", isActive: true, name: "R" }), "company-1", "s", ["SALES_INVOICE"])).rejects.toMatchObject({ status: 400 });
    await expect(assertSelectableSeries(clientReturning(null), "company-1", "s", ["SALES_INVOICE"])).rejects.toMatchObject({ status: 400 });
    await expect(assertSelectableSeries(clientReturning({ id: "s", type: "SALES_INVOICE", isActive: false, name: "Tickets" }), "company-1", "s", ["SALES_INVOICE"])).rejects.toThrow(/desactivada/);
  });
});
