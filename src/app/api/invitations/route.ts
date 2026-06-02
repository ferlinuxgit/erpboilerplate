import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { createInvitation } from "@/server/team/service";

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "team.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = (await readJsonBody(request)) as { email?: string; role?: "OWNER" | "ADMIN" | "MEMBER" } | null;
  if (!payload) return invalidJsonResponse();

  if (!payload.email?.trim() || !payload.role) return NextResponse.json({ message: "Email y rol son obligatorios." }, { status: 400 });
  const created = await createInvitation(ctx.tenant.id, session.user.id, { email: payload.email.trim(), role: payload.role });
  return NextResponse.json(created, { status: 201 });
}
