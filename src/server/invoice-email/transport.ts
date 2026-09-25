import nodemailer from "nodemailer";

import { getSmtpConfig } from "@/server/email/send";

/**
 * Transporte SMTP para emails con adjuntos (facturas y recordatorios). Reutiliza la
 * configuración de `@/server/email/send`; los tests inyectan un transporte simulado.
 */

export type MailAttachment = { filename: string; content: Buffer; contentType: string };

export type MailMessage = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
  attachments?: MailAttachment[];
};

export type MailTransport = {
  send(message: MailMessage): Promise<{ messageId: string | null }>;
};

export const SMTP_NOT_CONFIGURED_MESSAGE =
  "El correo saliente no está configurado. Configura el correo en Configuración (servidor SMTP: SMTP_HOST y SMTP_FROM_EMAIL) o pide ayuda al administrador.";

/** Transporte real, o null si el SMTP no está configurado (nunca se simula un envío en silencio). */
export function getMailTransport(env: Record<string, string | undefined> = process.env): MailTransport | null {
  const config = getSmtpConfig(env);
  if (!config) return null;
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.auth ? { auth: config.auth } : {}),
  });
  return {
    async send(message) {
      const result = await transporter.sendMail({
        from: config.from,
        to: message.to,
        cc: message.cc && message.cc.length > 0 ? message.cc : undefined,
        bcc: message.bcc && message.bcc.length > 0 ? message.bcc : undefined,
        replyTo: message.replyTo ?? undefined,
        subject: message.subject,
        html: message.html,
        text: message.text,
        attachments: message.attachments,
      });
      return { messageId: typeof result.messageId === "string" ? result.messageId : null };
    },
  };
}
