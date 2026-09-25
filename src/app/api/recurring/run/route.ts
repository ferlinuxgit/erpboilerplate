import { NextResponse } from "next/server";

import { handleRouteError, jsonError } from "@/lib/http";
import { isValidCronSecret, runScheduledJobs } from "@/server/recurring/worker";

/**
 * Cron para plataformas sin procesos permanentes: genera recurrencias vencidas y envía los
 * recordatorios automáticos. Protegido con CRON_SECRET (`x-cron-secret` o `Authorization: Bearer`).
 * Acepta GET (formato de Vercel Cron) y POST. Es idempotente: se puede llamar cada pocos minutos.
 */
async function handle(request: Request) {
  if (!isValidCronSecret(request.headers, process.env.CRON_SECRET)) {
    return jsonError(401, "No autorizado.");
  }
  try {
    const result = await runScheduledJobs();
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "recurring.cron", "No se pudieron ejecutar las tareas programadas.");
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
