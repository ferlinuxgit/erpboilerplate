import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

/**
 * Worker de envío VERI*FACTU (mismo patrón que `ocr-worker.ts`): cada VERIFACTU_WORKER_INTERVAL_MS
 * (60 s por defecto, el tiempo de espera estándar de la AEAT entre envíos) procesa la cola de
 * registros PENDING_SEND. Sin VERIFACTU_TRANSPORT=aeat y certificado, no envía nada.
 */
async function main() {
  const { processPendingVerifactuRecords } = await import("../src/server/verifactu/sender");
  const { getConfiguredTransport } = await import("../src/server/verifactu/transport");

  const { transport, reason } = getConfiguredTransport();
  if (!transport) {
    console.log(`VeriFactu worker: envío desactivado (${reason}). Los registros quedan pendientes.`);
    return;
  }

  const baseIntervalMs = Number(process.env.VERIFACTU_WORKER_INTERVAL_MS ?? 60_000);
  console.log(`VeriFactu worker started. intervalMs=${baseIntervalMs}`);
  while (true) {
    let waitMs = baseIntervalMs;
    try {
      const summaries = await processPendingVerifactuRecords({ transport });
      for (const summary of summaries) {
        console.log(`VeriFactu ${summary.companyId}: ${summary.accepted} aceptados, ${summary.rejected} rechazados, ${summary.failed} con error de envío.`);
        // La AEAT indica en cada respuesta cuánto esperar antes del siguiente envío.
        if (summary.waitSeconds) waitMs = Math.max(waitMs, summary.waitSeconds * 1000);
      }
    } catch (error) {
      console.error("VeriFactu worker tick failed", error);
    }
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

void main().catch((error) => {
  console.error("VeriFactu worker failed to start", error);
  process.exitCode = 1;
});
