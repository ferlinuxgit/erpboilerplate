import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { createInvitation } from "@/server/team/service";
import { escapeEmailHtml, isEmailDeliveryConfigured, sendEmail } from "@/server/email/send";

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "team.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  if (process.env.NODE_ENV === "production" && !isEmailDeliveryConfigured()) {
    return NextResponse.json({ message: "Configura el servicio de correo antes de enviar invitaciones." }, { status: 503 });
  }
  const payload = (await readJsonBody(request)) as { email?: string; role?: "OWNER" | "ADMIN" | "MEMBER" } | null;
  if (!payload) return invalidJsonResponse();

  if (!payload.email?.trim() || !payload.role) return NextResponse.json({ message: "Email y rol son obligatorios." }, { status: 400 });
  if (payload.role === "OWNER" && ctx.membership.role !== "OWNER") return NextResponse.json({ message: "Solo un propietario puede invitar a otro propietario." }, { status: 403 });
  try {
    const created = await createInvitation(ctx.tenant.id, session.user.id, { email: payload.email.trim(), role: payload.role });
    const origin = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const safeTenantName = escapeEmailHtml(ctx.tenant.name);
    const invitationUrl = `${origin}/invitations/${encodeURIComponent(created.token)}`;
    await sendEmail({ to: created.email, subject: `Invitación a ${ctx.tenant.name}`, html: `<p>Has sido invitado a ${safeTenantName}.</p><p><a href="${escapeEmailHtml(invitationUrl)}">Aceptar invitación</a></p>` });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "No se pudo crear la invitación." }, { status: 400 });
  }
}
