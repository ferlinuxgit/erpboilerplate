import { NextResponse } from "next/server";

import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { invoiceErrorResponse, toInvoiceActor } from "@/server/invoices/http";
import { convertDeliveryToInvoice } from "@/server/sales/service";

/** Albarán → factura emitida por el flujo único de emisión (número, VERI*FACTU, vencimiento…). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  if (!hasApiActorPermission(actor, "invoice.create")) return NextResponse.json({ message: "No tienes permisos para emitir facturas." }, { status: 403 });

  const { id } = await params;
  try {
    const created = await convertDeliveryToInvoice({ ...toInvoiceActor(actor), deliveryNoteId: id });
    return NextResponse.json({ ...created, pdfUrl: `/api/invoices/${created.id}/pdf` }, { status: created.alreadyInvoiced ? 200 : 201 });
  } catch (error) {
    // Reglas de negocio (HttpError / AccountingRuleError / ajustes de empresa) con su estado; el resto, 500 genérico.
    return invoiceErrorResponse(error, "delivery-note.to-invoice", "No se pudo generar la factura.");
  }
}
