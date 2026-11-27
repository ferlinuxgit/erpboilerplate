import { describe, expect, it } from "vitest";

import { addSiiBusinessDays, easterSunday, formatCivil, isSiiBusinessDay, nationalHolidays, parseExtraHolidays, siiDeadline, siiDeadlineStatus } from "@/server/sii/deadlines";

const d = (year: number, month: number, day: number) => ({ year, month, day });

describe("plazo legal del SII (art. 69 bis RIVA)", () => {
  it("calcula el Domingo de Pascua y el Viernes Santo", () => {
    expect(easterSunday(2026)).toEqual(d(2026, 4, 5));
    expect(easterSunday(2027)).toEqual(d(2027, 3, 28));
    expect(nationalHolidays(2027).has("2027-03-26")).toBe(true);
    expect(nationalHolidays(2027).has("2027-12-25")).toBe(true);
  });

  it("no cuenta sábados, domingos ni festivos nacionales", () => {
    expect(isSiiBusinessDay(d(2027, 3, 13))).toBe(false); // sábado
    expect(isSiiBusinessDay(d(2027, 3, 14))).toBe(false); // domingo
    expect(isSiiBusinessDay(d(2027, 10, 12))).toBe(false); // Fiesta Nacional (martes)
    expect(isSiiBusinessDay(d(2027, 3, 15))).toBe(true);
    expect(isSiiBusinessDay(d(2027, 3, 19), parseExtraHolidays("2027-03-19, no-es-fecha"))).toBe(false);
  });

  it("cuatro días hábiles desde el día siguiente", () => {
    // Expedida el lunes 8 de marzo de 2027: martes, miércoles, jueves y viernes → vence el 12.
    expect(addSiiBusinessDays(d(2027, 3, 8), 4)).toEqual(d(2027, 3, 12));
    // Expedida el jueves 11: viernes 12, lunes 15, martes 16 y miércoles 17.
    expect(addSiiBusinessDays(d(2027, 3, 11), 4)).toEqual(d(2027, 3, 17));
    // Semana Santa de 2027: expedida el miércoles 24 de marzo; el viernes 26 es festivo.
    expect(addSiiBusinessDays(d(2027, 3, 24), 4)).toEqual(d(2027, 3, 31));
  });

  it("en todo caso antes del día 16 del mes siguiente al devengo", () => {
    // Operación del 20 de enero facturada el 12 de febrero (viernes): 4 días → 18 de febrero, pero manda el 15.
    expect(siiDeadline({ start: d(2027, 2, 12), accrual: d(2027, 1, 20) })).toEqual(d(2027, 2, 15));
    expect(siiDeadline({ start: d(2027, 3, 8), accrual: d(2027, 3, 8) })).toEqual(d(2027, 3, 12));
    // Diciembre → 15 de enero del año siguiente.
    expect(siiDeadline({ start: d(2028, 1, 13), accrual: d(2027, 12, 30) })).toEqual(d(2028, 1, 15));
  });

  it("clasifica el plazo: en plazo, a punto de vencer y vencido", () => {
    expect(siiDeadlineStatus(d(2027, 3, 12), d(2027, 3, 9))).toBe("on-time");
    expect(siiDeadlineStatus(d(2027, 3, 12), d(2027, 3, 11))).toBe("due-soon");
    expect(siiDeadlineStatus(d(2027, 3, 12), d(2027, 3, 12))).toBe("due-soon");
    expect(siiDeadlineStatus(d(2027, 3, 12), d(2027, 3, 13))).toBe("overdue");
    expect(formatCivil(d(2027, 3, 5))).toBe("05/03/2027");
  });
});
