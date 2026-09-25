import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { ATTACHMENT_ONLY_PROVIDER, createExpenseOcrJob } from "@/server/ocr/expense-ocr";

const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;

/**
 * Sube el justificante de una factura introducida a mano. Se guarda en el mismo almacén
 * privado que los documentos del OCR (local o S3), sin analizarlo, y se asocia a la factura
 * al registrarla (`ocrJobId`), lo que además detecta si ese archivo ya se contabilizó.
 */
export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "expense.write") && !can(ctx.membership.role, "purchase.write")) return NextResponse.json({ message: "Sin permisos para adjuntar documentos." }, { status: 403 });

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ message: "Adjunta un PDF o una imagen." }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ message: "El archivo está vacío." }, { status: 400 });
  if (file.size > MAX_ATTACHMENT_BYTES) return NextResponse.json({ message: "El archivo supera el tamaño máximo de 12 MB." }, { status: 400 });

  try {
    const job = await createExpenseOcrJob({
      tenantId: ctx.tenant.id,
      companyId: ctx.company.id,
      actorUserId: session.user.id,
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      buffer: Buffer.from(await file.arrayBuffer()),
      initialStatus: "DONE",
      extractionProvider: ATTACHMENT_ONLY_PROVIDER,
    });
    return NextResponse.json({ id: job.id, fileName: job.fileName, fileUrl: job.fileUrl, contentType: job.contentType, sizeBytes: job.sizeBytes }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo guardar el archivo.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
