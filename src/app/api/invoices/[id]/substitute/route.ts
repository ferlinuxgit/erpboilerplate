import { NextResponse } from "next/server";

import { invalidJsonResponse, readJsonBody, httpErrorResponse } from "@/lib/http";
import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { invoiceErrorResponse, toInvoiceActor } from "@/server/invoices/http";
import { substituteSimplifiedSchema } from "@/server/invoices/schemas";
import { substituteSimplifiedInvoices } from "@/server/invoices/service";

/**
 * Canje: emite una factura completa en sustitución de la factura simplificada `id` (y, si se
 * indican, de otras del mismo cliente). No genera una venta nueva ni un cobro nuevo.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateApiActor(request);
    if (isAuthError(actor)) return actor;
    if (!hasApiActorPermission(actor, "invoice.create")) {
      return NextResponse.json({ message: "No tienes permisos para emitir facturas." }, { status: 403 });
    }

    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = substituteSimplifiedSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Los datos son inválidos." }, { status: 400 });
    }

    const { id } = await params;
    try {
      const created = await substituteSimplifiedInvoices(toInvoiceActor(actor), id, parsed.data);
      if (!created) return NextResponse.json({ message: "Factura no encontrada." }, { status: 404 });
      return NextResponse.json({ ...created, pdfUrl: `/api/invoices/${created.id}/pdf` }, { status: 201 });
    } catch (error) {
      return invoiceErrorResponse(error, "invoice.substitute", "No se pudo convertir la factura simplificada en factura completa.");
    }
  } catch (error) {
    return httpErrorResponse(error);
  }
}
