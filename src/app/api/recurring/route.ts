import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { ForbiddenError, handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { recurringTemplateSchema } from "@/server/recurring/schemas";
import { createRecurringTemplate, listRecurringTemplates, recurringPermissions } from "@/server/recurring/service";

export async function GET(request: Request) {
  try {
    const ctx = await requireContext();
    const kind = new URL(request.url).searchParams.get("kind") === "EXPENSE" ? "EXPENSE" : "SALES_INVOICE";
    if (!can(ctx.membership.role, recurringPermissions(kind).read)) throw new ForbiddenError();
    return NextResponse.json(await listRecurringTemplates(ctx.company.id, kind));
  } catch (error) {
    return handleRouteError(error, "recurringTemplate.list");
  }
}

/** Crea una plantilla recurrente de factura o de gasto. */
export async function POST(request: Request) {
  try {
    const ctx = await requireContext();
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = recurringTemplateSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Revisa los datos de la recurrencia.");
    if (!can(ctx.membership.role, recurringPermissions(parsed.data.kind).write)) {
      throw new ForbiddenError(parsed.data.kind === "EXPENSE" ? "Tu rol no permite registrar gastos." : "Tu rol no permite crear facturas.");
    }
    const created = await createRecurringTemplate({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id }, parsed.data);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "recurringTemplate.create", "No se pudo guardar la recurrencia.");
  }
}
