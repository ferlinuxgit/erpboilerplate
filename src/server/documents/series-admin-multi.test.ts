import { beforeEach, describe, expect, it, vi } from "vitest";

/** Series múltiples: alta, serie por defecto única por tipo y ejercicio, desactivación. */

const mocks = vi.hoisted(() => {
  const seriesRows: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];
  const recordAudit = vi.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined);
  const whereResult = (patch: Record<string, unknown>) => ({
    returning: async () => [{ ...seriesRows.find((row) => row.id === patch.__target), ...patch }],
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
  });
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: async () => seriesRows,
          limit: async () => seriesRows.slice(0, 1).map((row) => ({ type: row.type })),
        }),
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => {
          updates.push(patch);
          return whereResult(patch);
        },
      }),
    }),
    insert: () => ({ values: (value: Record<string, unknown>) => { inserts.push(value); return { returning: async () => [{ id: "new", ...value }] }; } }),
  };
  return { seriesRows, updates, inserts, recordAudit, tx, db: { transaction: async (callback: (client: unknown) => unknown) => callback(tx) } };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/server/audit", () => ({ recordAudit: mocks.recordAudit }));

import { createDocumentSeries, normalizeSeriesCode, updateDocumentSeries } from "@/server/documents/series-admin";

const actor = { tenantId: "t", companyId: "c", actorUserId: "u", fiscalYearId: "fy-2026" };
const row = (id: string, code: string, patch: Record<string, unknown> = {}) => ({
  id,
  companyId: "c",
  fiscalYearId: "fy-2026",
  type: "SALES_INVOICE",
  code,
  name: code,
  prefix: code,
  format: "{PREFIX}{NUMBER:6}",
  nextNumber: 1,
  isDefault: false,
  isActive: true,
  ...patch,
});

beforeEach(() => {
  mocks.seriesRows.length = 0;
  mocks.updates.length = 0;
  mocks.inserts.length = 0;
  vi.clearAllMocks();
});

describe("createDocumentSeries", () => {
  it("crea una serie adicional sin quitar la de por defecto", async () => {
    mocks.seriesRows.push(row("gen", "GEN", { isDefault: true, nextNumber: 40 }));
    await createDocumentSeries(actor, { type: "SALES_INVOICE", code: "t", name: "Tickets", prefix: "T-" });
    expect(mocks.inserts[0]).toMatchObject({ code: "T", name: "Tickets", isDefault: false, nextNumber: 1, fiscalYearId: "fy-2026" });
    expect(mocks.updates).toHaveLength(0);
  });

  it("la primera serie del tipo en el ejercicio queda por defecto", async () => {
    await createDocumentSeries(actor, { type: "CREDIT_NOTE", code: "R", name: "Rectificativas", prefix: "R-" });
    expect(mocks.inserts[0]).toMatchObject({ isDefault: true });
  });

  it("al crearla por defecto desmarca antes la anterior (una sola por defecto)", async () => {
    mocks.seriesRows.push(row("gen", "GEN", { isDefault: true }));
    await createDocumentSeries(actor, { type: "SALES_INVOICE", code: "EXP", name: "Exportación", prefix: "E-", isDefault: true });
    expect(mocks.updates[0]).toEqual({ isDefault: false });
    expect(mocks.inserts[0]).toMatchObject({ isDefault: true });
  });

  it("rechaza un código repetido en el mismo tipo y ejercicio", async () => {
    mocks.seriesRows.push(row("t", "T"));
    await expect(createDocumentSeries(actor, { type: "SALES_INVOICE", code: "t", name: "Otra", prefix: "X" })).rejects.toMatchObject({ status: 409 });
  });

  it("continúa la numeración de la misma serie de ejercicios anteriores", async () => {
    mocks.seriesRows.push(row("t-2025", "T", { fiscalYearId: "fy-2025", nextNumber: 57 }));
    await createDocumentSeries(actor, { type: "SALES_INVOICE", code: "T", name: "Tickets", prefix: "T-" });
    expect(mocks.inserts[0]).toMatchObject({ nextNumber: 57 });
  });

  it("empezar más adelante exige confirmar el salto", async () => {
    await expect(createDocumentSeries(actor, { type: "SALES_INVOICE", code: "T", name: "Tickets", prefix: "T-", nextNumber: 10 })).rejects.toMatchObject({ code: "SERIES_GAP" });
    await createDocumentSeries(actor, { type: "SALES_INVOICE", code: "T", name: "Tickets", prefix: "T-", nextNumber: 10, confirmGap: true, gapReason: "Migración del programa anterior" });
    expect(mocks.inserts[0]).toMatchObject({ nextNumber: 10 });
  });

  it("valida el código", () => {
    expect(normalizeSeriesCode(" exp ")).toBe("EXP");
    expect(() => normalizeSeriesCode("con espacio")).toThrow(/código/);
  });
});

describe("updateDocumentSeries", () => {
  it("marcar otra serie por defecto desmarca la anterior primero", async () => {
    mocks.seriesRows.push(row("t", "T"), row("gen", "GEN", { isDefault: true }));
    await updateDocumentSeries(actor, "t", { isDefault: true });
    expect(mocks.updates[0]).toEqual({ isDefault: false });
    expect(mocks.updates[1]).toMatchObject({ isDefault: true, isActive: true });
  });

  it("no permite desactivar ni dejar sin marcar la serie por defecto", async () => {
    mocks.seriesRows.push(row("gen", "GEN", { isDefault: true }));
    await expect(updateDocumentSeries(actor, "gen", { isActive: false })).rejects.toMatchObject({ status: 409 });
    await expect(updateDocumentSeries(actor, "gen", { isDefault: false })).rejects.toMatchObject({ status: 409 });
    expect(mocks.updates).toHaveLength(0);
  });

  it("desactiva una serie que no es la de por defecto y renombra", async () => {
    mocks.seriesRows.push(row("t", "T"));
    await updateDocumentSeries(actor, "t", { isActive: false, name: "Tickets (antigua)" });
    expect(mocks.updates[0]).toMatchObject({ isActive: false, isDefault: false, name: "Tickets (antigua)" });
    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "documentSeries.update" }), mocks.tx);
  });

  it("mantiene la regla de huecos por serie", async () => {
    mocks.seriesRows.push(row("t", "T", { nextNumber: 8 }));
    await expect(updateDocumentSeries(actor, "t", { nextNumber: 3 })).rejects.toMatchObject({ status: 409 });
    await expect(updateDocumentSeries(actor, "t", { nextNumber: 12 })).rejects.toMatchObject({ code: "SERIES_GAP" });
  });

  it("devuelve null si la serie no es de la empresa", async () => {
    await expect(updateDocumentSeries(actor, "otra", { name: "X" })).resolves.toBeNull();
  });
});
