import { describe, expect, it } from "vitest";

import {
  aggregateOutputVat,
  aggregateSurcharges,
  aggregateWithholdings,
  fiscalBoundaryInstant,
  fiscalCivilDate,
  fiscalQuarterIndex,
  fiscalRangeInstants,
  fiscalTimeZoneFor,
  getDaysUntilDue,
  getFiscalDueStatus,
  getSpanishFiscalDirectDebitDate,
  getSpanishFiscalDueDate,
  isLastVatPeriodOfYear,
  localMidnightInstant,
  normalizeSpanishFiscalPeriod,
  parseSpanishFiscalPeriod,
  previousPeriodsOfYear,
  spanishFiscalModelsFor,
} from "@/lib/fiscal-spain";

describe("Periodos fiscales en hora local", () => {
  const q2 = fiscalRangeInstants(parseSpanishFiscalPeriod("2026-Q2", "303")!);
  const inQ2 = (date: Date) => date >= q2.start && date < q2.endExclusive;

  it("los límites del periodo son la medianoche de Madrid, con horario de verano o de invierno", () => {
    expect(q2.start.toISOString()).toBe("2026-03-31T22:00:00.000Z");
    expect(q2.endExclusive.toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(localMidnightInstant(2026, 0, 1).toISOString()).toBe("2025-12-31T23:00:00.000Z");
    // Días del cambio de hora (29 de marzo y 25 de octubre de 2026): la medianoche no se desplaza.
    expect(localMidnightInstant(2026, 2, 29).toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(localMidnightInstant(2026, 2, 30).toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(localMidnightInstant(2026, 9, 26).toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });

  it("un ticket del 1 de abril a las 00:30 de Madrid (31-03 22:30 UTC) es del segundo trimestre", () => {
    const ticket = new Date("2026-03-31T22:30:00.000Z");
    expect(inQ2(ticket)).toBe(true);
    expect(fiscalCivilDate(ticket)).toEqual({ year: 2026, month: 4, day: 1 });
    expect(fiscalQuarterIndex(ticket)).toBe(1);
    // Un minuto antes de la medianoche de Madrid sigue siendo del primero.
    expect(inQ2(new Date("2026-03-31T21:59:00.000Z"))).toBe(false);
  });

  it("una fecha civil guardada a las 00:00 UTC cae en su propio día", () => {
    expect(inQ2(new Date("2026-03-31T00:00:00.000Z"))).toBe(false);
    expect(inQ2(new Date("2026-04-01T00:00:00.000Z"))).toBe(true);
    expect(inQ2(new Date("2026-06-30T00:00:00.000Z"))).toBe(true);
    expect(inQ2(new Date("2026-07-01T00:00:00.000Z"))).toBe(false);
    expect(fiscalCivilDate(new Date("2026-01-01T00:00:00.000Z"))).toEqual({ year: 2026, month: 1, day: 1 });
    expect(fiscalCivilDate(new Date("2026-01-01T00:00:00.000Z"), "Atlantic/Canary")).toEqual({ year: 2026, month: 1, day: 1 });
  });

  it("el cambio de año: un ticket de las 00:30 del 1 de enero es del año nuevo", () => {
    const year2027 = fiscalRangeInstants(parseSpanishFiscalPeriod("2027", "390")!);
    const ticket = new Date("2026-12-31T23:30:00.000Z");
    expect(ticket >= year2027.start).toBe(true);
    expect(fiscalCivilDate(ticket).year).toBe(2027);
  });

  it("Canarias va una hora por detrás de la península", () => {
    expect(fiscalTimeZoneFor("ES-CN")).toBe("Atlantic/Canary");
    expect(fiscalTimeZoneFor("ES")).toBe("Europe/Madrid");
    expect(fiscalTimeZoneFor(null)).toBe("Europe/Madrid");
    expect(localMidnightInstant(2026, 3, 1, "Atlantic/Canary").toISOString()).toBe("2026-03-31T23:00:00.000Z");
    expect(localMidnightInstant(2026, 0, 1, "Atlantic/Canary").toISOString()).toBe("2026-01-01T00:00:00.000Z");
    // 23:30 en Canarias del 31 de marzo (00:30 en Madrid del 1 de abril): todavía primer trimestre en Canarias.
    expect(fiscalQuarterIndex(new Date("2026-03-31T22:30:00.000Z"), "Atlantic/Canary")).toBe(0);
  });

  it("un límite que ya es un instante no se vuelve a convertir", () => {
    const instant = new Date("2026-03-31T22:00:00.000Z");
    expect(fiscalBoundaryInstant(instant)).toBe(instant);
    expect(fiscalBoundaryInstant(new Date("2026-04-01T00:00:00.000Z")).toISOString()).toBe("2026-03-31T22:00:00.000Z");
  });

  it("identifica el último periodo y los periodos anteriores del ejercicio", () => {
    expect(isLastVatPeriodOfYear("2026-Q4")).toBe(true);
    expect(isLastVatPeriodOfYear("2026-12")).toBe(true);
    expect(isLastVatPeriodOfYear("2026-Q3")).toBe(false);
    expect(previousPeriodsOfYear("2026-Q3")).toEqual(["2026-Q1", "2026-Q2"]);
    expect(previousPeriodsOfYear("2026-03")).toEqual(["2026-01", "2026-02"]);
    expect(previousPeriodsOfYear("2026-Q1")).toEqual([]);
    expect(previousPeriodsOfYear("2026")).toEqual([]);
  });
});

describe("Plazo de domiciliación bancaria", () => {
  const debit = (period: string, code: "303" | "111" | "130" | "347" | "349" | "390" | "420") => getSpanishFiscalDirectDebitDate(period, code)?.toISOString().slice(0, 10) ?? null;

  it("coincide con el calendario de la AEAT para el 303 trimestral de 2026", () => {
    expect(debit("2025-Q4", "303")).toBe("2026-01-27");
    expect(debit("2026-Q1", "303")).toBe("2026-04-15");
    expect(debit("2026-Q2", "303")).toBe("2026-07-15");
    expect(debit("2026-Q3", "303")).toBe("2026-10-15");
  });

  it("se traslada con el plazo cuando el día 20 cae en fin de semana", () => {
    // 20-06-2026 es sábado: el plazo pasa al lunes 22 y la domiciliación al miércoles 17.
    expect(getSpanishFiscalDueDate("2026-05", "111")?.toISOString().slice(0, 10)).toBe("2026-06-22");
    expect(debit("2026-05", "111")).toBe("2026-06-17");
  });

  it("solo existe en los modelos con ingreso de la AEAT", () => {
    expect(debit("2026-Q1", "130")).toBe("2026-04-15");
    expect(debit("2026", "347")).toBeNull();
    expect(debit("2026-Q1", "349")).toBeNull();
    expect(debit("2026", "390")).toBeNull();
    expect(debit("2026-Q1", "420")).toBeNull();
  });
});

describe("Spanish fiscal periods", () => {
  it("parses quarterly IVA periods", () => {
    const range = parseSpanishFiscalPeriod("2026-Q2", "303");

    expect(range?.label).toBe("2026 T2");
    expect(range?.start.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(range?.endExclusive.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("parses monthly IVA periods", () => {
    const range = parseSpanishFiscalPeriod("2026-04", "303");

    expect(range?.label).toBe("2026-04");
    expect(range?.start.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(range?.endExclusive.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  it("requires annual periods for annual models", () => {
    expect(normalizeSpanishFiscalPeriod("2026", "390")).toBe("2026");
    expect(normalizeSpanishFiscalPeriod("2026-Q1", "390")).toBeNull();
  });

  it("computes Spanish filing due dates", () => {
    expect(getSpanishFiscalDueDate("2025-Q4", "303")?.toISOString()).toBe("2026-01-30T00:00:00.000Z");
    expect(getSpanishFiscalDueDate("2026-Q4", "111")?.toISOString()).toBe("2027-01-20T00:00:00.000Z");
    expect(getSpanishFiscalDueDate("2025", "390")?.toISOString()).toBe("2026-01-30T00:00:00.000Z");
    expect(getSpanishFiscalDueDate("2027", "347")?.toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });

  it("moves a deadline that falls on a weekend to the next Monday", () => {
    // El 30-01-2027 es sábado y el 28-02-2027, domingo.
    expect(getSpanishFiscalDueDate("2026-Q4", "303")?.toISOString()).toBe("2027-02-01T00:00:00.000Z");
    expect(getSpanishFiscalDueDate("2026", "390")?.toISOString()).toBe("2027-02-01T00:00:00.000Z");
    expect(getSpanishFiscalDueDate("2026", "347")?.toISOString()).toBe("2027-03-01T00:00:00.000Z");
    // El 20-06-2026 es sábado.
    expect(getSpanishFiscalDueDate("2026-05", "111")?.toISOString()).toBe("2026-06-22T00:00:00.000Z");
  });

  it("gives the monthly 303 until the 30th of the next month (January: end of February)", () => {
    expect(getSpanishFiscalDueDate("2026-03", "303")?.toISOString()).toBe("2026-04-30T00:00:00.000Z");
    expect(getSpanishFiscalDueDate("2026-08", "303")?.toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(getSpanishFiscalDueDate("2027-01", "303")?.toISOString()).toBe("2027-03-01T00:00:00.000Z");
    expect(getSpanishFiscalDueDate("2028-01", "303")?.toISOString()).toBe("2028-02-29T00:00:00.000Z");
    expect(getSpanishFiscalDueDate("2025-12", "303")?.toISOString()).toBe("2026-01-30T00:00:00.000Z");
    // 111 mensual: sigue siendo el día 20.
    expect(getSpanishFiscalDueDate("2026-03", "111")?.toISOString()).toBe("2026-04-20T00:00:00.000Z");
  });

  it("labels due status from a reference day", () => {
    const now = new Date(Date.UTC(2026, 0, 15));

    expect(getDaysUntilDue(new Date(Date.UTC(2026, 0, 20)), now)).toBe(5);
    expect(getFiscalDueStatus(new Date(Date.UTC(2026, 0, 20)), now)).toBe("due-soon");
    expect(getFiscalDueStatus(new Date(Date.UTC(2026, 0, 14)), now)).toBe("overdue");
  });
});

describe("Spanish fiscal aggregation (bucket rounding)", () => {
  const smallLines = [0, 1, 2].map(() => ({ quantity: "1", unitPrice: "0.35", taxRate: "21", retentionRate: "15" }));

  it("computes VAT on the summed base per rate", () => {
    // Línea a línea serían 0,07 × 3 = 0,21; sobre la base del tipo (1,05) la cuota es 0,22.
    expect(aggregateOutputVat(smallLines)).toEqual([{ rate: 21, base: 1.05, tax: 0.22 }]);
  });

  it("keeps partial deductibility per line group within a rate bucket", () => {
    expect(aggregateOutputVat([
      { quantity: 1, unitPrice: 100, taxRate: 21 },
      { quantity: 1, unitPrice: 100, taxRate: 21, taxDeductiblePct: 50 },
    ])).toEqual([{ rate: 21, base: 200, tax: 31.5 }]);
  });

  it("nets negative lines (rectificativas) inside the bucket", () => {
    expect(aggregateOutputVat([
      { quantity: 3, unitPrice: 100, taxRate: 21 },
      { quantity: -1, unitPrice: 100, taxRate: 21 },
    ])).toEqual([{ rate: 21, base: 200, tax: 42 }]);
  });

  it("computes surcharges and withholdings on the bucket base", () => {
    const surchargeLines = smallLines.map((line) => ({
      ...line,
      taxes: [
        { rate: 21, kind: "VAT", operation: "ADD" as const },
        { rate: 5.2, kind: "SURCHARGE", operation: "ADD" as const },
      ],
    }));
    expect(aggregateSurcharges(surchargeLines)).toEqual([{ rate: 5.2, base: 1.05, tax: 0.05 }]);
    expect(aggregateWithholdings(smallLines)).toEqual([{ rate: 15, base: 1.05, tax: 0.16 }]);
  });
});

describe("modelos de la Agencia Tributaria Canaria", () => {
  it("solo para empresas de Canarias; el 450 solo con AIEM", () => {
    const canary = spanishFiscalModelsFor("company", { vatReturns: false, territory: "ES-CN" }).map((model) => model.code);
    expect(canary).toEqual(expect.arrayContaining(["420", "425", "111", "115", "347"]));
    expect(canary).not.toContain("303");
    expect(canary).not.toContain("450");
    expect(spanishFiscalModelsFor("company", { vatReturns: false, territory: "ES-CN", aiem: true }).map((model) => model.code)).toContain("450");
    expect(spanishFiscalModelsFor("company").map((model) => model.code)).not.toContain("420");
  });

  it("plazos: 1-20 del mes siguiente; el cuarto trimestre y el 425, en enero", () => {
    expect(getSpanishFiscalDueDate("2026-Q2", "420")?.toISOString().slice(0, 10)).toBe("2026-07-20");
    expect(getSpanishFiscalDueDate("2026-Q4", "420")?.toISOString().slice(0, 10)).toBe("2027-02-01");
    expect(getSpanishFiscalDueDate("2026-Q4", "450")?.toISOString().slice(0, 10)).toBe("2027-02-01");
    expect(getSpanishFiscalDueDate("2026", "425")?.toISOString().slice(0, 10)).toBe("2027-02-01");
  });
});

