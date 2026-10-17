import { describe, expect, it } from "vitest";

import { agendaBucket, DEFAULT_CRM_STAGES, forecastByMonth, lostReasons, pipelineSummary, stageTotals, validateStages, type PipelineStage } from "@/modules/crm/model";

const stages: PipelineStage[] = [
  { id: "new", name: "Nuevo", probability: 10, kind: "OPEN", position: 0 },
  { id: "proposal", name: "Propuesta", probability: 50, kind: "OPEN", position: 1 },
  { id: "won", name: "Ganada", probability: 100, kind: "WON", position: 2 },
  { id: "lost", name: "Perdida", probability: 0, kind: "LOST", position: 3 },
];

describe("crm pipeline", () => {
  it("adds open amount, weighted forecast and what was won or lost this period", () => {
    const since = new Date("2026-10-01T00:00:00Z");
    const summary = pipelineSummary(stages, [
      { id: "a", stageId: "new", amount: 1000, status: "OPEN" },
      { id: "b", stageId: "proposal", amount: 2000.5, status: "OPEN" },
      { id: "c", stageId: "won", amount: 3000, status: "WON", closedAt: "2026-10-05T10:00:00Z" },
      { id: "d", stageId: "won", amount: 9999, status: "WON", closedAt: "2026-09-20T10:00:00Z" },
      { id: "e", stageId: "lost", amount: 500, status: "LOST", closedAt: "2026-10-02T10:00:00Z" },
    ], since);
    expect(summary).toEqual({ openCount: 2, openAmount: 3000.5, weightedAmount: 1100.25, wonCount: 1, wonAmount: 3000, lostCount: 1, winRate: 50 });
  });

  it("has no win rate until something closes", () => {
    expect(pipelineSummary(stages, [{ id: "a", stageId: "new", amount: 10, status: "OPEN" }], new Date()).winRate).toBeNull();
  });

  it("totals each column", () => {
    expect(stageTotals(stages, [
      { id: "a", stageId: "new", amount: 0.1, status: "OPEN" },
      { id: "b", stageId: "new", amount: 0.2, status: "OPEN" },
    ])[0]).toEqual({ stageId: "new", count: 2, amount: 0.3 });
  });
});

describe("crm stages", () => {
  it("ships a valid default funnel", () => {
    expect(validateStages(DEFAULT_CRM_STAGES)).toBeNull();
  });

  it("requires open, won and lost stages with unique names", () => {
    expect(validateStages([{ name: "A", probability: 10, kind: "OPEN" }, { name: "B", probability: 100, kind: "WON" }])).toMatch(/al menos tres/);
    expect(validateStages([{ name: "A", probability: 10, kind: "OPEN" }, { name: "a", probability: 100, kind: "WON" }, { name: "C", probability: 0, kind: "LOST" }])).toMatch(/mismo nombre/);
    expect(validateStages([{ name: "A", probability: 10, kind: "OPEN" }, { name: "B", probability: 20, kind: "OPEN" }, { name: "C", probability: 0, kind: "LOST" }])).toMatch(/ganada/);
    expect(validateStages([{ name: "A", probability: 120, kind: "OPEN" }, { name: "B", probability: 100, kind: "WON" }, { name: "C", probability: 0, kind: "LOST" }])).toMatch(/0 a 100/);
  });
});

describe("crm agenda", () => {
  const now = new Date("2026-10-16T09:00:00Z");
  it("groups by day in the company time zone", () => {
    expect(agendaBucket({ dueAt: "2026-10-15T21:00:00Z" }, now)).toBe("overdue");
    // 23:30 en Madrid del día 16 sigue siendo hoy.
    expect(agendaBucket({ dueAt: "2026-10-16T21:30:00Z" }, now)).toBe("today");
    expect(agendaBucket({ dueAt: "2026-10-16T22:30:00Z" }, now)).toBe("upcoming");
    expect(agendaBucket({ dueAt: null }, now)).toBe("unscheduled");
    expect(agendaBucket({ dueAt: "2026-10-01T10:00:00Z", completedAt: "2026-10-02T10:00:00Z" }, now)).toBe("done");
  });
});

describe("crm forecast", () => {
  const now = new Date("2026-10-16T10:00:00Z");
  it("groups expected closes by month, overdue in the current month, undated apart", () => {
    const forecast = forecastByMonth([
      { amount: 1000, probability: 50, expectedCloseDate: "2026-10-30T12:00:00Z" },
      { amount: 400, probability: 25, expectedCloseDate: "2026-09-01T12:00:00Z" },
      { amount: 2000, probability: 75, expectedCloseDate: "2026-12-05T12:00:00Z" },
      { amount: 300, probability: 10, expectedCloseDate: null },
      { amount: 999, probability: 10, expectedCloseDate: "2027-09-01T12:00:00Z" },
    ], now, 3);
    expect(forecast.months.map((month) => month.key)).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(forecast.total).toEqual([1400, 0, 2000]);
    expect(forecast.weighted).toEqual([600, 0, 1500]);
    expect(forecast.noDate).toEqual({ total: 300, weighted: 30 });
    expect(forecast.later).toBe(999);
  });

  it("ranks lost reasons", () => {
    expect(lostReasons([{ lostReason: "Precio", amount: 10 }, { lostReason: null, amount: 5 }, { lostReason: "Precio", amount: 20 }])).toEqual([
      { reason: "Precio", count: 2, amount: 30 },
      { reason: "Sin indicar", count: 1, amount: 5 },
    ]);
  });
});
