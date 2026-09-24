import { NextResponse } from "next/server";

import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { invoiceErrorResponse, toInvoiceActor } from "@/server/invoices/http";
import { createCreditNoteSchema } from "@/server/invoices/schemas";
import { createCreditNote } from "@/server/invoices/service";

/** Crea (y por defecto emite) una factura rectificativa de la factura `id`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  if (!hasApiActorPermission(actor, "invoice.create")) {
    return NextResponse.json({ message: "No tienes permisos para crear facturas rectificativas." }, { status: 403 });
  }

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();
  const parsed = createCreditNoteSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Los datos son inválidos." }, { status: 400 });
  }

  const { id } = await params;
  try {
    const created = await createCreditNote(toInvoiceActor(actor), id, parsed.data);
    if (!created) return NextResponse.json({ message: "Factura no encontrada." }, { status: 404 });
    return NextResponse.json({ ...created, pdfUrl: `/api/invoices/${created.id}/pdf` }, { status: 201 });
  } catch (error) {
    return invoiceErrorResponse(error, "invoice.creditNote", "No se pudo crear la factura rectificativa.");
  }
}
