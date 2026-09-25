import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

/**
 * Worker de facturas/gastos recurrentes, recordatorios de cobro automáticos y sincronización
 * bancaria PSD2 (mismo patrón que `ocr-worker.ts`). Cada RECURRING_WORKER_INTERVAL_MS (15 min
 * por defecto) genera los periodos vencidos y envía los recordatorios que tocan. Es idempotente: se puede ejecutar en varias
 * réplicas o junto al cron `POST /api/recurring/run` sin duplicar documentos.
 * `RECURRING_WORKER_ONCE=true` ejecuta un solo ciclo y termina (útil en cron del sistema).
 */
async function main() {
  const { runScheduledJobs } = await import("../src/server/recurring/worker");
  // Sincronización bancaria PSD2 (solo si GOCARDLESS_SECRET_ID/KEY están configurados): cada
  // conexión se sincroniza cuando han pasado BANK_SYNC_INTERVAL_HOURS (6 h por defecto) desde la última.
  const { syncDueBankConnections } = await import("../src/server/bank-connections/service");
  const intervalMs = Math.max(Number(process.env.RECURRING_WORKER_INTERVAL_MS ?? 15 * 60 * 1000), 60_000);
  const once = process.env.RECURRING_WORKER_ONCE === "true";

  async function tick() {
    let failure: unknown = null;
    try {
      const result = await runScheduledJobs();
      console.log(`Recurring worker: ${JSON.stringify(result)}`);
    } catch (error) {
      failure = error;
    }
    // La sincronización bancaria no depende de que las recurrencias hayan ido bien.
    try {
      const bankSync = await syncDueBankConnections();
      if (bankSync.enabled) console.log(`Bank sync: ${JSON.stringify(bankSync)}`);
    } catch (error) {
      console.error("Bank sync tick failed", error);
    }
    if (failure) throw failure;
  }

  if (once) {
    await tick();
    process.exit(0);
  }

  console.log(`Recurring worker started. intervalMs=${intervalMs}`);
  while (true) {
    try {
      await tick();
    } catch (error) {
      console.error("Recurring worker tick failed", error);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

void main().catch((error) => {
  console.error("Recurring worker failed to start", error);
  process.exitCode = 1;
});
