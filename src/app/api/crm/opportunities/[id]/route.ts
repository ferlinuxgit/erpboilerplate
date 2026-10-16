import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { deleteOpportunity, getOpportunity, updateOpportunity } from "@/server/crm/service";

import { firstIssue, opportunityUpdateSchema, toDate } from "../../schemas";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await requireContext("crm.read");
    const detail = await getOpportunity(ctx.company.id, (await params).id);
    if (!detail) return jsonError(404, "Oportunidad no encontrada.");
    return NextResponse.json(detail);
  } catch (error) {
    return handleRouteError(error, "crm.opportunities.get");
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireContext("crm.write");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = opportunityUpdateSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    const { contactEmail, expectedCloseDate, ...rest } = parsed.data;
    return NextResponse.json(await updateOpportunity(
      { tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id },
      (await params).id,
      { ...rest, ...(contactEmail !== undefined ? { contactEmail: contactEmail || null } : {}), expectedCloseDate: toDate(expectedCloseDate) },
    ));
  } catch (error) {
    return handleRouteError(error, "crm.opportunities.update");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireContext("crm.write");
    await deleteOpportunity({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id }, (await params).id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleRouteError(error, "crm.opportunities.delete");
  }
}
