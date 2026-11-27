import { NextResponse } from "next/server";

import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { invoiceErrorResponse, toInvoiceActor } from "@/server/invoices/http";
import { issueInvoice } from "@/server/invoices/service";
import { httpErrorResponse } from "@/lib/http";

/** Emite un borrador: número definitivo, snapshot fiscal, asiento y auditoría. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateApiActor(request);
    if (isAuthError(actor)) return actor;
    if (!hasApiActorPermission(actor, "invoice.write")) {
      return NextResponse.json({ message: "No tienes permisos para emitir facturas." }, { status: 403 });
    }
    const { id } = await params;
    // Cuerpo opcional: `{ "confirmVies": true }` confirma el NIF-IVA de un cliente intracomunitario
    // que no tiene una comprobación reciente en VIES.
    const body = (await request.json().catch(() => null)) as { confirmVies?: unknown } | null;
    try {
      const issued = await issueInvoice(toInvoiceActor(actor), id, { confirmVies: body?.confirmVies === true });
      return NextResponse.json({ ...issued, pdfUrl: `/api/invoices/${issued.id}/pdf` });
    } catch (error) {
      return invoiceErrorResponse(error, "invoice.issue", "No se pudo emitir la factura.");
    }
  } catch (error) {
    return httpErrorResponse(error);
  }
}
