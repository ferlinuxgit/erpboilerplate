import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { analyzeExpenseInvoiceWithOpenAI } from "@/server/ai/expense-invoice-analysis";
import { completeExpenseOcrJob, createExpenseOcrJob, failExpenseOcrJob } from "@/server/ocr/expense-ocr";

const supportedContentTypes = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "expense.write")) return NextResponse.json({ message: "Sin permisos para analizar gastos." }, { status: 403 });

  const formData = await request.formData();
  const file = formData.get("file");
  const batchId = formData.get("batchId");
  if (!(file instanceof File)) return NextResponse.json({ message: "Adjunta un PDF o imagen." }, { status: 400 });
  if (!supportedContentTypes.has(file.type)) return NextResponse.json({ message: "Formato no soportado. Usa PDF, PNG, JPG o WEBP." }, { status: 400 });
  if (file.size > 12 * 1024 * 1024) return NextResponse.json({ message: "El archivo no puede superar 12 MB." }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  let job: Awaited<ReturnType<typeof createExpenseOcrJob>> | null = null;
  try {
    job = await createExpenseOcrJob({
      tenantId: ctx.tenant.id,
      companyId: ctx.company.id,
      actorUserId: session.user.id,
      fileName: file.name,
      contentType: file.type,
      buffer,
      initialStatus: "PROCESSING",
      extractionProvider: "openai",
      extractionModel: process.env.OPENAI_EXPENSE_ANALYSIS_MODEL || "gpt-5",
      batchId: typeof batchId === "string" && batchId.trim() ? batchId.trim() : undefined,
    });
    const result = await analyzeExpenseInvoiceWithOpenAI({
      fileName: file.name,
      contentType: file.type,
      buffer,
    });
    await completeExpenseOcrJob(job.id, result.draft, JSON.stringify(result.analysis), { provider: "openai", model: result.model });
    return NextResponse.json({
      fileName: job.fileName,
      fileUrl: job.fileUrl,
      contentType: job.contentType,
      sizeBytes: job.sizeBytes,
      jobId: job.id,
      ...result,
    });
  } catch (error) {
    if (job) await failExpenseOcrJob(job.id, error);
    const message = error instanceof Error ? error.message : "No se pudo analizar la factura con OpenAI.";
    const status = message.includes("OPENAI_API_KEY") ? 503 : 400;
    return NextResponse.json({ message, jobId: job?.id, fileName: job?.fileName, fileUrl: job?.fileUrl, contentType: job?.contentType, sizeBytes: job?.sizeBytes }, { status });
  }
}
