import { NextResponse } from "next/server";
import { z } from "zod";

import { requireContext } from "@/lib/current-context";
import { ForbiddenError, handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { confirmPendingExpenseRun, discardPendingRun, getRecurringRunKind, recurringPermissions } from "@/server/recurring/service";

type Params = { params: Promise<{ id: string }> };

const confirmSchema = z.object({
  unitPrices: z.array(z.number().min(0, "El importe no puede ser negativo.").max(100_000_000)).max(50).optional(),
  supplierDocumentNumber: z.string().trim().max(80).optional().nullable(),
});

async function authorize(runId: string) {
  const ctx = await requireContext();
  const kind = await getRecurringRunKind(ctx.company.id, runId);
  if (!kind) return { ctx, kind: null };
  if (!can(ctx.membership.role, recurringPermissions(kind).write)) throw new ForbiddenError();
  return { ctx, kind };
}

/** Registra un gasto recurrente pendiente de revisar (con importes ajustados si hace falta). */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { ctx, kind } = await authorize(id);
    if (!kind) return jsonError(404, "Periodo no encontrado.");
    if (kind !== "EXPENSE") return jsonError(409, "Solo los gastos quedan pendientes de revisar.");
    const payload = (await readJsonBody(request)) ?? {};
    if (typeof payload !== "object") return invalidJsonResponse();
    const parsed = confirmSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Revisa los importes.");
    const result = await confirmPendingExpenseRun(
      { tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id, fiscalYearId: ctx.fiscalYear.id },
      id,
      parsed.data,
    );
    if (!result) return jsonError(404, "Periodo no encontrado.");
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "recurringRun.confirm", "No se pudo registrar el gasto.");
  }
}

/** Descarta un gasto pendiente (ese mes no hubo cargo). */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { ctx, kind } = await authorize(id);
    if (!kind) return jsonError(404, "Periodo no encontrado.");
    const result = await discardPendingRun({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id }, id);
    if (!result) return jsonError(404, "Periodo no encontrado.");
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "recurringRun.discard", "No se pudo descartar.");
  }
}
