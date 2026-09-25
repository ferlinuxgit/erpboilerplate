import { addDays, daysBetween } from "@/server/recurring/schedule";

/**
 * Reglas puras de reclamación de cobros: tramos de antigüedad de la deuda y qué recordatorio
 * toca enviar según el calendario automático de la empresa.
 */

export type ReminderLevel = 1 | 2 | 3;

export const reminderLevelLabels: Record<ReminderLevel, string> = {
  1: "1.er recordatorio (amable)",
  2: "2.º recordatorio (firme)",
  3: "Último aviso",
};

export type DunningSchedule = {
  enabled: boolean;
  firstDelayDays: number;
  intervalDays: number;
  maxReminders: number;
};

export const DEFAULT_DUNNING_SCHEDULE: DunningSchedule = { enabled: false, firstDelayDays: 3, intervalDays: 7, maxReminders: 3 };

export type AgingBucket = "CURRENT" | "D0_30" | "D31_60" | "D61_90" | "D90_PLUS";

export const AGING_BUCKETS: AgingBucket[] = ["CURRENT", "D0_30", "D31_60", "D61_90", "D90_PLUS"];

export const agingBucketLabels: Record<AgingBucket, string> = {
  CURRENT: "Sin vencer",
  D0_30: "0–30 días",
  D31_60: "31–60 días",
  D61_90: "61–90 días",
  D90_PLUS: "Más de 90 días",
};

/** Tramo de antigüedad a partir de los días vencidos (negativo o null = aún no ha vencido). */
export function agingBucket(daysOverdue: number | null): AgingBucket {
  if (daysOverdue === null || daysOverdue <= 0) return "CURRENT";
  if (daysOverdue <= 30) return "D0_30";
  if (daysOverdue <= 60) return "D31_60";
  if (daysOverdue <= 90) return "D61_90";
  return "D90_PLUS";
}

/** Nivel del siguiente recordatorio manual: sube con cada envío y se queda en el último aviso. */
export function nextReminderLevel(remindersSent: number): ReminderLevel {
  if (remindersSent <= 0) return 1;
  if (remindersSent === 1) return 2;
  return 3;
}

/**
 * Recordatorio automático que toca hoy para una factura vencida, o null si todavía no toca (o ya se
 * enviaron todos). `dueDate`, `lastReminderDate` y `today` son fechas de calendario (YYYY-MM-DD).
 */
export function scheduledReminderLevel(input: {
  schedule: DunningSchedule;
  dueDate: string;
  today: string;
  remindersSent: number;
  lastReminderDate: string | null;
}): ReminderLevel | null {
  const { schedule } = input;
  if (!schedule.enabled) return null;
  const max = Math.min(Math.max(schedule.maxReminders, 1), 3);
  if (input.remindersSent >= max) return null;
  if (input.today <= input.dueDate) return null;
  if (input.remindersSent === 0 || !input.lastReminderDate) {
    return input.today >= addDays(input.dueDate, schedule.firstDelayDays) ? nextReminderLevel(input.remindersSent) : null;
  }
  return daysBetween(input.lastReminderDate, input.today) >= schedule.intervalDays ? nextReminderLevel(input.remindersSent) : null;
}

/** "hoy", "ayer", "hace 5 días". */
export function daysAgoLabel(days: number) {
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  return `hace ${days} días`;
}
