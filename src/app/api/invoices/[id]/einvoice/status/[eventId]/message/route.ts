import { NextResponse } from "next/server";

import { handleRouteError, jsonError } from "@/lib/http";
import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { getEInvoiceStatusMessage } from "@/server/einvoice/service";

/**
 * Descarga el mensaje UBL ApplicationResponse de cobro (SETTLEMENT, anexo II de la Orden
 * HAC/1028/2026) de un estado «Pagada» anotado, para comunicarlo a la solución pública de la AEAT.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; eventId: string }> }) {
  try {
    const actor = await authenticateApiActor(request);
    if (isAuthError(actor)) return actor;
    if (!hasApiActorPermission(actor, "invoice.read")) return jsonError(403, "Sin permisos.");
    const { id, eventId } = await params;
    const message = await getEInvoiceStatusMessage(actor.context.company.id, id, eventId);
    if (!message) return jsonError(404, "El estado o la factura no existen.");
    return new NextResponse(message.xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${message.fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return handleRouteError(error, "einvoice.status.message", "No se pudo generar el mensaje de estado.");
  }
}
