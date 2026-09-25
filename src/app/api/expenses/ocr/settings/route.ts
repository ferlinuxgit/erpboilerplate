import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { getExpenseOcrSettings, updateExpenseOcrSettings } from "@/server/ocr/settings";

const payloadSchema = z.object({ externalAiEnabled: z.boolean() });

function externalAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function GET() {
  try {
    const { ctx } = await requirePermission("expense.read");
    return NextResponse.json(await getExpenseOcrSettings(ctx.company.id, externalAiConfigured()));
  } catch (error) {
    return handleRouteError(error, "expense.ocr.settings.read");
  }
}

/** Solo administración puede permitir o prohibir el envío de facturas a la IA externa. */
export async function PATCH(request: Request) {
  try {
    const { ctx, user } = await requirePermission("settings.manage", "Solo un administrador puede cambiar esta preferencia.");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, "Indica si se permite el análisis externo (sí o no).");
    const saved = await updateExpenseOcrSettings(ctx.company.id, ctx.tenant.id, user.id, parsed.data);
    return NextResponse.json({ ...saved, externalAiConfigured: externalAiConfigured() });
  } catch (error) {
    return handleRouteError(error, "expense.ocr.settings.update", "No se pudo guardar la preferencia.");
  }
}
