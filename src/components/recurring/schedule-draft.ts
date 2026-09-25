import { isRecurringFrequency, type RecurringFrequency } from "@/server/recurring/schedule";

/** Estado del formulario de periodicidad (módulo sin "use client": lo usan páginas y formularios). */
export type ScheduleDraft = {
  frequency: RecurringFrequency;
  everyMonths: string;
  startDate: string;
  lastDayOfMonth: boolean;
  endMode: "never" | "date" | "count";
  endDate: string;
  maxOccurrences: string;
};

export function defaultScheduleDraft(startDate: string): ScheduleDraft {
  return { frequency: "MONTHLY", everyMonths: "2", startDate, lastDayOfMonth: false, endMode: "never", endDate: "", maxOccurrences: "12" };
}

/** Borrador de edición a partir de una plantilla guardada. */
export function scheduleDraftFromTemplate(template: {
  frequency: string;
  intervalMonths: number;
  startDate: string;
  dayOfMonth: number;
  endDate: string | null;
  maxOccurrences: number | null;
}): ScheduleDraft {
  return {
    frequency: isRecurringFrequency(template.frequency) ? template.frequency : "MONTHLY",
    everyMonths: String(template.intervalMonths),
    startDate: template.startDate,
    lastDayOfMonth: template.dayOfMonth >= 31,
    endMode: template.endDate ? "date" : template.maxOccurrences ? "count" : "never",
    endDate: template.endDate ?? "",
    maxOccurrences: String(template.maxOccurrences ?? 12),
  };
}
