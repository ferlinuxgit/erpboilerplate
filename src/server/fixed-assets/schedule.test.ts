import { describe, expect, it } from "vitest";

import { buildDepreciationSchedule, isIsoDate, pendingPostings, postingPeriods } from "@/server/fixed-assets/schedule";

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

describe("cuadro de amortización lineal", () => {
  it("años completos: cuota anual exacta y meses que suman la cuota del ejercicio", () => {
    const schedule = buildDepreciationSchedule({ depreciableCents: 120_000, annualPct: 25, startDate: "2024-01-01" });
    expect(schedule.years.map((year) => [year.label, year.amountCents])).toEqual([["2024", 30_000], ["2025", 30_000], ["2026", 30_000], ["2027", 30_000]]);
    expect(schedule.totalCents).toBe(120_000);
    for (const year of schedule.years) {
      expect(year.months).toHaveLength(12);
      expect(sum(year.months.map((month) => month.amountCents))).toBe(year.amountCents);
    }
    // 2024 es bisiesto: 366 días, pero un ejercicio completo amortiza exactamente la cuota anual.
    expect(schedule.years[0].days).toBe(366);
    expect(schedule.years.at(-1)?.remainingCents).toBe(0);
  });

  it("primer ejercicio prorrateado por días desde la puesta en funcionamiento y último ajustado", () => {
    const schedule = buildDepreciationSchedule({ depreciableCents: 120_000, annualPct: 25, startDate: "2025-07-01" });
    // 1 de julio a 31 de diciembre = 184 días: 300,00 × 184 ÷ 365 = 151,23.
    expect(schedule.years[0]).toMatchObject({ label: "2025", start: "2025-07-01", end: "2025-12-31", days: 184, amountCents: 15_123 });
    expect(schedule.years.map((year) => year.amountCents)).toEqual([15_123, 30_000, 30_000, 30_000, 14_877]);
    expect(schedule.totalCents).toBe(120_000);
    expect(schedule.years[0].months[0]).toMatchObject({ start: "2025-07-01", end: "2025-07-31", days: 31 });
  });

  it("puesta en funcionamiento a mitad de mes: el primer mes solo cuenta sus días", () => {
    const schedule = buildDepreciationSchedule({ depreciableCents: 365_000, annualPct: 10, startDate: "2025-03-15" });
    // Cuota anual 365,00 → 1,00 al día. Del 15 al 31 de marzo: 17 días.
    expect(schedule.years[0].months[0]).toMatchObject({ start: "2025-03-15", end: "2025-03-31", days: 17, amountCents: 1_700 });
    expect(schedule.years[0].amountCents).toBe(29_200);
  });

  it("porcentaje que no divide la vida útil: el último ejercicio amortiza solo el resto", () => {
    const schedule = buildDepreciationSchedule({ depreciableCents: 100_000, annualPct: 33, startDate: "2025-01-01" });
    expect(schedule.years.map((year) => year.amountCents)).toEqual([33_000, 33_000, 33_000, 1_000]);
    // El resto se agota en enero del cuarto año y el cuadro termina ahí.
    expect(schedule.years[3].months).toHaveLength(1);
    expect(schedule.totalCents).toBe(100_000);
  });

  it("vida útil en años con céntimos que no cuadran: nunca se pasa ni se queda corto", () => {
    const schedule = buildDepreciationSchedule({ depreciableCents: 10_000, annualPct: 100 / 3, startDate: "2025-01-01" });
    expect(schedule.years).toHaveLength(3);
    expect(sum(schedule.years.map((year) => year.amountCents))).toBe(10_000);
    for (const year of schedule.years) expect(Math.abs(year.amountCents - 3_333)).toBeLessThanOrEqual(1);
  });

  it("ejercicio corto (empresa creada a mitad de año): amortiza su parte y el siguiente es de 12 meses", () => {
    const schedule = buildDepreciationSchedule({
      depreciableCents: 120_000,
      annualPct: 25,
      startDate: "2025-07-01",
      fiscalYears: [{ code: "2025", start: "2025-07-01", end: "2025-12-31" }],
    });
    expect(schedule.years[0]).toMatchObject({ label: "2025", fiscalStart: "2025-07-01", fiscalEnd: "2025-12-31", amountCents: 15_123 });
    expect(schedule.years[1]).toMatchObject({ label: "2026", fiscalStart: "2026-01-01", fiscalEnd: "2026-12-31", amountCents: 30_000 });
  });

  it("ejercicio que no coincide con el año natural", () => {
    const schedule = buildDepreciationSchedule({
      depreciableCents: 120_000,
      annualPct: 25,
      startDate: "2025-04-01",
      fiscalYears: [{ start: "2025-04-01", end: "2026-03-31" }],
    });
    expect(schedule.years[0]).toMatchObject({ label: "2025/26", fiscalEnd: "2026-03-31", amountCents: 30_000 });
    expect(schedule.years[1]).toMatchObject({ fiscalStart: "2026-04-01", fiscalEnd: "2027-03-31", amountCents: 30_000 });
    expect(schedule.years).toHaveLength(4);
  });

  it("baja: amortiza hasta la fecha de baja incluida y se detiene", () => {
    const schedule = buildDepreciationSchedule({ depreciableCents: 120_000, annualPct: 25, startDate: "2025-01-01", endDate: "2025-06-30" });
    // 181 días de 365: 300,00 × 181 ÷ 365 = 148,77.
    expect(schedule.years).toHaveLength(1);
    expect(schedule.years[0]).toMatchObject({ end: "2025-06-30", days: 181, amountCents: 14_877 });
    expect(schedule.totalCents).toBe(14_877);
  });

  it("bien que ya venía amortizándose: parte de la acumulada anterior y solo amortiza el resto", () => {
    const schedule = buildDepreciationSchedule({ depreciableCents: 120_000, annualPct: 25, startDate: "2026-01-01", priorAccumulatedCents: 100_000 });
    expect(schedule.years.map((year) => year.amountCents)).toEqual([20_000]);
    expect(schedule.totalCents).toBe(120_000);
  });

  it("sin porcentaje, sin valor amortizable o ya amortizado: cuadro vacío", () => {
    expect(buildDepreciationSchedule({ depreciableCents: 120_000, annualPct: 0, startDate: "2025-01-01" }).years).toEqual([]);
    expect(buildDepreciationSchedule({ depreciableCents: 0, annualPct: 25, startDate: "2025-01-01" }).years).toEqual([]);
    expect(buildDepreciationSchedule({ depreciableCents: 100, annualPct: 25, startDate: "2025-01-01", priorAccumulatedCents: 100 }).years).toEqual([]);
    expect(buildDepreciationSchedule({ depreciableCents: 100, annualPct: 25, startDate: "2025-02-30" }).years).toEqual([]);
  });

  it("valida fechas AAAA-MM-DD reales", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2025-02-29")).toBe(false);
    expect(isIsoDate("29/02/2024")).toBe(false);
  });
});

