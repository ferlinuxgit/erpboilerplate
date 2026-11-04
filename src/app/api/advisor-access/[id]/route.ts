import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { deleteAdvisorAccess, updateAdvisorAccess } from "@/server/advisor/admin";

import { firstIssue, updateAdvisorAccessSchema } from "../schemas";

/** Revocar, reactivar, regenerar la contraseña o cambiar datos y secciones de un acceso. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext("team.write");
    const body = await readJsonBody(request);
    if (!body) return invalidJsonResponse();
    const parsed = updateAdvisorAccessSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ message: firstIssue(parsed.error) }, { status: 400 });
    const { id } = await params;
    const result = await updateAdvisorAccess({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id }, id, parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "advisor-access.update", "No se pudo actualizar el acceso del asesor.");
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext("team.write");
    const { id } = await params;
    await deleteAdvisorAccess({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id }, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "advisor-access.delete", "No se pudo eliminar el acceso del asesor.");
  }
}
