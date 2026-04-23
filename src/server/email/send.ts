import { Resend } from "resend";

const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;

export async function sendEmail(input: { to: string; subject: string; html: string }) {
  if (!resend) return { id: "noop", skipped: true };
  return resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? "ERP <noreply@example.com>",
    to: input.to,
    subject: input.subject,
    html: input.html,
  });
}
