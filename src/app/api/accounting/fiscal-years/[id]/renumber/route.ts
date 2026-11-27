import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { previewEntryRenumbering, renumberFiscalYearEntries } from "@/server/accounting/renumber";

type RouteContext = { params: Promise<{ id: string }> };

/** Vista previa de la renumeración de asientos por fecha: cuántos cambiarían de número (no cambia nada). */
export async function GET(_: Request, { params }: RouteContext) {
  try {
    const { ctx } = await requirePermission("accounting.write", "Sin permisos para renumerar asientos.");
    const { id } = await params;
    return NextResponse.json(await previewEntryRenumbering(ctx.company.id, id));
  } catch (error) {
    return handleRouteError(error, "accounting.fiscal-years.renumber.preview", "No se pudo calcular la renumeración.");
  }
}

const payloadSchema = z.object({ confirm: z.literal(true) });

/**
 * Renumera por fecha los asientos del ejercicio (solo ejercicios abiertos y sin libros presentados a
 * legalizar). Exige `confirm: true`. Queda en la auditoría con el mapa número antiguo → nuevo.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { ctx, user } = await requirePermission("accounting.write", "Sin permisos para renumerar asientos.");
    const { id } = await params;
    const body = await readJsonBody(request);
    if (body === null) return invalidJsonResponse();
    if (!payloadSchema.safeParse(body).success) return jsonError(400, "Debes confirmar la renumeración de los asientos.");
    return NextResponse.json(await renumberFiscalYearEntries({ companyId: ctx.company.id, tenantId: ctx.tenant.id, actorUserId: user.id, fiscalYearId: id }));
  } catch (error) {
    return handleRouteError(error, "accounting.fiscal-years.renumber", "No se pudieron renumerar los asientos. No se ha cambiado nada.");
  }
}
