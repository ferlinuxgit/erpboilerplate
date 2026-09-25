import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { setQuoteStatus } from "@/server/sales/service";

const payloadSchema = z.object({ status: z.enum(["SENT", "CONFIRMED", "REJECTED", "VOID"], { error: "Estado de presupuesto no válido." }) });

/** Cambia el estado de un presupuesto: Enviado, Aceptado, Rechazado o Anulado. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  if (!hasApiActorPermission(actor, "invoice.create")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const { id } = await params;
  try {
    const updated = await setQuoteStatus({
      tenantId: actor.context.tenant.id,
      companyId: actor.context.company.id,
      actorUserId: actor.actorUserId,
      quoteId: id,
      status: parsed.data.status,
    });
    return NextResponse.json(updated);
  } catch (error) {
    return handleRouteError(error, "salesQuote.status", "No se pudo cambiar el estado del presupuesto.");
  }
}
