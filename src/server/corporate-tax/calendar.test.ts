import { describe, expect, it } from "vitest";

import { getSpanishFiscalDueDate, getSpanishFiscalModel, isCorporateTaxModelCode, parseSpanishFiscalPeriod, spanishFiscalModels, spanishFiscalModelsFor } from "@/lib/fiscal-spain";
import { corporateDeadlinesDueIn, upcomingCorporateDeadlines, type CorporateCalendarInput } from "@/server/corporate-tax/calendar";
import { buildFiscalCalendar } from "@/server/fiscal/calendar";

const data: CorporateCalendarInput = {
  fiscalYears: [
    { id: "fy25", code: "2025", startsAt: "2025-01-01", endsAt: "2025-12-31" },
    { id: "fy26", code: "2026", startsAt: "2026-01-01", endsAt: "2026-12-31" },
  ],
  returns: [],
  installments: [],
  reminders: { relatedParties: false, books: true, annualAccounts: true },
};

const summary = (input: CorporateCalendarInput, year: number) => corporateDeadlinesDueIn(input, year).map((entry) => [entry.code, entry.period, entry.dueDate.toISOString().slice(0, 10)]);

describe("modelos 200 y 202 en fiscal-spain", () => {
  it("existen como modelos con asistente propio y no se ofrecen como borrador", () => {
    expect(getSpanishFiscalModel("200")?.assistantHref).toBe("/fiscal/sociedades");
    expect(getSpanishFiscalModel("202")?.cadence).toBe("installments");
    expect(isCorporateTaxModelCode("200") && isCorporateTaxModelCode("202")).toBe(true);
    expect(isCorporateTaxModelCode("303")).toBe(false);
    expect(spanishFiscalModels.some((model) => model.code === "200" || model.code === "202")).toBe(false);
    expect(spanishFiscalModelsFor("company").some((model) => model.code === "200")).toBe(false);
  });

  it("plazos: 200 el 25 de julio (ejercicio natural) y 202 el 20 de abril, octubre y diciembre, trasladados si caen en fin de semana", () => {
    // 25-07-2026 es sábado → lunes 27; 20-12-2026 es domingo → lunes 21.
    expect(getSpanishFiscalDueDate("2025", "200")?.toISOString().slice(0, 10)).toBe("2026-07-27");
    expect(getSpanishFiscalDueDate("2026", "200")?.toISOString().slice(0, 10)).toBe("2027-07-26");
    expect(["2026-1P", "2026-2P", "2026-3P"].map((period) => getSpanishFiscalDueDate(period, "202")?.toISOString().slice(0, 10))).toEqual(["2026-04-20", "2026-10-20", "2026-12-21"]);
  });

  it("periodos del 202: 3, 9 y 11 primeros meses", () => {
    expect(parseSpanishFiscalPeriod("2026-2P", "202")).toEqual({ label: "2026 2P", start: new Date("2026-01-01T00:00:00.000Z"), endExclusive: new Date("2026-10-01T00:00:00.000Z") });
    expect(parseSpanishFiscalPeriod("2026-4P", "202")).toBeNull();
    expect(parseSpanishFiscalPeriod("2026-1P", "303")).toBeNull();
  });
});

