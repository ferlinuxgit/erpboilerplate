import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { removeTeamMember, updateTeamMemberRole } from "@/server/team/service";

const roles = ["OWNER", "ADMIN", "MEMBER"] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx, user } = await requirePermission("team.write");
    const payload = (await readJsonBody(request)) as { role?: unknown } | null;
    if (!payload) return invalidJsonResponse();
    const role = roles.find((entry) => entry === payload.role);
    if (!role) return jsonError(400, "Rol inválido.");
    const { id } = await params;
    const updated = await updateTeamMemberRole({
      tenantId: ctx.tenant.id,
      membershipId: id,
      actorUserId: user.id,
      actorRole: ctx.membership.role,
      role,
    });
    return updated ? NextResponse.json(updated) : jsonError(404, "Miembro no encontrado.");
  } catch (error) {
    return handleRouteError(error, "team.member.update", "No se pudo cambiar el rol.");
  }
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx, user } = await requirePermission("team.write");
    const { id } = await params;
    const removed = await removeTeamMember({
      tenantId: ctx.tenant.id,
      membershipId: id,
      actorUserId: user.id,
      actorRole: ctx.membership.role,
    });
    return removed ? NextResponse.json({ ok: true }) : jsonError(404, "Miembro no encontrado.");
  } catch (error) {
    return handleRouteError(error, "team.member.remove", "No se pudo eliminar el miembro.");
  }
}
