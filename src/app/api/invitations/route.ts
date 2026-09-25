import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { assignableRoles, isAppRole } from "@/lib/rbac";
import { requirePermission } from "@/lib/rbac-server";
import { deliverInvitation } from "@/server/team/invitations";
import { createInvitation, listPendingInvitations } from "@/server/team/service";

export async function GET() {
  try {
    const { ctx } = await requirePermission("team.write");
    const invitations = await listPendingInvitations(ctx.tenant.id);
    return NextResponse.json({ invitations });
  } catch (error) {
    return handleRouteError(error, "invitation.list", "No se pudieron cargar las invitaciones.");
  }
}

export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("team.write");
    const payload = (await readJsonBody(request)) as { email?: unknown; role?: unknown } | null;
    if (!payload) return invalidJsonResponse();

    const email = typeof payload.email === "string" ? payload.email.trim() : "";
    const role = isAppRole(payload.role) ? payload.role : null;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !role) return jsonError(400, "Indica un email válido y un rol.");
    if (!assignableRoles(ctx.membership.role).includes(role)) return jsonError(403, "Solo un propietario puede invitar a otro propietario.");

    const created = await createInvitation(ctx.tenant.id, user.id, { email, role });
    // El correo es un extra: sin SMTP (o si falla) la invitación existe y el enlace se puede copiar.
    const delivery = await deliverInvitation({ invitation: created, workspaceName: ctx.tenant.name, inviterName: user.name, request });
    return NextResponse.json(
      { id: created.id, email: created.email, role: created.role, expiresAt: created.expiresAt, ...delivery },
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error, "invitation.create", "No se pudo crear la invitación.");
  }
}
