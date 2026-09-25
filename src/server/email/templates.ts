import { escapeEmailHtml } from "@/server/email/send";

/**
 * Plantillas de los correos de acceso (verificación, contraseña e invitaciones).
 * Texto en español llano: quien las recibe puede no conocer el producto.
 */

export type EmailMessage = { subject: string; html: string };

const APP_NAME = "ERP Suite";

function singleLine(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function layout(paragraphs: string[], action: { label: string; url: string }, footer: string) {
  const body = paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("");
  const url = escapeEmailHtml(action.url);
  return `${body}<p><a href="${url}"><strong>${escapeEmailHtml(action.label)}</strong></a></p><p style="color:#555;font-size:12px">Si el botón no funciona, copia este enlace en el navegador:<br>${url}</p><p style="color:#555;font-size:12px">${footer}</p>`;
}

/** Base pública de los enlaces: `APP_URL` o, en su defecto, el origen de la petición. */
export function appBaseUrl(request?: Request) {
  const fromEnv = process.env.APP_URL?.trim();
  const origin = fromEnv || (request ? new URL(request.url).origin : "http://localhost:3000");
  return origin.replace(/\/$/, "");
}

export function verificationEmail(input: { name: string; url: string }): EmailMessage {
  return {
    subject: `Confirma tu correo para empezar a usar ${APP_NAME}`,
    html: layout(
      [`Hola ${escapeEmailHtml(input.name)},`, "Confirma tu dirección de correo para activar la cuenta. El enlace caduca en 24 horas."],
      { label: "Confirmar mi correo", url: input.url },
      "Si no has creado ninguna cuenta, ignora este mensaje.",
    ),
  };
}

export function passwordResetEmail(input: { name: string; url: string; expiresInMinutes: number }): EmailMessage {
  return {
    subject: `Restablece tu contraseña de ${APP_NAME}`,
    html: layout(
      [
        `Hola ${escapeEmailHtml(input.name)},`,
        `Hemos recibido una solicitud para cambiar tu contraseña. El enlace solo sirve una vez y caduca en ${input.expiresInMinutes} minutos.`,
      ],
      { label: "Elegir una contraseña nueva", url: input.url },
      "Si no lo has pedido tú, ignora este mensaje: tu contraseña actual sigue funcionando.",
    ),
  };
}

export function invitationEmail(input: {
  inviterName: string | null;
  workspaceName: string;
  roleLabel: string;
  roleDescription: string;
  url: string;
  expiresAt: Date;
}): EmailMessage {
  const workspace = escapeEmailHtml(input.workspaceName);
  const inviter = input.inviterName ? escapeEmailHtml(input.inviterName) : null;
  const expires = new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "Europe/Madrid" }).format(input.expiresAt);
  return {
    subject: input.inviterName
      ? `${singleLine(input.inviterName)} te invita a ${singleLine(input.workspaceName)} en ${APP_NAME}`
      : `Invitación a ${singleLine(input.workspaceName)} en ${APP_NAME}`,
    html: layout(
      [
        inviter ? `<strong>${inviter}</strong> te ha invitado a trabajar en <strong>${workspace}</strong>.` : `Te han invitado a trabajar en <strong>${workspace}</strong>.`,
        `Tu rol será <strong>${escapeEmailHtml(input.roleLabel)}</strong>: ${escapeEmailHtml(input.roleDescription)}`,
        `Si aún no tienes cuenta, podrás crearla desde el enlace con este mismo email. La invitación caduca el ${expires}.`,
      ],
      { label: "Ver la invitación", url: input.url },
      "Si no esperabas esta invitación, puedes ignorar este mensaje.",
    ),
  };
}
