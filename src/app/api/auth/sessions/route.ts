import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { handleRouteError, jsonError, UnauthorizedError } from "@/lib/http";
import { listUserSessions, revokeOtherSessions } from "@/server/auth/account-security";

/** Mis sesiones abiertas en navegadores. */
export async function GET() {
  try {
    const current = await getUserSession();
    if (!current?.user) throw new UnauthorizedError();
    return NextResponse.json(await listUserSessions(current.user.id));
  } catch (error) {
    return handleRouteError(error, "auth.sessions.list");
  }
}

/** Cierra todas mis sesiones menos esta. */
export async function DELETE() {
  try {
    const current = await getUserSession();
    if (!current?.user) throw new UnauthorizedError();
    if (current.grant) return jsonError(403, "Esto solo se puede hacer desde la aplicación.");
    return NextResponse.json({ revoked: await revokeOtherSessions(current.user.id) });
  } catch (error) {
    return handleRouteError(error, "auth.sessions.revoke");
  }
}
