import { NextResponse } from "next/server";

import { httpErrorResponse } from "@/lib/http";
import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { listAvailableAdvances } from "@/server/invoices/service";

/**
 * Facturas de anticipo emitidas de un cliente con importe pendiente de descontar
 * (?customerId=…&excludeInvoiceId=…): las que la factura final puede restar (art. 75.Dos LIVA).
 */
export async function GET(request: Request) {
  try {
    const actor = await authenticateApiActor(request);
    if (isAuthError(actor)) return actor;
    if (!hasApiActorPermission(actor, "invoice.read")) {
      return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
    }
    const url = new URL(request.url);
    const customerId = url.searchParams.get("customerId")?.trim();
    if (!customerId) return NextResponse.json({ message: "Indica el cliente." }, { status: 400 });
    const advances = await listAvailableAdvances(actor.context.company.id, customerId, { excludeInvoiceId: url.searchParams.get("excludeInvoiceId")?.trim() || null });
    return NextResponse.json({ advances });
  } catch (error) {
    return httpErrorResponse(error);
  }
}
