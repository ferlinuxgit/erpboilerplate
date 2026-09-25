import { timingSafeEqual } from "node:crypto";

import { logger } from "@/lib/logger";

/**
 * Tareas programadas de cobro y recurrencias: genera los documentos recurrentes vencidos y envía
 * los recordatorios de cobro automáticos. Lo ejecutan `scripts/recurring-worker.ts` (proceso
 * continuo) y `POST /api/recurring/run` (cron externo). Ambas tareas son idempotentes.
 */

export type ScheduledJobsDeps = {
  runRecurring: (now: Date) => Promise<unknown>;
  runDunning: (now: Date) => Promise<unknown>;
};

export type ScheduledJobsResult = {
  recurring: { ok: true; result: unknown } | { ok: false; error: string };
  dunning: { ok: true; result: unknown } | { ok: false; error: string };
};

async function defaultDeps(): Promise<ScheduledJobsDeps> {
  const [{ runDueRecurringTemplates }, { processScheduledDunning }] = await Promise.all([
    import("@/server/recurring/service"),
    import("@/server/dunning/service"),
  ]);
  return {
    runRecurring: (now) => runDueRecurringTemplates({ now }),
    runDunning: (now) => processScheduledDunning({ now }),
  };
}

/** Ejecuta las dos tareas; el fallo de una no impide la otra. */
export async function runScheduledJobs(options: { now?: Date; deps?: ScheduledJobsDeps } = {}): Promise<ScheduledJobsResult> {
  const now = options.now ?? new Date();
  const deps = options.deps ?? (await defaultDeps());
  const result: ScheduledJobsResult = {
    recurring: { ok: false, error: "No ejecutado." },
    dunning: { ok: false, error: "No ejecutado." },
  };
  try {
    result.recurring = { ok: true, result: await deps.runRecurring(now) };
  } catch (error) {
    logger.error({ err: error }, "scheduled.recurring_failed");
    result.recurring = { ok: false, error: error instanceof Error ? error.message : "Error inesperado." };
  }
  try {
    result.dunning = { ok: true, result: await deps.runDunning(now) };
  } catch (error) {
    logger.error({ err: error }, "scheduled.dunning_failed");
    result.dunning = { ok: false, error: error instanceof Error ? error.message : "Error inesperado." };
  }
  return result;
}

/**
 * Comprueba el secreto del cron (`x-cron-secret` o `Authorization: Bearer`). Sin CRON_SECRET
 * configurado (o con menos de 16 caracteres) la ruta queda desactivada.
 */
export function isValidCronSecret(headers: Headers, expected: string | undefined) {
  const secret = expected?.trim();
  if (!secret || secret.length < 16) return false;
  const authorization = headers.get("authorization");
  const provided = headers.get("x-cron-secret")?.trim() || (authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "");
  if (!provided) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(secret);
  return left.length === right.length && timingSafeEqual(left, right);
}
