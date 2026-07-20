import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { requireContext } from "@/lib/current-context";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { removeTeamMember, updateTeamMemberRole } from "@/server/team/service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getUserSession();
  if (!session?.user)
    return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await requireContext();
  if (!can(ctx.membership.role, "team.write"))
    return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = (await readJsonBody(request)) as {
    role?: "OWNER" | "ADMIN" | "MEMBER";
  } | null;
  if (!payload) return invalidJsonResponse();
  if (!payload.role || !["OWNER", "ADMIN", "MEMBER"].includes(payload.role))
    return NextResponse.json({ message: "Rol inválido." }, { status: 400 });
  try {
    const { id } = await params;
    const updated = await updateTeamMemberRole({
      tenantId: ctx.tenant.id,
      membershipId: id,
      actorUserId: session.user.id,
      actorRole: ctx.membership.role,
      role: payload.role,
    });
    return updated
      ? NextResponse.json(updated)
      : NextResponse.json(
          { message: "Miembro no encontrado." },
          { status: 404 },
        );
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "No se pudo cambiar el rol.",
      },
      { status: 409 },
    );
  }
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getUserSession();
  if (!session?.user)
    return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await requireContext();
  if (!can(ctx.membership.role, "team.write"))
    return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  try {
    const { id } = await params;
    const removed = await removeTeamMember({
      tenantId: ctx.tenant.id,
      membershipId: id,
      actorUserId: session.user.id,
      actorRole: ctx.membership.role,
    });
    return removed
      ? NextResponse.json({ ok: true })
      : NextResponse.json(
          { message: "Miembro no encontrado." },
          { status: 404 },
        );
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "No se pudo eliminar el miembro.",
      },
      { status: 409 },
    );
  }
}
