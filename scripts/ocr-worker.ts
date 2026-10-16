import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { cleanupExpiredExpenseOcrJobs, processPendingExpenseOcrJobs } = await import("../src/server/ocr/expense-ocr");
  const { checkAllMailInboxes } = await import("../src/server/ocr/mail-inbox");

  const intervalMs = Number(process.env.OCR_WORKER_INTERVAL_MS ?? 5000);
  // Buzones de facturas por correo: cada 2 minutos por defecto.
  const mailIntervalMs = Math.max(Number(process.env.MAIL_INBOX_POLL_INTERVAL_MS ?? 120_000), 30_000);
  let nextCleanupAt = 0;
  let nextMailCheckAt = 0;

  async function tick() {
    try {
      const processed = await processPendingExpenseOcrJobs(Number(process.env.OCR_WORKER_BATCH_SIZE ?? 2));
      if (processed > 0) {
        console.log(`OCR worker processed ${processed} job(s).`);
      }
      if (Date.now() >= nextMailCheckAt) {
        nextMailCheckAt = Date.now() + mailIntervalMs;
        const mail = await checkAllMailInboxes();
        if (mail.imported > 0) console.log(`OCR worker imported ${mail.imported} document(s) from ${mail.inboxes} mail inbox(es).`);
      }
      if (Date.now() >= nextCleanupAt) {
        await cleanupExpiredExpenseOcrJobs();
        nextCleanupAt = Date.now() + 12 * 60 * 60 * 1000;
      }
    } catch (error) {
      console.error("OCR worker tick failed", error);
    }
  }

  console.log(`OCR worker started. intervalMs=${intervalMs} mailIntervalMs=${mailIntervalMs}`);
  while (true) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

void main().catch((error) => {
  console.error("OCR worker failed to start", error);
  process.exitCode = 1;
});
