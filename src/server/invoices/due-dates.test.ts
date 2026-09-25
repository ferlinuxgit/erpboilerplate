import { describe, expect, it } from "vitest";

import {
  addDaysToDateInput,
  computeDueDate,
  dateInputInTimeZone,
  defaultDueDateInput,
  describeDueDate,
  effectivePaymentTermsDays,
  todayDateInput,
} from "@/server/invoices/due-dates";

describe("vencimientos", () => {
  it("vencimiento = emisión + días de pago (fechas de formulario, sin saltos de horario)", () => {
    expect(defaultDueDateInput("2026-05-09", 30)).toBe("2026-06-08");
    expect(addDaysToDateInput("2026-03-20", 10)).toBe("2026-03-30"); // cruza el cambio de hora
    expect(addDaysToDateInput("2026-12-15", 30)).toBe("2027-01-14");
    expect(defaultDueDateInput("2026-05-09", 0)).toBe("2026-05-09");
    expect(addDaysToDateInput("no-es-fecha", 30)).toBe("");
  });

  it("usa los días del cliente, si no los de la empresa y si no 30", () => {
    expect(effectivePaymentTermsDays(60, 30)).toBe(60);
    expect(effectivePaymentTermsDays(0, 30)).toBe(0);
    expect(effectivePaymentTermsDays(null, 45)).toBe(45);
    expect(effectivePaymentTermsDays(undefined, undefined)).toBe(30);
  });

  it("calcula el vencimiento en servidor conservando la hora de emisión", () => {
    expect(computeDueDate(new Date("2026-05-09T00:00:00.000Z"), 30).toISOString()).toBe("2026-06-08T00:00:00.000Z");
  });

  it("describe el vencimiento con plurales correctos", () => {
    expect(describeDueDate("2026-06-10", { today: "2026-06-05" })).toMatchObject({ kind: "future", days: 5, label: "Vence en 5 días" });
    expect(describeDueDate("2026-06-06", { today: "2026-06-05" })?.label).toBe("Vence en 1 día");
    expect(describeDueDate("2026-06-05", { today: "2026-06-05" })).toMatchObject({ kind: "today", label: "Vence hoy" });
    expect(describeDueDate("2026-06-04", { today: "2026-06-05" })).toMatchObject({ kind: "overdue", days: 1, label: "Vencida hace 1 día", tone: "danger" });
    expect(describeDueDate(new Date("2026-05-01T00:00:00.000Z"), { today: "2026-06-05" })?.label).toBe("Vencida hace 35 días");
  });

  it("'hoy' se calcula en Europe/Madrid, no en UTC", () => {
    // 23:30 UTC del 31/12 ya es 1 de enero en Madrid (UTC+1).
    const lateNight = new Date("2026-12-31T23:30:00.000Z");
    expect(todayDateInput("Europe/Madrid", lateNight)).toBe("2027-01-01");
    expect(dateInputInTimeZone(lateNight, "UTC")).toBe("2026-12-31");
  });
});
