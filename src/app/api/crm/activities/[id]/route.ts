import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { deleteActivity, updateActivity } from "@/server/crm/service";

import { activityUpdateSchema, firstIssue, toDate } from "../../schemas";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireContext("crm.write");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = activityUpdateSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await updateActivity({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id }, (await params).id, { ...parsed.data, dueAt: toDate(parsed.data.dueAt) }));
  } catch (error) {
    return handleRouteError(error, "crm.activities.update");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireContext("crm.write");
    await deleteActivity({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id }, (await params).id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleRouteError(error, "crm.activities.delete");
  }
}
