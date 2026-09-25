import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { rulePayloadSchema } from "@/lib/bank-import/rule-schema";
import { createReconciliationRule, listReconciliationRules } from "@/server/treasury/rules";

export async function GET() {
  try {
    const { ctx } = await requirePermission("treasury.read");
    return NextResponse.json(await listReconciliationRules(ctx.company.id));
  } catch (error) {
    return handleRouteError(error, "treasury.rules.list");
  }
}

export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("treasury.write", "Tu rol no permite gestionar reglas de conciliación.");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = rulePayloadSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: "Revisa los datos de la regla." }, { status: 400 });
    const created = await createReconciliationRule({ companyId: ctx.company.id, tenantId: ctx.tenant.id, actorUserId: user.id }, parsed.data);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "treasury.rules.create", "No se pudo guardar la regla.");
  }
}