describe("dotaciones pendientes de contabilizar", () => {
  const schedule = buildDepreciationSchedule({ depreciableCents: 120_000, annualPct: 25, startDate: "2025-01-01" });

  it("mensual: un periodo por mes vencido hasta la fecha", () => {
    const pending = pendingPostings(postingPeriods(schedule, "monthly"), { postedThrough: null, postedCents: 0, until: "2025-03-31" });
    expect(pending.map((period) => period.end)).toEqual(["2025-01-31", "2025-02-28", "2025-03-31"]);
    expect(sum(pending.map((period) => period.amountCents))).toBe(Math.round((30_000 * 90) / 365));
    expect(pending[0]).toMatchObject({ label: "enero de 2025", fiscalEnd: "2025-12-31" });
  });

  it("idempotente: lo ya contabilizado no vuelve a salir", () => {
    const periods = postingPeriods(schedule, "monthly");
    const first = pendingPostings(periods, { postedThrough: null, postedCents: 0, until: "2025-03-31" });
    const posted = sum(first.map((period) => period.amountCents));
    expect(pendingPostings(periods, { postedThrough: "2025-03-31", postedCents: posted, until: "2025-03-31" })).toEqual([]);
    const next = pendingPostings(periods, { postedThrough: "2025-03-31", postedCents: posted, until: "2025-04-30" });
    expect(next.map((period) => [period.start, period.end])).toEqual([["2025-04-01", "2025-04-30"]]);
  });

  it("anual: solo al cierre del ejercicio", () => {
    const periods = postingPeriods(schedule, "annual");
    expect(pendingPostings(periods, { postedThrough: null, postedCents: 0, until: "2025-11-30" })).toEqual([]);
    expect(pendingPostings(periods, { postedThrough: null, postedCents: 0, until: "2025-12-31" })).toEqual([
      { start: "2025-01-01", end: "2025-12-31", amountCents: 30_000, label: "ejercicio 2025", fiscalEnd: "2025-12-31" },
    ]);
  });

  it("cambio de mensual a anual a mitad de año: la dotación anual solo lleva lo que falta", () => {
    const monthly = pendingPostings(postingPeriods(schedule, "monthly"), { postedThrough: null, postedCents: 0, until: "2025-06-30" });
    const posted = sum(monthly.map((period) => period.amountCents));
    const annual = pendingPostings(postingPeriods(schedule, "annual"), { postedThrough: "2025-06-30", postedCents: posted, until: "2025-12-31" });
    expect(annual).toHaveLength(1);
    expect(annual[0]).toMatchObject({ start: "2025-07-01", end: "2025-12-31", amountCents: 30_000 - posted });
  });
});
