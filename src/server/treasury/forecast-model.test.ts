import { describe, expect, it } from "vitest";

import { buildForecast, projectRecurring, type ForecastItem } from "@/server/treasury/forecast-model";

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const today = new Date("2026-09-25T15:30:00.000Z");

function item(id: string, amount: number, dueDate: string | null): ForecastItem {
  return { id, kind: amount >= 0 ? "receivable" : "payable", label: id, partnerName: "X", amount, dueDate: dueDate ? day(dueDate) : null };
}

describe("treasury forecast buckets", () => {
  it("starts from the current balance and accumulates weekly", () => {
    const result = buildForecast({
      openingBalance: 1000,
      today,
      horizonDays: 30,
      items: [item("cobro-1", 500, "2026-09-26"), item("pago-1", -800, "2026-10-03"), item("pago-2", -900, "2026-10-10"), item("cobro-2", 0.1, "2026-10-10"), item("cobro-3", 0.2, "2026-10-10")],
    });
    expect(result.buckets).toHaveLength(5);
    expect(result.buckets[0].start).toEqual(day("2026-09-25"));
    expect(result.buckets[0].end).toEqual(day("2026-10-01"));
    expect(result.buckets[4].end).toEqual(day("2026-10-24"));
    expect(result.buckets.map((bucket) => bucket.closingBalance)).toEqual([1500, 700, -199.7, -199.7, -199.7]);
    expect(result.buckets[2]).toMatchObject({ inflow: 0.3, outflow: 900, net: -899.7 });
    expect(result.totals).toEqual({ inflow: 500.3, outflow: 1700 });
    expect(result.finalBalance).toBe(-199.7);
    expect(result.lowest).toEqual({ balance: -199.7, bucketIndex: 2 });
  });

  it("puts overdue items in the first week, lists undated ones apart and summarises what is beyond the horizon", () => {
    const result = buildForecast({
      openingBalance: 0,
      today,
      horizonDays: 30,
      items: [item("vencida", 300, "2026-08-01"), item("sin-fecha", -120, null), item("lejana", 999, "2026-12-01")],
    });
    expect(result.buckets[0].items).toEqual([expect.objectContaining({ id: "vencida", overdue: true })]);
    expect(result.overdue).toEqual({ count: 1, inflow: 300, outflow: 0 });
    expect(result.undated.map((entry) => entry.id)).toEqual(["sin-fecha"]);
    expect(result.beyond).toEqual({ count: 1, net: 999 });
    expect(result.finalBalance).toBe(300);
  });

  it("supports 30/60/90-day horizons", () => {
    expect(buildForecast({ openingBalance: 0, today, horizonDays: 60, items: [] }).buckets).toHaveLength(9);
    expect(buildForecast({ openingBalance: 0, today, horizonDays: 90, items: [] }).buckets).toHaveLength(13);
  });
});

describe("recurring known payments", () => {
  it("projects monthly rule-based payments with their average amount", () => {
    const history = [
      { ruleId: "r1", ruleName: "Cuota autónomos", postedAt: day("2026-07-31"), amount: -294 },
      { ruleId: "r1", ruleName: "Cuota autónomos", postedAt: day("2026-08-31"), amount: -296 },
      { ruleId: "r2", ruleName: "Suelto", postedAt: day("2026-09-01"), amount: -10 },
    ];
    const projected = projectRecurring(history, today, 60);
    expect(projected.map((entry) => [entry.label, entry.dueDate?.toISOString().slice(0, 10), entry.amount])).toEqual([
      ["Cuota autónomos", "2026-09-30", -295],
      ["Cuota autónomos", "2026-10-31", -295],
    ]);
  });

  it("ignores irregular or stopped series", () => {
    const weekly = [
      { ruleId: "r1", ruleName: "Semanal", postedAt: day("2026-09-01"), amount: -5 },
      { ruleId: "r1", ruleName: "Semanal", postedAt: day("2026-09-08"), amount: -5 },
    ];
    const stopped = [
      { ruleId: "r2", ruleName: "Antiguo", postedAt: day("2026-05-01"), amount: -5 },
      { ruleId: "r2", ruleName: "Antiguo", postedAt: day("2026-06-01"), amount: -5 },
    ];
    expect(projectRecurring([...weekly, ...stopped], today, 90)).toEqual([]);
  });
});
