import { describe, expect, it } from "vitest";

import { buildFiscalCalendar } from "@/server/fiscal/calendar";

const now = new Date("2026-04-10T10:00:00.000Z");

describe("calendario fiscal", () => {
  it("genera los plazos del año aunque no haya borradores (sociedad trimestral en régimen general)", () => {
    const calendar = buildFiscalCalendar({ year: 2026, periodicity: "quarterly", taxpayerType: "company", fiscalRegime: "general", reports: [], now });
    const vat = calendar.filter((entry) => entry.code === "303").map((entry) => [entry.period, entry.dueDate.slice(0, 10)]);
    expect(vat).toEqual([
      ["2025-Q4", "2026-01-30"],
      ["2026-Q1", "2026-04-20"],
      ["2026-Q2", "2026-07-20"],
      ["2026-Q3", "2026-10-20"],
    ]);
    expect(calendar.find((entry) => entry.code === "390")).toMatchObject({ period: "2025", requirement: "required" });
    expect(calendar.find((entry) => entry.code === "347")).toMatchObject({ period: "2025", requirement: "if-applicable" });
    expect(calendar.some((entry) => entry.code === "130")).toBe(false);
    // Ordenado por fecha de vencimiento.
    const dates = calendar.map((entry) => entry.dueDate);
    expect([...dates].sort()).toEqual(dates);
  });

  it("marca vencidos solo los obligatorios sin presentar y respeta los presentados", () => {
    const calendar = buildFiscalCalendar({
      year: 2026,
      periodicity: "quarterly",
      taxpayerType: "individual",
      fiscalRegime: "general",
      reports: [{ id: "r1", code: "303", period: "2025-Q4", status: "FILED", summary: { amountDue: 100 } }],
      now,
    });
    const find = (code: string, period: string) => calendar.find((entry) => entry.code === code && entry.period === period);
    expect(find("303", "2025-Q4")?.state).toBe("filed");
    expect(find("303", "2025-Q4")?.report).toEqual({ id: "r1", status: "FILED", amountDue: 100 });
    expect(find("390", "2025")?.state).toBe("overdue");
    expect(find("111", "2025-Q4")?.state).toBe("past");
    expect(find("303", "2026-Q1")?.state).toBe("planned");
    expect(find("130", "2026-Q1")?.requirement).toBe("required");
  });

  it("empresas en recargo de equivalencia no presentan 303 ni 390; la periodicidad mensual genera 12 plazos de IVA", () => {
    const recargo = buildFiscalCalendar({ year: 2026, periodicity: "quarterly", taxpayerType: "individual", fiscalRegime: "recargo_equivalencia", reports: [], now });
    expect(recargo.some((entry) => entry.code === "303" || entry.code === "390")).toBe(false);
    const monthly = buildFiscalCalendar({ year: 2026, periodicity: "monthly", taxpayerType: "company", fiscalRegime: "general", reports: [], now });
    expect(monthly.filter((entry) => entry.code === "303")).toHaveLength(12);
    expect(monthly.find((entry) => entry.code === "303" && entry.period === "2025-12")?.dueDate.slice(0, 10)).toBe("2026-01-30");
  });
});
