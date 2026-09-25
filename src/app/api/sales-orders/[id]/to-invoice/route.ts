import { NextResponse } from "next/server";

import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { invoiceErrorResponse, toInvoiceActor } from "@/server/invoices/http";
import { convertOrderToInvoice } from "@/server/sales/service";

/** Pedido sin albaranes → factura en borrador (para revisarla y emitirla). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  if (!hasApiActorPermission(actor, "invoice.create")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  try {
    const created = await convertOrderToInvoice({ ...toInvoiceActor(actor), salesOrderId: id });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return invoiceErrorResponse(error, "salesOrder.invoice", "No se pudo crear la factura desde el pedido.");
  }
}
