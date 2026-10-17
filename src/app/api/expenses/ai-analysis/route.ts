import { after, NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { expenseAnalysisModel } from "@/server/ai/expense-invoice-analysis";
import { createExpenseOcrJob, drainExpenseOcrQueue } from "@/server/ocr/expense-ocr";
import { getExpenseOcrSettings } from "@/server/ocr/settings";
import { withHttpErrors } from "@/lib/http";

const supportedContentTypes = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

/**
 * Sube una factura para leerla con OpenAI. Solo guarda el original y responde al momento (202);
 * la lectura (10-45 s) sigue en segundo plano, en cola. Si el servidor se reinicia a mitad (p. ej. un
 * despliegue), el worker de OCR retoma el trabajo cuando vence su reserva: nada se pierde.
 */
async function handlePOST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "expense.write") && !can(ctx.membership.role, "purchase.write")) return NextResponse.json({ message: "Sin permisos para analizar facturas de proveedor." }, { status: 403 });

  const settings = await getExpenseOcrSettings(ctx.company.id, Boolean(process.env.OPENAI_API_KEY));
  if (!settings.externalAiEnabled) {
    return NextResponse.json({ message: "La lectura con IA está desactivada para esta empresa. Actívala en Configuración → Automatización o registra la factura a mano." }, { status: 403 });
  }
  if (!settings.externalAiConfigured) {
    return NextResponse.json({ message: "La lectura de facturas necesita OPENAI_API_KEY configurada en el servidor." }, { status: 503 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const batchId = formData.get("batchId");
  if (!(file instanceof File)) return NextResponse.json({ message: "Adjunta un PDF o imagen." }, { status: 400 });
  if (!supportedContentTypes.has(file.type)) return NextResponse.json({ message: "Formato no soportado. Usa PDF, PNG, JPG o WEBP." }, { status: 400 });
  if (file.size > 12 * 1024 * 1024) return NextResponse.json({ message: "El archivo no puede superar 12 MB." }, { status: 400 });

  try {
    const job = await createExpenseOcrJob({
      tenantId: ctx.tenant.id,
      companyId: ctx.company.id,
      actorUserId: session.user.id,
      fileName: file.name,
      contentType: file.type,
      buffer: Buffer.from(await file.arrayBuffer()),
      extractionProvider: "openai",
      extractionModel: expenseAnalysisModel(),
      batchId: typeof batchId === "string" && batchId.trim() ? batchId.trim() : undefined,
    });
    // Entra en la cola: se lee en cuanto haya hueco (máximo de lecturas simultáneas).
    after(() => drainExpenseOcrQueue());
    return NextResponse.json({ id: job.id, jobId: job.id, status: job.status, fileName: job.fileName, fileUrl: job.fileUrl, contentType: job.contentType, sizeBytes: job.sizeBytes }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo guardar el documento para leerlo.";
    return NextResponse.json({ message }, { status: 400 });
  }
}

export const POST = withHttpErrors(handlePOST);
