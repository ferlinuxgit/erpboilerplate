import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const { processPendingExpenseOcrJobs } = await import("../src/server/ocr/expense-ocr");

const intervalMs = Number(process.env.OCR_WORKER_INTERVAL_MS ?? 5000);

async function tick() {
  try {
    const processed = await processPendingExpenseOcrJobs(Number(process.env.OCR_WORKER_BATCH_SIZE ?? 2));
    if (processed > 0) {
      console.log(`OCR worker processed ${processed} job(s).`);
    }
  } catch (error) {
    console.error("OCR worker tick failed", error);
  }
}

console.log(`OCR worker started. intervalMs=${intervalMs}`);
await tick();
setInterval(() => {
  void tick();
}, intervalMs);
