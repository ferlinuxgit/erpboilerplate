import { NextResponse } from "next/server";

import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { invoiceErrorResponse, toInvoiceActor } from "@/server/invoices/http";
import { convertQuoteToInvoice } from "@/server/sales/service";

/** Presupuesto → factura en borrador (para revisarla y emitirla). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  if (!hasApiActorPermission(actor, "invoice.create")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  try {
    const created = await convertQuoteToInvoice({ ...toInvoiceActor(actor), quoteId: id });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return invoiceErrorResponse(error, "salesQuote.invoice", "No se pudo crear la factura desde el presupuesto.");
  }
}
