import { NextResponse } from "next/server";

import { handleRouteError, jsonError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { deliverInvitation } from "@/server/team/invitations";
import { renewInvitation } from "@/server/team/service";

/** Renueva la caducidad y vuelve a enviar el correo (el enlace no cambia). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("team.write");
    const { id } = await params;
    const renewed = await renewInvitation(ctx.tenant.id, user.id, id);
    if (!renewed) return jsonError(404, "La invitación ya no existe o ya se aceptó.");
    const delivery = await deliverInvitation({ invitation: renewed, workspaceName: ctx.tenant.name, inviterName: user.name, request });
    return NextResponse.json({ id: renewed.id, expiresAt: renewed.expiresAt, ...delivery });
  } catch (error) {
    return handleRouteError(error, "invitation.resend", "No se pudo reenviar la invitación.");
  }
}
