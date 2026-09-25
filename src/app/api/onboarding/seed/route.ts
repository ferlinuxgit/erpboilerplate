import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { onboardingCompletePayloadSchema } from "@/lib/onboarding";
import { assignableRoles } from "@/lib/rbac";
import { completeOnboarding } from "@/server/onboarding/service";
import { deliverInvitation, type InvitationDelivery } from "@/server/team/invitations";
import { createInvitation } from "@/server/team/service";

import { requireOnboardingActor } from "@/server/onboarding/actor";

/**
 * Finaliza la puesta en marcha: guarda los datos, aplica la plantilla contable, la serie y
 * la cuenta bancaria, y crea la invitación (con enlace copiable aunque no haya correo).
 */
export async function POST(request: Request) {
  try {
    const { actor, ctx, user } = await requireOnboardingActor();
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = onboardingCompletePayloadSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Revisa los datos marcados.");

    const { invite, ...fields } = parsed.data;
    const saved = await completeOnboarding(actor, fields);

    let invitation: (InvitationDelivery & { email: string; role: string }) | null = null;
    let invitationError: string | null = null;
    if (invite) {
      if (!assignableRoles(ctx.membership.role).includes(invite.role)) {
        invitationError = "No puedes invitar con ese rol.";
      } else {
        try {
          const created = await createInvitation(ctx.tenant.id, user.id, invite);
          const workspaceName = fields.legalName?.trim() || ctx.tenant.name;
          const delivery = await deliverInvitation({ invitation: created, workspaceName, inviterName: user.name, request });
          invitation = { ...delivery, email: created.email, role: created.role };
        } catch (error) {
          // La empresa ya está configurada: el fallo de la invitación no deshace lo demás.
          invitationError = error instanceof Error && "status" in error ? error.message : "No se pudo crear la invitación. Puedes repetirla desde Configuración › Equipo.";
        }
      }
    }

    return NextResponse.json({ ok: true, ...saved, invitation, invitationError }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "onboarding.complete", "No se pudo completar la configuración.");
  }
}
