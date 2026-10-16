import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { createActivity, listActivities } from "@/server/crm/service";

import { activitySchema, firstIssue, toDate } from "../schemas";

export async function GET(request: Request) {
  try {
    const ctx = await requireContext("crm.read");
    const params = new URL(request.url).searchParams;
    return NextResponse.json(await listActivities(ctx.company.id, {
      opportunityId: params.get("opportunityId") || undefined,
      customerId: params.get("customerId") || undefined,
      assignedUserId: params.get("mine") === "1" ? ctx.user.id : params.get("assigned") || undefined,
      includeDone: params.get("done") === "1",
    }));
  } catch (error) {
    return handleRouteError(error, "crm.activities.list");
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireContext("crm.write");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = activitySchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    const created = await createActivity({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id }, { ...parsed.data, dueAt: toDate(parsed.data.dueAt) });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "crm.activities.create");
  }
}
