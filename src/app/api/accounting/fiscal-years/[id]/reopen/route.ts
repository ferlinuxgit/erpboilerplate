import { NextResponse } from "next/server";
import { z } from "zod";

import { ForbiddenError, handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { reopenFiscalYear } from "@/server/accounting/fiscal-years";

type RouteContext = { params: Promise<{ id: string }> };

const payloadSchema = z.object({
  confirm: z.literal(true),
  reason: z.string().trim().min(5).max(500),
});

/**
 * Reabre un ejercicio cerrado (solo el propietario): anula con asientos inversos la apertura del
 * ejercicio siguiente y el cierre/regularización del ejercicio, y lo deja abierto. Queda auditado.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { ctx, user } = await requirePermission("accounting.write", "Sin permisos para reabrir el ejercicio.");
    if (ctx.membership.role !== "OWNER") throw new ForbiddenError("Solo el propietario puede reabrir un ejercicio cerrado.");

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body === null) return invalidJsonResponse();
    const parsed = payloadSchema.safeParse(body);
    if (!parsed.success) {
      const confirmIssue = parsed.error.issues.some((issue) => issue.path[0] === "confirm");
      return jsonError(
        400,
        confirmIssue
          ? "Debes confirmar la reapertura del ejercicio."
          : "Indica el motivo de la reapertura (entre 5 y 500 caracteres).",
      );
    }

    const result = await reopenFiscalYear({
      companyId: ctx.company.id,
      tenantId: ctx.tenant.id,
      actorUserId: user.id,
      fiscalYearId: id,
      reason: parsed.data.reason,
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "accounting.fiscal-years.reopen", "No se pudo reabrir el ejercicio. Inténtalo de nuevo.");
  }
}
