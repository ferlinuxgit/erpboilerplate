import { describe, expect, it, vi } from "vitest";

import { accountingDay, accountingDayStartInstant, companyTimeZoneOf, fiscalYearAccountingRange, fiscalYearClosingInstants, resolveAccountingDay } from "@/server/accounting/fiscal-year-date";

const MADRID = "Europe/Madrid";
const CANARY = "Atlantic/Canary";
const utc = (...parts: [number, number, number, number?, number?, number?]) => new Date(Date.UTC(...parts));

describe("día contable en hora local", () => {
  it("un ticket del 1 de enero a las 00:30 de Madrid es del 1 de enero", () => {
    expect(accountingDay(utc(2026, 11, 31, 23, 30), MADRID)).toEqual(utc(2027, 0, 1));
  });

  it("en Canarias las 23:30 UTC del 31 de diciembre siguen siendo 31 de diciembre", () => {
    expect(accountingDay(utc(2026, 11, 31, 23, 30), CANARY)).toEqual(utc(2026, 11, 31));
  });

  it("las 23:30 de Madrid del 31 de diciembre son todavía del ejercicio viejo", () => {
    expect(accountingDay(utc(2026, 11, 31, 22, 30), MADRID)).toEqual(utc(2026, 11, 31));
  });

  it("en verano el desfase es de dos horas (ejercicio partido que acaba el 30 de junio)", () => {
    expect(accountingDay(utc(2026, 5, 30, 22, 30), MADRID)).toEqual(utc(2026, 6, 1));
    expect(accountingDay(utc(2026, 5, 30, 21, 59), MADRID)).toEqual(utc(2026, 5, 30));
  });

  it("las fechas de formulario (00:00 UTC) no se mueven en ninguna zona", () => {
    for (const zone of [MADRID, CANARY, "UTC", "America/Argentina/Buenos_Aires", "Asia/Dubai"]) {
      expect(accountingDay(utc(2027, 0, 1), zone)).toEqual(utc(2027, 0, 1));
      expect(accountingDay(utc(2026, 11, 31), zone)).toEqual(utc(2026, 11, 31));
    }
  });

  it("al oeste de UTC se conserva el día UTC (la medianoche local dejaría fuera las fechas de formulario)", () => {
    expect(accountingDay(utc(2027, 0, 1, 1, 0), "America/Argentina/Buenos_Aires")).toEqual(utc(2027, 0, 1));
    expect(accountingDayStartInstant(utc(2027, 0, 1), "America/Argentina/Buenos_Aires")).toEqual(utc(2027, 0, 1));
  });
});

describe("límites del ejercicio como instantes", () => {
  const year = { startsAt: utc(2026, 0, 1), endsAt: utc(2026, 11, 31) };

  it("el ejercicio va de medianoche local a medianoche local", () => {
    const range = fiscalYearAccountingRange(year, MADRID);
    expect(range.instants.from).toEqual(utc(2025, 11, 31, 23));
    expect(range.instants.toExclusive).toEqual(utc(2026, 11, 31, 23));
    expect(range.civil).toEqual({ from: utc(2026, 0, 1), toExclusive: utc(2027, 0, 1) });
  });

  it("regularización y cierre se fechan en los últimos segundos del último día local", () => {
    const { regularization, closing } = fiscalYearClosingInstants(year, MADRID);
    expect(regularization).toEqual(utc(2026, 11, 31, 22, 59, 58));
    expect(closing).toEqual(utc(2026, 11, 31, 22, 59, 59));
    // Su día contable es el último del ejercicio: numeran y validan contra el ejercicio que cierran.
    expect(accountingDay(regularization, MADRID)).toEqual(utc(2026, 11, 31));
    expect(accountingDay(closing, MADRID)).toEqual(utc(2026, 11, 31));
  });

  it("en Canarias en invierno coinciden con los UTC", () => {
    expect(fiscalYearClosingInstants(year, CANARY).closing).toEqual(utc(2026, 11, 31, 23, 59, 59));
  });
});

describe("zona horaria de la empresa", () => {
  it("península, Canarias y otros países", () => {
    expect(companyTimeZoneOf({ countryCode: "ES", postalCode: "28001" })).toBe(MADRID);
    expect(companyTimeZoneOf({ countryCode: "ES", postalCode: "35001" })).toBe(CANARY);
    expect(companyTimeZoneOf({ countryCode: "AR" })).toBe("America/Argentina/Buenos_Aires");
    expect(companyTimeZoneOf(null)).toBe(MADRID);
  });
});

describe("resolveAccountingDay", () => {
  function clientReturning(rows: unknown[]) {
    const where = vi.fn(async () => rows);
    const select = vi.fn(() => ({ from: () => ({ where }) }));
    return { client: { select } as never, select };
  }

  it("no consulta la empresa para fechas de formulario ni para horas en las que ninguna zona cambia el día", async () => {
    const { client, select } = clientReturning([]);
    expect(await resolveAccountingDay(client, "c", utc(2027, 0, 1))).toEqual(utc(2027, 0, 1));
    expect(await resolveAccountingDay(client, "c", utc(2026, 11, 31, 9, 15))).toEqual(utc(2026, 11, 31));
    expect(select).not.toHaveBeenCalled();
  });

  it("consulta la zona de la empresa en las últimas horas del día UTC", async () => {
    const madrid = clientReturning([{ countryCode: "ES", postalCode: "08001", province: null }]);
    expect(await resolveAccountingDay(madrid.client, "c", utc(2026, 11, 31, 23, 30))).toEqual(utc(2027, 0, 1));
    const canary = clientReturning([{ countryCode: "ES", postalCode: "38001", province: null }]);
    expect(await resolveAccountingDay(canary.client, "c", utc(2026, 11, 31, 23, 30))).toEqual(utc(2026, 11, 31));
  });
});
