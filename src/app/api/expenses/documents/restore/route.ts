import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { withHttpErrors } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { recordAudit } from "@/server/audit";
import { restoreDocumentByHash } from "@/server/ocr/document-recovery";

/**
 * Recuperación en bloque: recibe un archivo (el cliente envía uno por petición) y, si es idéntico
 * al original de alguna factura registrada cuyo documento se perdió, lo repone en su sitio.
 */
async function handlePOST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "expense.write") && !can(ctx.membership.role, "purchase.write")) return NextResponse.json({ message: "Sin permisos para recuperar documentos." }, { status: 403 });

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ message: "Adjunta un PDF o una imagen." }, { status: 400 });
  if (file.size > 12 * 1024 * 1024) return NextResponse.json({ message: "El archivo no puede superar 12 MB." }, { status: 400 });

  const result = await restoreDocumentByHash(ctx.company.id, Buffer.from(await file.arrayBuffer()), file.type || "application/octet-stream");
  if (result.status === "restored") {
    await recordAudit({
      tenantId: ctx.tenant.id,
      companyId: ctx.company.id,
      actorUserId: session.user.id,
      action: "expense.document.restore",
      entityName: "supplierInvoice",
      entityId: result.invoices[0].id,
      payload: { fileName: file.name, invoices: result.invoices.map((invoice) => invoice.number) },
    });
  }
  return NextResponse.json(result);
}

export const POST = withHttpErrors(handlePOST);
