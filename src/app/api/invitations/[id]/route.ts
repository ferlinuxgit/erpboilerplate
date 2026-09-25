import { NextResponse } from "next/server";

import { handleRouteError, jsonError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { cancelInvitation } from "@/server/team/service";

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("team.write");
    const { id } = await params;
    const removed = await cancelInvitation(ctx.tenant.id, user.id, id);
    return removed ? NextResponse.json({ ok: true }) : jsonError(404, "La invitación ya no existe o ya se aceptó.");
  } catch (error) {
    return handleRouteError(error, "invitation.cancel", "No se pudo cancelar la invitación.");
  }
}
