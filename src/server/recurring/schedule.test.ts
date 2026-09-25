import { describe, expect, it } from "vitest";

import { todayDateInput } from "@/server/invoices/due-dates";
import {
  describeSchedule,
  dueOccurrences,
  intervalForFrequency,
  nextRunAfter,
  occurrenceDate,
  periodVariables,
  renderPeriodText,
  upcomingOccurrences,
  type RecurringSchedule,
} from "@/server/recurring/schedule";

const monthly = (patch: Partial<RecurringSchedule> = {}): RecurringSchedule => ({ startDate: "2026-01-31", dayOfMonth: 31, intervalMonths: 1, ...patch });

describe("variables de texto", () => {
  it("rellena mes, mes anterior, trimestre y año", () => {
    expect(renderPeriodText("Cuota {mes} {año} ({trimestre}) · consumo de {mes_anterior}", "2026-09-01")).toBe("Cuota septiembre 2026 (3T) · consumo de agosto");
  });

  it("respeta la mayúscula inicial y deja intactas las llaves desconocidas", () => {
    expect(renderPeriodText("{Mes} de {año} {cliente}", "2026-01-15")).toBe("Enero de 2026 {cliente}");
  });

  it("el mes anterior de enero es diciembre", () => {
    expect(periodVariables("2027-01-10").mes_anterior).toBe("diciembre");
    expect(periodVariables("2027-01-10").trimestre).toBe("1T");
  });
});

describe("fechas de emisión", () => {
  it("ancla el día 31 al último día de cada mes sin arrastrar el ajuste", () => {
    const schedule = monthly();
    expect([0, 1, 2, 3].map((index) => occurrenceDate(schedule, index))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("respeta los años bisiestos", () => {
    expect(occurrenceDate(monthly({ startDate: "2028-01-31" }), 1)).toBe("2028-02-29");
  });

  it("un día 30 en febrero pasa al último día y vuelve al 30 en marzo", () => {
    expect(upcomingOccurrences(monthly({ startDate: "2026-01-30", dayOfMonth: 30 }), "2026-01-30", 0, 3)).toEqual(["2026-01-30", "2026-02-28", "2026-03-30"]);
  });

  it("trimestral, anual y cada N meses", () => {
    expect(intervalForFrequency("QUARTERLY")).toBe(3);
    expect(intervalForFrequency("YEARLY")).toBe(12);
    expect(intervalForFrequency("EVERY_N_MONTHS", 2)).toBe(2);
    const quarterly = { startDate: "2026-11-15", dayOfMonth: 15, intervalMonths: 3 };
    expect(upcomingOccurrences(quarterly, nextRunAfter(quarterly, null, 0), 0, 3)).toEqual(["2026-11-15", "2027-02-15", "2027-05-15"]);
  });

  it("si el día elegido ya pasó en el mes de inicio empieza el mes siguiente", () => {
    const schedule = { startDate: "2026-09-25", dayOfMonth: 1, intervalMonths: 1 };
    expect(nextRunAfter(schedule, null, 0)).toBe("2026-10-01");
  });

  it("termina por fecha final o por número de emisiones", () => {
    expect(upcomingOccurrences(monthly({ startDate: "2026-01-10", dayOfMonth: 10, endDate: "2026-03-09" }), "2026-01-10", 0, 5)).toEqual(["2026-01-10", "2026-02-10"]);
    expect(nextRunAfter(monthly({ maxOccurrences: 3 }), "2026-03-31", 3)).toBeNull();
    expect(upcomingOccurrences(monthly({ maxOccurrences: 3 }), "2026-02-28", 1, 5)).toEqual(["2026-02-28", "2026-03-31"]);
  });

  it("describe la periodicidad en lenguaje llano", () => {
    expect(describeSchedule({ dayOfMonth: 31, intervalMonths: 1 })).toBe("Cada mes, el último día del mes");
    expect(describeSchedule({ dayOfMonth: 5, intervalMonths: 2 })).toBe("Cada 2 meses, el día 5");
  });
});

describe("periodos pendientes e idempotencia", () => {
  const schedule = { startDate: "2026-01-01", dayOfMonth: 1, intervalMonths: 1 };

  it("recupera los periodos atrasados hasta hoy (worker parado)", () => {
    expect(dueOccurrences(schedule, "2026-01-01", 0, "2026-03-15")).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });

  it("tras generar un periodo nunca lo vuelve a proponer", () => {
    const next = nextRunAfter(schedule, "2026-03-01", 3);
    expect(next).toBe("2026-04-01");
    expect(dueOccurrences(schedule, next, 3, "2026-03-15")).toEqual([]);
  });

  it("al editar la periodicidad no repite periodos ya generados", () => {
    // Se generó hasta el 1 de marzo y el usuario cambia la plantilla a trimestral desde enero.
    const edited = { startDate: "2026-01-01", dayOfMonth: 1, intervalMonths: 3 };
    expect(nextRunAfter(edited, "2026-03-01", 3)).toBe("2026-04-01");
  });

  it("'hoy' se calcula en Europe/Madrid: las 23:30 UTC del 31/12 ya son 1 de enero", () => {
    const now = new Date("2026-12-31T23:30:00.000Z");
    const today = todayDateInput("Europe/Madrid", now);
    expect(today).toBe("2027-01-01");
    expect(dueOccurrences(schedule, "2027-01-01", 12, today)).toEqual(["2027-01-01"]);
    expect(dueOccurrences(schedule, "2027-01-01", 12, todayDateInput("UTC", now))).toEqual([]);
  });

  it("maneja el cambio de hora de octubre sin saltarse días", () => {
    expect(todayDateInput("Europe/Madrid", new Date("2026-10-25T00:30:00.000Z"))).toBe("2026-10-25");
    expect(todayDateInput("Europe/Madrid", new Date("2026-03-28T23:30:00.000Z"))).toBe("2026-03-29");
  });
});