describe("plazos de una sociedad", () => {
  it("año natural: libros, 200, depósito de cuentas y los tres 202", () => {
    expect(summary(data, 2026)).toEqual([
      ["202", "2026-1P", "2026-04-20"],
      ["LIBROS", "2025", "2026-04-30"],
      ["200", "2025", "2026-07-27"],
      ["CCAA", "2025", "2026-07-30"],
      ["202", "2026-2P", "2026-10-20"],
      ["202", "2026-3P", "2026-12-21"],
    ]);
  });

  it("el 232 solo aparece si se activa", () => {
    expect(summary({ ...data, reminders: { relatedParties: true, books: false, annualAccounts: false } }, 2026).filter(([code]) => code === "232")).toEqual([["232", "2025", "2026-11-30"]]);
  });

  it("si el ejercicio anterior no está en el programa se supone natural y el 200 queda como «si aplica»", () => {
    const first = corporateDeadlinesDueIn({ ...data, fiscalYears: [data.fiscalYears[1]] }, 2026).find((entry) => entry.code === "200");
    expect(first).toMatchObject({ period: "2025", requirement: "if-applicable", href: "/fiscal/sociedades" });
  });

  it("ejercicio partido: el 200 vence 25 días después de los seis meses del cierre", () => {
    const split: CorporateCalendarInput = { ...data, fiscalYears: [{ id: "fy", code: "2025/26", startsAt: "2025-07-01", endsAt: "2026-06-30" }] };
    expect(summary(split, 2027).find(([code]) => code === "200")).toEqual(["200", "2025", "2027-01-25"]);
  });

  it("estado e importe de lo guardado en el programa", () => {
    const deadlines = corporateDeadlinesDueIn({
      ...data,
      returns: [{ fiscalYearId: "fy25", status: "filed", differentialCents: 123_456 }],
      installments: [{ fiscalYearId: "fy26", period: "1P", status: "draft", amountCents: 0 }, { fiscalYearId: "fy26", period: "2P", status: "filed", amountCents: 90_000 }],
    }, 2026);
    expect(deadlines.find((entry) => entry.code === "200")).toMatchObject({ status: "filed", amountDue: 1234.56, href: "/fiscal/sociedades?year=fy25" });
    expect(deadlines.find((entry) => entry.period === "2026-1P")).toMatchObject({ status: "draft", requirement: "if-applicable", amountDue: 0 });
    expect(deadlines.find((entry) => entry.period === "2026-2P")).toMatchObject({ status: "filed", requirement: "required", amountDue: 900 });
  });

  it("lo que toca ahora: el 200 dos meses antes y el 202 un mes antes, sin recordatorios", () => {
    const codes = (now: string) => upcomingCorporateDeadlines(data, new Date(now)).map((entry) => `${entry.code} ${entry.period}`);
    expect(codes("2026-04-05T10:00:00.000Z")).toEqual(["202 2026-1P"]);
    expect(codes("2026-06-15T10:00:00.000Z")).toEqual(["200 2025"]);
    expect(codes("2026-08-01T10:00:00.000Z")).toEqual([]);
  });
});

describe("calendario fiscal con sociedades", () => {
  const base = { year: 2026, periodicity: "quarterly" as const, fiscalRegime: "general", reports: [], now: new Date("2026-08-10T10:00:00.000Z") };

  it("sin datos de sociedades el calendario no cambia", () => {
    const calendar = buildFiscalCalendar({ ...base, taxpayerType: "company" });
    expect(calendar.some((entry) => entry.code === "200" || entry.code === "202" || entry.code === "LIBROS")).toBe(false);
  });

  it("los autónomos no ven los modelos de sociedades aunque lleguen los datos", () => {
    const calendar = buildFiscalCalendar({ ...base, taxpayerType: "individual", corporateTax: data });
    expect(calendar.some((entry) => entry.code === "200" || entry.code === "202")).toBe(false);
  });

  it("sociedad: aparecen con enlace a su asistente; el 200 solo vence en rojo si se empezó y no se presentó", () => {
    const untouched = buildFiscalCalendar({ ...base, taxpayerType: "company", corporateTax: data });
    expect(untouched.find((entry) => entry.code === "200")).toMatchObject({ state: "past", href: "/fiscal/sociedades?year=fy25", requirement: "required", report: null });
    expect(untouched.find((entry) => entry.code === "LIBROS")).toMatchObject({ state: "past", requirement: "reminder" });
    expect(untouched.find((entry) => entry.code === "202" && entry.period === "2026-2P")).toMatchObject({ state: "planned", requirement: "if-applicable" });
    const started = buildFiscalCalendar({ ...base, taxpayerType: "company", corporateTax: { ...data, returns: [{ fiscalYearId: "fy25", status: "draft", differentialCents: null }] } });
    expect(started.find((entry) => entry.code === "200")?.state).toBe("overdue");
    const filed = buildFiscalCalendar({ ...base, taxpayerType: "company", corporateTax: { ...data, returns: [{ fiscalYearId: "fy25", status: "filed", differentialCents: 100 }] } });
    expect(filed.find((entry) => entry.code === "200")?.state).toBe("filed");
    const dates = untouched.map((entry) => entry.dueDate);
    expect([...dates].sort()).toEqual(dates);
  });
});
