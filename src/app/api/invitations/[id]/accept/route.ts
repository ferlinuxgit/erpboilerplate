import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { writeActiveTenant } from "@/lib/active-context";
import { getUserSession } from "@/lib/current-user";
import { handleRouteError, jsonError } from "@/lib/http";
import { acceptInvitation } from "@/server/team/service";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getUserSession();
    if (!session?.user) return jsonError(401, "Inicia sesión con el email invitado para aceptar la invitación.");
    const { id } = await params;
    const accepted = await acceptInvitation(session.user.id, id);
    if (!accepted) return jsonError(400, "La invitación no es válida, ha caducado o es para otro email.");
    // Al aceptar, el usuario pasa a trabajar en el espacio al que le invitaron.
    writeActiveTenant(await cookies(), accepted.tenantId);
    return NextResponse.json({ ok: true, tenantId: accepted.tenantId });
  } catch (error) {
    return handleRouteError(error, "invitation.accept", "No se pudo aceptar la invitación.");
  }
}
