import { describe, expect, it } from "vitest";

import { getSpanishFiscalDueDate, nextBusinessDay } from "@/lib/fiscal-spain";
import { easterSunday, isSpanishNationalHoliday, isSpanishNonBusinessDay, spanishNationalHolidays } from "@/lib/spanish-holidays";

const utc = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day));
const iso = (date: Date | null) => date?.toISOString().slice(0, 10);

describe("festivos nacionales (anexos del BOE de 2026 y 2027)", () => {
  it("calcula la Pascua", () => {
    expect(easterSunday(2025)).toEqual({ year: 2025, month: 4, day: 20 });
    expect(easterSunday(2026)).toEqual({ year: 2026, month: 4, day: 5 });
    expect(easterSunday(2027)).toEqual({ year: 2027, month: 3, day: 28 });
  });

  it("2026: las fiestas comunes a toda España del anexo (BOE-A-2025-21667), más las dos que caen en domingo", () => {
    expect(spanishNationalHolidays(2026).map((holiday) => holiday.date)).toEqual([
      "2026-01-01", "2026-01-06", "2026-04-03", "2026-05-01", "2026-08-15", "2026-10-12",
      "2026-11-01", "2026-12-06", // domingos: no figuran en el anexo, pero siguen siendo fiesta nacional
      "2026-12-08", "2026-12-25",
    ]);
  });

  it("2027: las fiestas comunes a toda España del anexo (BOE-A-2026-21254), más el 15 de agosto en domingo", () => {
    expect(spanishNationalHolidays(2027).map((holiday) => holiday.date)).toEqual([
      "2027-01-01", "2027-01-06", "2027-03-26", "2027-05-01", "2027-08-15", "2027-10-12",
      "2027-11-01", "2027-12-06", "2027-12-08", "2027-12-25",
    ]);
  });

  it("no incluye el Jueves Santo ni los lunes de traslado, que decide cada comunidad", () => {
    expect(isSpanishNationalHoliday(2026, 4, 2)).toBe(false); // Jueves Santo de 2026
    expect(isSpanishNationalHoliday(2027, 3, 25)).toBe(false); // Jueves Santo de 2027
    expect(isSpanishNationalHoliday(2026, 11, 2)).toBe(false); // lunes siguiente a Todos los Santos
    expect(isSpanishNationalHoliday(2026, 12, 7)).toBe(false); // lunes siguiente a la Constitución
    expect(isSpanishNationalHoliday(2027, 8, 16)).toBe(false); // lunes siguiente a la Asunción
  });

  it("el 6 de enero solo cuenta en los años contrastados", () => {
    expect(isSpanishNationalHoliday(2026, 1, 6)).toBe(true);
    expect(isSpanishNationalHoliday(2027, 1, 6)).toBe(true);
    expect(isSpanishNationalHoliday(2030, 1, 6)).toBe(false);
    expect(isSpanishNationalHoliday(2030, 12, 25)).toBe(true);
  });

  it("día inhábil: sábado, domingo o festivo nacional", () => {
    expect(isSpanishNonBusinessDay(2027, 11, 1)).toBe(true); // lunes, Todos los Santos
    expect(isSpanishNonBusinessDay(2027, 11, 2)).toBe(false);
    expect(isSpanishNonBusinessDay(2027, 10, 30)).toBe(true); // sábado
  });
});

describe("traslado de los plazos por festivo nacional", () => {
  it("303 mensual de septiembre de 2027: el 30 de octubre es sábado y el lunes 1 de noviembre, festivo", () => {
    expect(iso(getSpanishFiscalDueDate("2027-09", "303"))).toBe("2027-11-02");
  });

  it("un plazo que acaba el domingo 5 de diciembre de 2027 pasa al martes 7 (el lunes 6 es festivo)", () => {
    expect(iso(nextBusinessDay(utc(2027, 12, 5)))).toBe("2027-12-07");
    expect(iso(nextBusinessDay(utc(2027, 12, 6)))).toBe("2027-12-07");
    expect(iso(nextBusinessDay(utc(2027, 12, 8)))).toBe("2027-12-09");
  });

  it("en 2026 el 1 de noviembre y el 6 de diciembre son domingo: el plazo pasa al lunes, que no es festivo nacional", () => {
    expect(iso(nextBusinessDay(utc(2026, 11, 1)))).toBe("2026-11-02");
    expect(iso(nextBusinessDay(utc(2026, 12, 6)))).toBe("2026-12-07");
  });

  it("1 de mayo de 2026 (viernes) y 12 de octubre de 2026 (lunes)", () => {
    expect(iso(nextBusinessDay(utc(2026, 5, 1)))).toBe("2026-05-04");
    expect(iso(nextBusinessDay(utc(2026, 10, 10)))).toBe("2026-10-13");
  });

  it("un día hábil no se mueve (y se devuelve la misma fecha)", () => {
    const date = utc(2027, 4, 20);
    expect(nextBusinessDay(date)).toBe(date);
  });
});
