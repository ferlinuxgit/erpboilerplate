import { NextResponse } from "next/server";

import { invalidJsonResponse, readJsonBody, httpErrorResponse } from "@/lib/http";
import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { invoiceErrorResponse, toInvoiceActor } from "@/server/invoices/http";
import { correctSubstitutiveSchema } from "@/server/invoices/schemas";
import { correctSubstitutiveInvoice } from "@/server/invoices/service";

/**
 * Corrige la factura de canje (F3) `id`: emite una F3 de signo contrario que la anula y una F3
 * nueva con el cliente correcto (preguntas frecuentes de VERI*FACTU de la AEAT).
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
    const parsed = correctSubstitutiveSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Los datos son inválidos." }, { status: 400 });
    }

    const { id } = await params;
    try {
      const result = await correctSubstitutiveInvoice(toInvoiceActor(actor), id, parsed.data);
      if (!result) return NextResponse.json({ message: "Factura no encontrada." }, { status: 404 });
      return NextResponse.json({ ...result, pdfUrl: `/api/invoices/${result.corrected.id}/pdf` }, { status: 201 });
    } catch (error) {
      return invoiceErrorResponse(error, "invoice.substitute.correct", "No se pudo corregir la factura de canje.");
    }
  } catch (error) {
    return httpErrorResponse(error);
  }
}
