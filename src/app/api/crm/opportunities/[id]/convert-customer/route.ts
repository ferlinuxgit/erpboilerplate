import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { ForbiddenError, handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { convertOpportunityContact } from "@/server/crm/service";
import { createCustomerSchema } from "@/server/schemas/forms";

/** Da de alta como cliente al contacto (prospecto) de la oportunidad. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext("crm.write");
    if (!can(ctx.membership.role, "customer.create")) throw new ForbiddenError("No tienes permisos para crear clientes.");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = createCustomerSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Datos inválidos.");
    return NextResponse.json(await convertOpportunityContact({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id }, (await params).id, parsed.data), { status: 201 });
  } catch (error) {
    return handleRouteError(error, "crm.opportunities.convert");
  }
}
