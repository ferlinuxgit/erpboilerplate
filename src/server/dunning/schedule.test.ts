import { describe, expect, it } from "vitest";

import { agingBucket, daysAgoLabel, nextReminderLevel, scheduledReminderLevel, type DunningSchedule } from "@/server/dunning/schedule";

const schedule: DunningSchedule = { enabled: true, firstDelayDays: 3, intervalDays: 7, maxReminders: 3 };

describe("tramos de antigüedad", () => {
  it("clasifica por días vencidos", () => {
    expect(agingBucket(null)).toBe("CURRENT");
    expect(agingBucket(-5)).toBe("CURRENT");
    expect(agingBucket(0)).toBe("CURRENT");
    expect(agingBucket(1)).toBe("D0_30");
    expect(agingBucket(30)).toBe("D0_30");
    expect(agingBucket(31)).toBe("D31_60");
    expect(agingBucket(60)).toBe("D31_60");
    expect(agingBucket(61)).toBe("D61_90");
    expect(agingBucket(90)).toBe("D61_90");
    expect(agingBucket(91)).toBe("D90_PLUS");
  });
});

describe("escalada de recordatorios", () => {
  it("amable, firme y último aviso", () => {
    expect(nextReminderLevel(0)).toBe(1);
    expect(nextReminderLevel(1)).toBe(2);
    expect(nextReminderLevel(2)).toBe(3);
    expect(nextReminderLevel(7)).toBe(3);
  });

  it("no envía nada con el calendario desactivado ni antes del vencimiento", () => {
    expect(scheduledReminderLevel({ schedule: { ...schedule, enabled: false }, dueDate: "2026-09-01", today: "2026-09-30", remindersSent: 0, lastReminderDate: null })).toBeNull();
    expect(scheduledReminderLevel({ schedule, dueDate: "2026-09-30", today: "2026-09-30", remindersSent: 0, lastReminderDate: null })).toBeNull();
  });

  it("primer recordatorio N días después del vencimiento", () => {
    const base = { schedule, dueDate: "2026-09-01", remindersSent: 0, lastReminderDate: null };
    expect(scheduledReminderLevel({ ...base, today: "2026-09-03" })).toBeNull();
    expect(scheduledReminderLevel({ ...base, today: "2026-09-04" })).toBe(1);
    expect(scheduledReminderLevel({ ...base, today: "2026-10-20" })).toBe(1);
  });

  it("los siguientes cada M días desde el último, hasta el máximo", () => {
    const base = { schedule, dueDate: "2026-09-01" };
    expect(scheduledReminderLevel({ ...base, today: "2026-09-10", remindersSent: 1, lastReminderDate: "2026-09-04" })).toBeNull();
    expect(scheduledReminderLevel({ ...base, today: "2026-09-11", remindersSent: 1, lastReminderDate: "2026-09-04" })).toBe(2);
    expect(scheduledReminderLevel({ ...base, today: "2026-09-18", remindersSent: 2, lastReminderDate: "2026-09-11" })).toBe(3);
    expect(scheduledReminderLevel({ ...base, today: "2026-12-31", remindersSent: 3, lastReminderDate: "2026-09-18" })).toBeNull();
  });

  it("respeta un máximo menor que 3", () => {
    expect(scheduledReminderLevel({ schedule: { ...schedule, maxReminders: 1 }, dueDate: "2026-09-01", today: "2026-10-30", remindersSent: 1, lastReminderDate: "2026-09-04" })).toBeNull();
  });

  it("texto de 'último recordatorio'", () => {
    expect(daysAgoLabel(0)).toBe("hoy");
    expect(daysAgoLabel(1)).toBe("ayer");
    expect(daysAgoLabel(12)).toBe("hace 12 días");
  });
});
