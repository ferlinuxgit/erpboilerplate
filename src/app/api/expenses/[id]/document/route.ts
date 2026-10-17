import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { withHttpErrors } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { recordAudit } from "@/server/audit";
import { attachDocumentToSupplierInvoice } from "@/server/ocr/document-recovery";

const supportedContentTypes = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

/** Adjunta (o repone, si se perdió) el documento de una factura de proveedor ya registrada. */
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "expense.write") && !can(ctx.membership.role, "purchase.write")) return NextResponse.json({ message: "Sin permisos para adjuntar documentos." }, { status: 403 });

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ message: "Adjunta un PDF o una imagen." }, { status: 400 });
  if (!supportedContentTypes.has(file.type)) return NextResponse.json({ message: "Formato no soportado. Usa PDF, PNG, JPG o WEBP." }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ message: "El archivo está vacío." }, { status: 400 });
  if (file.size > 12 * 1024 * 1024) return NextResponse.json({ message: "El archivo no puede superar 12 MB." }, { status: 400 });

  const { id } = await params;
  const result = await attachDocumentToSupplierInvoice({
    tenantId: ctx.tenant.id,
    companyId: ctx.company.id,
    actorUserId: session.user.id,
    supplierInvoiceId: id,
    fileName: file.name,
    contentType: file.type,
    buffer: Buffer.from(await file.arrayBuffer()),
  });
  if (!result) return NextResponse.json({ message: "Factura no encontrada." }, { status: 404 });
  await recordAudit({
    tenantId: ctx.tenant.id,
    companyId: ctx.company.id,
    actorUserId: session.user.id,
    action: result.mode === "restored" ? "expense.document.restore" : "expense.document.attach",
    entityName: "supplierInvoice",
    entityId: id,
    payload: { fileName: file.name, jobId: result.jobId },
  });
  return NextResponse.json(result, { status: 201 });
}

export const POST = withHttpErrors(handlePOST);
