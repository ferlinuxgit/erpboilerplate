/**
 * Plazos de una sociedad para el calendario fiscal y para «qué tengo que presentar» (función pura):
 * modelo 200, modelo 202 y los recordatorios informativos (libros, cuentas anuales y modelo 232).
 */

import { nextBusinessDay } from "@/lib/fiscal-spain";
import { corporateReminders, corporateTaxReturnWindow, installmentDueDate, type CorporateReminderCode, type CorporateReminderSettings } from "@/server/corporate-tax/deadlines";
import { INSTALLMENT_PERIODS, type InstallmentPeriod } from "@/server/corporate-tax/installments-model";

export type CorporateCalendarInput = {
  fiscalYears: ReadonlyArray<{ id: string; code: string; startsAt: string; endsAt: string }>;
  returns: ReadonlyArray<{ fiscalYearId: string; status: "draft" | "filed"; differentialCents: number | null }>;
  installments: ReadonlyArray<{ fiscalYearId: string; period: InstallmentPeriod; status: "draft" | "filed"; amountCents: number }>;
  reminders: CorporateReminderSettings;
};

export type CorporateDeadline = {
  code: "200" | "202" | CorporateReminderCode;
  kind: "return" | "installment" | "reminder";
  name: string;
  period: string;
  periodLabel: string;
  /** Último día del plazo, ya trasladado si cae en fin de semana. */
  dueDate: Date;
  requirement: "required" | "if-applicable" | "reminder";
  reason: string;
  /** none: sin empezar en el programa. */
  status: "none" | "draft" | "filed";
  /** Importe a ingresar (+) o a devolver (−) en euros, si se conoce. */
  amountDue: number | null;
  href: string;
};

const day = (isoDate: string) => new Date(`${isoDate}T00:00:00.000Z`);

/** Plazos de la sociedad que vencen en el año natural `year`. */
export function corporateDeadlinesDueIn(input: CorporateCalendarInput, year: number): CorporateDeadline[] {
  const deadlines: CorporateDeadline[] = [];
  const years = input.fiscalYears.map((entry) => ({ ...entry, start: day(entry.startsAt), end: day(entry.endsAt) }));
  // Si el ejercicio anterior no está en el programa se supone que coincidió con el año natural.
  const closing = years.some((entry) => corporateTaxReturnWindow(entry.end).to.getUTCFullYear() === year)
    ? years
    : [...years, { id: "", code: String(year - 1), startsAt: `${year - 1}-01-01`, endsAt: `${year - 1}-12-31`, start: day(`${year - 1}-01-01`), end: day(`${year - 1}-12-31`) }];

  for (const fiscalYear of closing) {
    const inProgram = fiscalYear.id !== "";
    const window = corporateTaxReturnWindow(fiscalYear.end);
    if (window.to.getUTCFullYear() === year) {
      const stored = input.returns.find((entry) => entry.fiscalYearId === fiscalYear.id) ?? null;
      deadlines.push({
        code: "200",
        kind: "return",
        name: "Modelo 200",
        period: String(fiscalYear.start.getUTCFullYear()),
        periodLabel: fiscalYear.code,
        dueDate: nextBusinessDay(window.to),
        requirement: inProgram ? "required" : "if-applicable",
        reason: inProgram
          ? "Impuesto sobre Sociedades del ejercicio. Se presenta con Sociedades WEB aunque no haya actividad ni beneficio."
          : "Impuesto sobre Sociedades del ejercicio anterior, si la sociedad ya existía. Ese ejercicio no está en el programa.",
        status: stored ? stored.status : "none",
        amountDue: stored?.differentialCents === null || stored?.differentialCents === undefined ? null : stored.differentialCents / 100,
        href: inProgram ? `/fiscal/sociedades?year=${encodeURIComponent(fiscalYear.id)}` : "/fiscal/sociedades",
      });
    }
    for (const reminder of corporateReminders(fiscalYear.end, fiscalYear.code, input.reminders)) {
      if (reminder.dueDate.getUTCFullYear() !== year) continue;
      deadlines.push({
        code: reminder.code,
        kind: "reminder",
        name: reminder.name,
        period: fiscalYear.code,
        periodLabel: fiscalYear.code,
        dueDate: nextBusinessDay(reminder.dueDate),
        requirement: "reminder",
        reason: reminder.reason,
        status: "none",
        amountDue: null,
        href: "/fiscal/sociedades#recordatorios",
      });
    }
  }

  for (const info of INSTALLMENT_PERIODS) {
    const firstDay = new Date(Date.UTC(year, info.dueMonth - 1, 1));
    const fiscalYear = years.find((entry) => entry.start <= firstDay && firstDay <= entry.end) ?? null;
    const stored = fiscalYear ? input.installments.find((entry) => entry.fiscalYearId === fiscalYear.id && entry.period === info.period) ?? null : null;
    deadlines.push({
      code: "202",
      kind: "installment",
      name: "Modelo 202",
      period: `${year}-${info.period}`,
      periodLabel: `${year} ${info.period}`,
      dueDate: nextBusinessDay(installmentDueDate(year, info.dueMonth)),
      requirement: stored && stored.amountCents > 0 ? "required" : "if-applicable",
      reason: stored
        ? stored.amountCents > 0 ? "Pago a cuenta del Impuesto sobre Sociedades calculado en el programa." : "Según el cálculo guardado no sale importe a ingresar: en general no hay que presentarlo."
        : "Pago a cuenta del Impuesto sobre Sociedades. Solo si sale importe a ingresar (o si la cifra de negocios supera 6 millones).",
      status: stored ? stored.status : "none",
      amountDue: stored ? stored.amountCents / 100 : null,
      href: fiscalYear ? `/fiscal/sociedades/pagos-fraccionados?year=${encodeURIComponent(fiscalYear.id)}` : "/fiscal/sociedades/pagos-fraccionados",
    });
  }

  return deadlines.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.code.localeCompare(b.code));
}

/**
 * Plazos de sociedades que tocan ahora: el 200 desde dos meses antes de que termine su plazo y el
 * 202 desde un mes antes; sin los recordatorios ni lo ya vencido.
 */
export function upcomingCorporateDeadlines(input: CorporateCalendarInput, now: Date): CorporateDeadline[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const horizonDays = { return: 61, installment: 31, reminder: 0 } as const;
  return [now.getUTCFullYear(), now.getUTCFullYear() + 1]
    .flatMap((year) => corporateDeadlinesDueIn(input, year))
    .filter((deadline) => {
      const daysLeft = Math.round((deadline.dueDate.getTime() - today) / 86_400_000);
      return deadline.kind !== "reminder" && daysLeft >= 0 && daysLeft <= horizonDays[deadline.kind];
    });
}
