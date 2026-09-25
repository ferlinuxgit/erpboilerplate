/**
 * Plantillas editables de los emails de facturas y recordatorios de cobro (sin dependencias de
 * servidor: el formulario de ajustes las usa para mostrar los textos por defecto y la vista previa).
 */

export type InvoiceEmailKind = "INVOICE" | "REMINDER";

export type EmailTemplateKey = "invoice" | "reminder1" | "reminder2" | "reminder3";

export type EmailTemplate = { subject: string; body: string };

export const EMAIL_TEMPLATE_VARIABLES = [
  { token: "{numero}", help: "número de factura" },
  { token: "{cliente}", help: "nombre del cliente" },
  { token: "{total}", help: "importe total" },
  { token: "{pendiente}", help: "importe pendiente de cobro" },
  { token: "{vencimiento}", help: "fecha de vencimiento" },
  { token: "{dias_vencida}", help: "días desde el vencimiento" },
  { token: "{empresa}", help: "nombre de tu empresa" },
] as const;

export const DEFAULT_EMAIL_TEMPLATES: Record<EmailTemplateKey, EmailTemplate> = {
  invoice: {
    subject: "Factura {numero} de {empresa}",
    body: [
      "Hola,",
      "",
      "Te enviamos adjunta la factura {numero} por importe de {total}, con vencimiento el {vencimiento}.",
      "",
      "Si tienes cualquier duda, responde a este correo.",
      "",
      "Un saludo,",
      "{empresa}",
    ].join("\n"),
  },
  reminder1: {
    subject: "Recordatorio: factura {numero} pendiente de pago",
    body: [
      "Hola,",
      "",
      "Te escribimos por si se ha pasado por alto: la factura {numero} venció el {vencimiento} y según nuestros registros quedan {pendiente} pendientes de pago.",
      "",
      "Te adjuntamos de nuevo la factura. Si ya has hecho el pago, ignora este mensaje y gracias.",
      "",
      "Un saludo,",
      "{empresa}",
    ].join("\n"),
  },
  reminder2: {
    subject: "Segundo aviso: factura {numero} vencida hace {dias_vencida} días",
    body: [
      "Hola,",
      "",
      "La factura {numero} venció el {vencimiento} y siguen pendientes {pendiente}. Ya te enviamos un recordatorio y no hemos recibido el pago.",
      "",
      "Te pedimos que lo realices en los próximos días o que nos indiques cuándo podrás hacerlo.",
      "",
      "Un saludo,",
      "{empresa}",
    ].join("\n"),
  },
  reminder3: {
    subject: "Último aviso: factura {numero} pendiente de pago",
    body: [
      "Hola,",
      "",
      "Pese a nuestros avisos anteriores, la factura {numero} (vencida el {vencimiento}) sigue con {pendiente} pendientes.",
      "",
      "Si no recibimos el pago o una propuesta de fecha en los próximos 7 días, tendremos que iniciar otras gestiones de cobro.",
      "",
      "Un saludo,",
      "{empresa}",
    ].join("\n"),
  },
};

export const emailTemplateLabels: Record<EmailTemplateKey, string> = {
  invoice: "Envío de factura",
  reminder1: "1.er recordatorio (amable)",
  reminder2: "2.º recordatorio (firme)",
  reminder3: "Último aviso",
};

export function templateKeyFor(kind: InvoiceEmailKind, reminderLevel?: number | null): EmailTemplateKey {
  if (kind === "INVOICE") return "invoice";
  if (reminderLevel === 2) return "reminder2";
  if (reminderLevel === 3) return "reminder3";
  return "reminder1";
}

export type EmailTemplateValues = {
  numero: string;
  cliente: string;
  total: string;
  pendiente: string;
  vencimiento: string;
  dias_vencida: string;
  empresa: string;
};

/** Sustituye las variables conocidas; las llaves desconocidas se dejan tal cual para que se vean. */
export function renderEmailTemplate(text: string, values: EmailTemplateValues) {
  const lookup: Record<string, string> = values;
  return text.replace(/\{([a-z_]+)\}/g, (match, name: string) => lookup[name] ?? match);
}

/** El asunto va en una sola línea (evita inyección de cabeceras). */
export function singleLineSubject(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, 250);
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

/** Cuerpo en texto llano → HTML sencillo (párrafos y saltos de línea), siempre escapado. */
export function plainTextToHtml(body: string) {
  return body
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

const EMAIL_PATTERN = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export function isValidEmail(value: string) {
  return EMAIL_PATTERN.test(value.trim()) && value.trim().length <= 254;
}

/** "a@x.es, b@y.es; c@z.es" → lista limpia sin duplicados. */
export function parseEmailList(value: string | string[] | null | undefined) {
  const raw = Array.isArray(value) ? value.join(",") : (value ?? "");
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const part of raw.split(/[,;\s]+/)) {
    const email = part.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push(email);
  }
  return emails;
}
