import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { addEInvoiceStatus, listEInvoiceStatuses } from "@/server/einvoice/service";
import { EINVOICE_REJECTION_CODES, EINVOICE_STATUSES, summarizeEInvoiceStatus } from "@/server/einvoice/status";

const statusSchema = z.object({
  status: z.enum(EINVOICE_STATUSES, { error: "El estado no es válido." }),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Indica la fecha en que se produjo el estado (AAAA-MM-DD)."),
  rejectionCode: z.enum(EINVOICE_REJECTION_CODES, { error: "El tipo de rechazo no es válido." }).nullable().optional(),
  reason: z.string().trim().max(1000, "El motivo es demasiado largo.").nullable().optional(),
});

/** Historial de estados de la factura electrónica (enviada, recibida, aceptada, rechazada, pagada). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateApiActor(request);
    if (isAuthError(actor)) return actor;
    if (!hasApiActorPermission(actor, "invoice.read")) return jsonError(403, "Sin permisos.");
    const { id } = await params;
    const statuses = await listEInvoiceStatuses(actor.context.company.id, id);
    return NextResponse.json({ statuses, summary: summarizeEInvoiceStatus(statuses) });
  } catch (error) {
    return handleRouteError(error, "einvoice.status.list", "No se pudieron cargar los estados de la factura.");
  }
}

/** Anota un estado (art. 10 del RD 238/2026: aceptación o rechazo comercial y pago efectivo, con su fecha). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateApiActor(request);
    if (isAuthError(actor)) return actor;
    if (!hasApiActorPermission(actor, "invoice.write")) return jsonError(403, "No tienes permisos para anotar estados de facturas.");
    const payload = await readJsonBody(request);
    if (payload === null) return invalidJsonResponse();
    const parsed = statusSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Petición no válida.");
    const { id } = await params;
    const result = await addEInvoiceStatus(
      { tenantId: actor.context.tenant.id, companyId: actor.context.company.id, actorUserId: actor.actorUserId },
      id,
      parsed.data,
    );
    if (!result) return jsonError(404, "Factura no encontrada.");
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "einvoice.status.add", "No se pudo anotar el estado de la factura.");
  }
}
