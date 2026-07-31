import nodemailer from "nodemailer";

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  auth?: {
    user: string;
    pass: string;
  };
};

export function getSmtpConfig(env: Record<string, string | undefined> = process.env): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim();
  const from = env.SMTP_FROM_EMAIL?.trim();
  const user = env.SMTP_USER?.trim();
  const password = env.SMTP_PASSWORD?.trim();
  const secureValue = env.SMTP_SECURE?.trim().toLowerCase();
  const port = Number(env.SMTP_PORT?.trim() || (secureValue === "true" ? "465" : "587"));

  if (!host || !from || !Number.isInteger(port) || port < 1 || port > 65_535) return null;
  if (secureValue && secureValue !== "true" && secureValue !== "false") return null;
  if (Boolean(user) !== Boolean(password)) return null;

  return {
    host,
    port,
    secure: secureValue ? secureValue === "true" : port === 465,
    from,
    ...(user && password ? { auth: { user, pass: password } } : {}),
  };
}

export function isEmailDeliveryConfigured() {
  return Boolean(getSmtpConfig());
}

export async function sendEmail(input: { to: string; subject: string; html: string }) {
  const config = getSmtpConfig();
  if (!config) {
    if (process.env.NODE_ENV === "production") throw new Error("El servicio de correo no está configurado.");
    return { id: "noop", skipped: true };
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.auth ? { auth: config.auth } : {}),
  });
  const result = await transporter.sendMail({
    from: config.from,
    to: input.to,
    subject: input.subject,
    html: input.html,
  });
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
