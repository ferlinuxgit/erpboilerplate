import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { logger } from "@/lib/logger";
import { requirePermission } from "@/lib/rbac-server";
import { createInvitation } from "@/server/team/service";
import { escapeEmailHtml, isEmailDeliveryConfigured, sendEmail } from "@/server/email/send";

const roles = ["OWNER", "ADMIN", "MEMBER"] as const;

export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("team.write");
    if (process.env.NODE_ENV === "production" && !isEmailDeliveryConfigured()) {
      return jsonError(503, "Configura el servicio de correo antes de enviar invitaciones.");
    }
    const payload = (await readJsonBody(request)) as { email?: unknown; role?: unknown } | null;
    if (!payload) return invalidJsonResponse();

    const email = typeof payload.email === "string" ? payload.email.trim() : "";
    const role = roles.find((entry) => entry === payload.role);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !role) return jsonError(400, "Indica un email válido y un rol.");
    if (role === "OWNER" && ctx.membership.role !== "OWNER") return jsonError(403, "Solo un propietario puede invitar a otro propietario.");

    const created = await createInvitation(ctx.tenant.id, user.id, { email, role });
    const origin = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const safeTenantName = escapeEmailHtml(ctx.tenant.name);
    const invitationUrl = `${origin}/invitations/${encodeURIComponent(created.token)}`;
    try {
      await sendEmail({ to: created.email, subject: `Invitación a ${ctx.tenant.name}`, html: `<p>Has sido invitado a ${safeTenantName}.</p><p><a href="${escapeEmailHtml(invitationUrl)}">Aceptar invitación</a></p>` });
    } catch (error) {
      logger.error({ err: error, invitationId: created.id }, "invitation.email_delivery_failed");
      return jsonError(502, "La invitación se ha creado, pero no se pudo enviar el correo. Revisa la configuración SMTP.");
    }
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "invitation.create", "No se pudo crear la invitación.");
  }
}
