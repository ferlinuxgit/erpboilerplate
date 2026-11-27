import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

/**
 * Worker del SII (mismo patrón que `verifactu-worker.ts`): cada SII_WORKER_INTERVAL_MS (5 minutos
 * por defecto) recorre las empresas con el SII activado, deja en la bandeja de salida las facturas
 * expedidas y recibidas sin suministrar, modificadas o anuladas, y envía lo pendiente a la AEAT.
 *
 * Sin SII_TRANSPORT=aeat solo prepara la bandeja (con sus plazos): no envía nada. Con el envío
 * activado, SII_ENVIRONMENT es obligatoria: sin ella no hace nada.
 * SII_WORKER_ONCE=true hace una sola vuelta y termina (para lanzarlo desde un cron).
 */
async function main() {
  const { readSiiEnvironment } = await import("../src/server/sii/config");
  const { detectSiiRecords, listSiiCompanyIds } = await import("../src/server/sii/outbox");
  const { processPendingSiiRecords } = await import("../src/server/sii/sender");
  const { getConfiguredSiiTransport } = await import("../src/server/sii/transport");

  const environment = readSiiEnvironment();
  if (!environment.environment) {
    console.error(`SII worker: ${environment.problem} No se preparará ni se enviará ningún registro hasta corregirlo.`);
    process.exitCode = 1;
    return;
  }
  const { transport, reason } = getConfiguredSiiTransport();
  if (!transport) console.log(`SII worker: envío desactivado (${reason}). Solo se prepara la bandeja de salida.`);

  const intervalMs = Math.max(Number(process.env.SII_WORKER_INTERVAL_MS ?? 300_000) || 300_000, 30_000);
  const once = ["1", "true", "yes"].includes((process.env.SII_WORKER_ONCE ?? "").toLowerCase());
  const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  console.log(`SII worker started. environment=${environment.environment} intervalMs=${intervalMs} send=${transport ? "on" : "off"}`);

  while (true) {
    try {
      for (const companyId of await listSiiCompanyIds()) {
        try {
          const detection = await detectSiiRecords(companyId);
          if (detection.skipped) console.warn(`SII ${companyId}: ${detection.skipped}`);
          else if (detection.created + detection.updated + detection.cancelled + detection.discarded > 0) {
            console.log(`SII ${companyId}: ${detection.created} nuevas, ${detection.updated} actualizadas, ${detection.cancelled} bajas, ${detection.discarded} descartadas.`);
          }
        } catch (error) {
          console.error(`SII ${companyId}: fallo al revisar las facturas`, error);
        }
      }
      if (transport) {
        for (const summary of await processPendingSiiRecords({ transport })) {
          if (summary.sent === 0 && summary.error) {
            console.warn(`SII ${summary.companyId}: ${summary.error}`);
            continue;
          }
          console.log(`SII ${summary.companyId}: ${summary.accepted} aceptados, ${summary.acceptedWithErrors} aceptados con errores, ${summary.rejected} rechazados, ${summary.failed} con error de envío.`);
        }
      }
    } catch (error) {
      console.error("SII worker tick failed", error);
    }
    if (once) return;
    await pause(intervalMs);
  }
}

void main().catch((error) => {
  console.error("SII worker failed to start", error);
  process.exitCode = 1;
});
