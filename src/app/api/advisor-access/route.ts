import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { createAdvisorAccess } from "@/server/advisor/admin";

import { createAdvisorAccessSchema, firstIssue } from "./schemas";

/** Crea un acceso para el asesor. Devuelve la contraseña en claro una sola vez. */
export async function POST(request: Request) {
  try {
    const ctx = await requireContext("team.write");
    const body = await readJsonBody(request);
    if (!body) return invalidJsonResponse();
    const parsed = createAdvisorAccessSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ message: firstIssue(parsed.error) }, { status: 400 });
    const created = await createAdvisorAccess({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id }, parsed.data);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "advisor-access.create", "No se pudo crear el acceso del asesor.");
  }
}
