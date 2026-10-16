import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { ensureStages, saveStages } from "@/server/crm/service";

import { firstIssue, stagesSchema } from "../schemas";

export async function GET() {
  try {
    const ctx = await requireContext("crm.read");
    return NextResponse.json(await ensureStages(ctx.company.id));
  } catch (error) {
    return handleRouteError(error, "crm.stages.list");
  }
}

/** Guarda el embudo completo (orden, nombres, probabilidad y tipo de cada etapa). */
export async function PUT(request: Request) {
  try {
    const ctx = await requireContext("settings.manage");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = stagesSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await saveStages({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id }, parsed.data.stages));
  } catch (error) {
    return handleRouteError(error, "crm.stages.save");
  }
}
