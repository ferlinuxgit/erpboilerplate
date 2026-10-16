import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { moveOpportunity } from "@/server/crm/service";

import { firstIssue, moveSchema } from "../../../schemas";

/** Mueve la oportunidad a otra etapa/posición del embudo (arrastrar o «Mover a…»). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext("crm.write");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = moveSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await moveOpportunity({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id }, (await params).id, parsed.data));
  } catch (error) {
    return handleRouteError(error, "crm.opportunities.move");
  }
}
