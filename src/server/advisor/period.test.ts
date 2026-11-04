import { describe, expect, it } from "vitest";

import { advisorPeriodQuery, defaultAdvisorPeriod, resolveAdvisorPeriod } from "@/server/advisor/period";

const year = (code: number) => ({ id: `fy-${code}`, code: String(code), startsAt: new Date(Date.UTC(code, 0, 1)), endsAt: new Date(Date.UTC(code, 11, 31)), isClosed: false });
const years = [year(2025), year(2026)];

describe("periodo del portal del asesor", () => {
  it("propone el trimestre que se está liquidando", () => {
    // En enero se presenta el 4.º trimestre del año anterior.
    expect(defaultAdvisorPeriod(years, new Date("2026-01-15T10:00:00Z"))).toMatchObject({ year: { code: "2025" }, periodKey: "q4" });
    expect(defaultAdvisorPeriod(years, new Date("2026-10-10T10:00:00Z"))).toMatchObject({ year: { code: "2026" }, periodKey: "q3" });
    expect(defaultAdvisorPeriod(years, new Date("2026-11-04T10:00:00Z"))).toMatchObject({ year: { code: "2026" }, periodKey: "q4" });
  });

  it("usa el ejercicio y el periodo de la URL", () => {
    const period = resolveAdvisorPeriod(years, { year: "fy-2025", period: "q2" }, new Date("2026-11-04T10:00:00Z"));
    expect(period).toMatchObject({ from: "2025-04-01", to: "2025-06-30", period: { key: "q2", label: "2.º trimestre 2025" } });
    expect(advisorPeriodQuery(period!, { q: "acme" })).toBe("year=fy-2025&period=q2&q=acme");
  });

  it("al elegir otro ejercicio sin periodo, muestra el año completo", () => {
    const period = resolveAdvisorPeriod(years, { year: "fy-2025" }, new Date("2026-11-04T10:00:00Z"));
    expect(period).toMatchObject({ from: "2025-01-01", to: "2025-12-31", period: { key: "year" } });
  });

  it("ignora un ejercicio que no es de la empresa y un periodo inválido", () => {
    const period = resolveAdvisorPeriod(years, { year: "otro", period: "zz" }, new Date("2026-11-04T10:00:00Z"));
    expect(period).toMatchObject({ year: { code: "2026" }, period: { key: "year" } });
    expect(resolveAdvisorPeriod([], {})).toBeNull();
  });
});
