import { NextResponse } from "next/server";

import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { invoiceErrorResponse, toInvoiceActor } from "@/server/invoices/http";
import { createCreditNoteSchema } from "@/server/invoices/schemas";
import { updateCreditNoteDraft } from "@/server/invoices/service";

/** Edita un borrador de rectificativa `id` (y lo emite si `issue: true`). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  if (!hasApiActorPermission(actor, "invoice.write")) {
    return NextResponse.json({ message: "No tienes permisos para modificar facturas rectificativas." }, { status: 403 });
  }
  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();
  const parsed = createCreditNoteSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Los datos son inválidos." }, { status: 400 });
  }
  const { id } = await params;
  try {
    const updated = await updateCreditNoteDraft(toInvoiceActor(actor), id, parsed.data);
    if (!updated) return NextResponse.json({ message: "Rectificativa no encontrada." }, { status: 404 });
    return NextResponse.json({ ...updated, pdfUrl: `/api/invoices/${updated.id}/pdf` });
  } catch (error) {
    return invoiceErrorResponse(error, "invoice.creditNote.update", "No se pudo guardar la rectificativa.");
  }
}
