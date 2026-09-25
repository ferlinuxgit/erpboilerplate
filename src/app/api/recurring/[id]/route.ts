import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { ForbiddenError, handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { recurringStatusSchema, recurringTemplateSchema } from "@/server/recurring/schemas";
import {
  deleteRecurringTemplate,
  getRecurringTemplateDetail,
  getRecurringTemplateKind,
  recurringPermissions,
  setRecurringTemplateStatus,
  updateRecurringTemplate,
} from "@/server/recurring/service";

type Params = { params: Promise<{ id: string }> };

async function authorize(id: string, access: "read" | "write") {
  const ctx = await requireContext();
  const kind = await getRecurringTemplateKind(ctx.company.id, id);
  if (!kind) return { ctx, kind: null };
  if (!can(ctx.membership.role, recurringPermissions(kind)[access])) throw new ForbiddenError();
  return { ctx, kind };
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { ctx, kind } = await authorize(id, "read");
    if (!kind) return jsonError(404, "Recurrencia no encontrada.");
    return NextResponse.json(await getRecurringTemplateDetail(ctx.company.id, id));
  } catch (error) {
    return handleRouteError(error, "recurringTemplate.get");
  }
}

/** Edita la plantilla completa. */
export async function PUT(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { ctx, kind } = await authorize(id, "write");
    if (!kind) return jsonError(404, "Recurrencia no encontrada.");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = recurringTemplateSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Revisa los datos de la recurrencia.");
    const updated = await updateRecurringTemplate({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id }, id, parsed.data);
    if (!updated) return jsonError(404, "Recurrencia no encontrada.");
    return NextResponse.json(updated);
  } catch (error) {
    return handleRouteError(error, "recurringTemplate.update", "No se pudo guardar la recurrencia.");
  }
}

/** Pausa o reanuda. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { ctx, kind } = await authorize(id, "write");
    if (!kind) return jsonError(404, "Recurrencia no encontrada.");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = recurringStatusSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, "Estado no válido.");
    const updated = await setRecurringTemplateStatus(
      { tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id },
      id,
      parsed.data.status,
      { timeZone: ctx.company.timezone || undefined },
    );
    if (!updated) return jsonError(404, "Recurrencia no encontrada.");
    return NextResponse.json(updated);
  } catch (error) {
    return handleRouteError(error, "recurringTemplate.status", "No se pudo cambiar el estado.");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { ctx, kind } = await authorize(id, "write");
    if (!kind) return jsonError(404, "Recurrencia no encontrada.");
    const deleted = await deleteRecurringTemplate({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id }, id);
    if (!deleted) return jsonError(404, "Recurrencia no encontrada.");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "recurringTemplate.delete", "No se pudo borrar la recurrencia.");
  }
}
