import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { isValidCronSecret, runScheduledJobs } from "@/server/recurring/worker";

describe("runScheduledJobs", () => {
  it("ejecuta recurrencias y recordatorios con la misma fecha", async () => {
    const now = new Date("2026-09-25T07:00:00Z");
    const runRecurring = vi.fn(async () => ({ generated: 2 }));
    const runDunning = vi.fn(async () => ({ sent: 1 }));
    const result = await runScheduledJobs({ now, deps: { runRecurring, runDunning } });
    expect(runRecurring).toHaveBeenCalledWith(now);
    expect(runDunning).toHaveBeenCalledWith(now);
    expect(result).toEqual({ recurring: { ok: true, result: { generated: 2 } }, dunning: { ok: true, result: { sent: 1 } } });
  });

  it("un fallo en las recurrencias no impide enviar los recordatorios", async () => {
    const runDunning = vi.fn(async () => ({ sent: 0 }));
    const result = await runScheduledJobs({ deps: { runRecurring: async () => { throw new Error("db caída"); }, runDunning } });
    expect(result.recurring).toEqual({ ok: false, error: "db caída" });
    expect(result.dunning.ok).toBe(true);
    expect(runDunning).toHaveBeenCalledOnce();
  });
});

describe("isValidCronSecret", () => {
  const secret = "s3cr3t-cron-value-123";

  it("acepta la cabecera x-cron-secret o Authorization: Bearer", () => {
    expect(isValidCronSecret(new Headers({ "x-cron-secret": secret }), secret)).toBe(true);
    expect(isValidCronSecret(new Headers({ authorization: `Bearer ${secret}` }), secret)).toBe(true);
  });

  it("rechaza secretos incorrectos, ausentes o demasiado cortos", () => {
    expect(isValidCronSecret(new Headers({ "x-cron-secret": "otro" }), secret)).toBe(false);
    expect(isValidCronSecret(new Headers(), secret)).toBe(false);
    expect(isValidCronSecret(new Headers({ "x-cron-secret": "corto" }), "corto")).toBe(false);
    expect(isValidCronSecret(new Headers({ "x-cron-secret": secret }), undefined)).toBe(false);
  });
});
