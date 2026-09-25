import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { rulePayloadSchema } from "@/lib/bank-import/rule-schema";
import { deleteReconciliationRule, updateReconciliationRule } from "@/server/treasury/rules";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("treasury.write", "Tu rol no permite gestionar reglas de conciliación.");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = rulePayloadSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: "Revisa los datos de la regla." }, { status: 400 });
    const { id } = await params;
    const updated = await updateReconciliationRule({ companyId: ctx.company.id, tenantId: ctx.tenant.id, actorUserId: user.id }, id, parsed.data);
    if (!updated) return NextResponse.json({ message: "Regla no encontrada." }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return handleRouteError(error, "treasury.rules.update", "No se pudo guardar la regla.");
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("treasury.write", "Tu rol no permite gestionar reglas de conciliación.");
    const { id } = await params;
    const deleted = await deleteReconciliationRule({ companyId: ctx.company.id, tenantId: ctx.tenant.id, actorUserId: user.id }, id);
    if (!deleted) return NextResponse.json({ message: "Regla no encontrada." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "treasury.rules.delete", "No se pudo borrar la regla.");
  }
}
