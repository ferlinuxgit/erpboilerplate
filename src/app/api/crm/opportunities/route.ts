import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { CRM_STAGE_KINDS, type CrmStageKind } from "@/modules/crm/model";
import { createOpportunity, listOpportunities } from "@/server/crm/service";

import { firstIssue, opportunitySchema, toDate } from "../schemas";

export async function GET(request: Request) {
  try {
    const ctx = await requireContext("crm.read");
    const params = new URL(request.url).searchParams;
    const status = params.get("status");
    return NextResponse.json(await listOpportunities(ctx.company.id, {
      status: CRM_STAGE_KINDS.includes(status as CrmStageKind) ? status as CrmStageKind : "ALL",
      ownerUserId: params.get("owner") || undefined,
      customerId: params.get("customerId") || undefined,
      q: params.get("q") || undefined,
    }));
  } catch (error) {
    return handleRouteError(error, "crm.opportunities.list");
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireContext("crm.write");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = opportunitySchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    const created = await createOpportunity(
      { tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id },
      { ...parsed.data, contactEmail: parsed.data.contactEmail || null, expectedCloseDate: toDate(parsed.data.expectedCloseDate) },
    );
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "crm.opportunities.create");
  }
}
