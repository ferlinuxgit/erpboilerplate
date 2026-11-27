import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

/**
 * Worker de envío VERI*FACTU (mismo patrón que `ocr-worker.ts`): cada VERIFACTU_WORKER_INTERVAL_MS
 * (60 s por defecto) procesa la cola de registros PENDING_SEND del entorno de este despliegue.
 * Sin VERIFACTU_TRANSPORT=aeat, VERIFACTU_ENVIRONMENT explícito y certificado, no envía nada.
 *
 * El control de flujo de la AEAT (tiempo de espera entre envíos) se guarda por empresa y entorno en
 * la base de datos: lo comparten este worker, «Enviar ahora» y cualquier otra réplica. El worker es
 * además el único que aísla el registro que hace fallar un lote, esperando entre envío y envío.
 */
async function main() {
  const { processPendingVerifactuRecords } = await import("../src/server/verifactu/sender");
  const { getConfiguredTransport } = await import("../src/server/verifactu/transport");
  const { readVerifactuEnvironment } = await import("../src/server/verifactu/config");

  const environment = readVerifactuEnvironment();
  if (!environment.environment) {
    // Error de configuración, no un «desactivado» más: sin entorno declarado no se remite nada.
    console.error(`VeriFactu worker: ${environment.problem} No se enviará ningún registro hasta corregirlo.`);
    process.exitCode = 1;
    return;
  }
  const { transport, reason } = getConfiguredTransport();
  if (!transport) {
    console.log(`VeriFactu worker: envío desactivado (${reason}). Los registros quedan pendientes.`);
    return;
  }

  const baseIntervalMs = Number(process.env.VERIFACTU_WORKER_INTERVAL_MS ?? 60_000);
  const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  console.log(`VeriFactu worker started. environment=${environment.environment} intervalMs=${baseIntervalMs}`);
  while (true) {
    try {
      const summaries = await processPendingVerifactuRecords({ transport, pause });
      for (const summary of summaries) {
        if (summary.throttledSeconds) continue; // La AEAT pidió esperar: se enviará en una vuelta posterior.
        if (summary.sent === 0 && summary.error) {
          console.warn(`VeriFactu ${summary.companyId}: ${summary.error}`);
          continue;
        }
        console.log(`VeriFactu ${summary.companyId}: ${summary.accepted} aceptados, ${summary.rejected} rechazados, ${summary.failed} con error de envío.`);
      }
    } catch (error) {
      console.error("VeriFactu worker tick failed", error);
    }
    await pause(baseIntervalMs);
  }
}

void main().catch((error) => {
  console.error("VeriFactu worker failed to start", error);
  process.exitCode = 1;
});
