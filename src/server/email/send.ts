import { Resend } from "resend";

const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;

export function isEmailDeliveryConfigured() {
  return Boolean(resend);
}

export async function sendEmail(input: { to: string; subject: string; html: string }) {
  if (!resend) {
    if (process.env.NODE_ENV === "production") throw new Error("El servicio de correo no está configurado.");
    return { id: "noop", skipped: true };
  }
  const result = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? "ERP <noreply@example.com>",
    to: input.to,
    subject: input.subject,
    html: input.html,
  });
  if (result.error) throw new Error(`No se pudo enviar el correo: ${result.error.message}`);
  return result;
}

export function escapeEmailHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}
