import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { refreshFaceStatus, requestFaceCancellation, sendEInvoiceToFace } from "@/server/einvoice/face-service";

const faceSchema = z.discriminatedUnion("action", [
  /** Remite el Facturae firmado; FACe envía los avisos de la factura al correo indicado. */
  z.object({ action: z.literal("send"), email: z.string().trim().email("Indica un correo electrónico válido.").max(200) }),
  /** Consulta el estado de tramitación y de anulación en FACe. */
  z.object({ action: z.literal("refresh") }),
  /** Solicita la anulación de la factura remitida, con su motivo. */
  z.object({ action: z.literal("cancel"), reason: z.string().trim().min(1, "Indica el motivo de la anulación.").max(1000) }),
], { error: "Acción no válida: send, refresh o cancel." });

/**
 * Remisión de la factura a FACe por servicio web (Facturae firmado, WS-Security): enviar,
 * consultar el estado o solicitar la anulación. Solo si el servidor tiene FACE_TRANSPORT=face y
 * FACE_ENVIRONMENT declarado. Remitir es actuar en nombre de la empresa: exige permiso de escritura.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateApiActor(request);
    if (isAuthError(actor)) return actor;
    if (!hasApiActorPermission(actor, "invoice.write")) return jsonError(403, "No tienes permisos para remitir facturas a FACe en nombre de la empresa.");
    const payload = await readJsonBody(request);
    if (payload === null) return invalidJsonResponse();
    const parsed = faceSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Petición no válida.");
    const { id } = await params;
    const eActor = { tenantId: actor.context.tenant.id, companyId: actor.context.company.id, actorUserId: actor.actorUserId };
    const face = parsed.data.action === "send"
      ? await sendEInvoiceToFace(eActor, id, { email: parsed.data.email })
      : parsed.data.action === "cancel"
        ? await requestFaceCancellation(eActor, id, { reason: parsed.data.reason })
        : await refreshFaceStatus(eActor, id);
    if (!face) return jsonError(404, "Factura no encontrada.");
    return NextResponse.json({ face });
  } catch (error) {
    return handleRouteError(error, "einvoice.face", "No se pudo completar la operación con FACe.");
  }
}
