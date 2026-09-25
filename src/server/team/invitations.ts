import { logger } from "@/lib/logger";
import { roleDescriptions, type AppRole } from "@/lib/rbac";
import { roleLabels, statusLabel } from "@/lib/status-labels";
import { isEmailDeliveryConfigured, sendEmail } from "@/server/email/send";
import { appBaseUrl, invitationEmail } from "@/server/email/templates";

export function invitationPath(token: string) {
  return `/invitations/${encodeURIComponent(token)}`;
}

export type InvitationDelivery = {
  /** Enlace para aceptar: siempre se devuelve para poder copiarlo y enviarlo por otro medio. */
  url: string;
  emailSent: boolean;
  /** Motivo en español cuando no se ha podido enviar el correo. */
  emailProblem: string | null;
};

/**
 * Envía el email de invitación. Nunca lanza: si el correo no está configurado o falla,
 * la invitación sigue siendo válida y el enlace se puede copiar desde el equipo.
 */
export async function deliverInvitation(input: {
  invitation: { id: string; email: string; role: AppRole; token: string; expiresAt: Date };
  workspaceName: string;
  inviterName: string | null;
  request?: Request;
}): Promise<InvitationDelivery> {
  const url = `${appBaseUrl(input.request)}${invitationPath(input.invitation.token)}`;
  if (!isEmailDeliveryConfigured()) {
    return { url, emailSent: false, emailProblem: "El envío de correo no está configurado: copia el enlace y compártelo tú." };
  }
  try {
    const message = invitationEmail({
      inviterName: input.inviterName,
      workspaceName: input.workspaceName,
      roleLabel: statusLabel(roleLabels, input.invitation.role),
      roleDescription: roleDescriptions[input.invitation.role],
      url,
      expiresAt: input.invitation.expiresAt,
    });
    await sendEmail({ to: input.invitation.email, ...message });
    return { url, emailSent: true, emailProblem: null };
  } catch (error) {
    logger.error({ err: error, invitationId: input.invitation.id }, "invitation.email_delivery_failed");
    return { url, emailSent: false, emailProblem: "No se pudo enviar el correo: copia el enlace y compártelo tú." };
  }
}
