/**
 * Reglas del buzón de facturas (sin red ni base de datos): qué remitentes se aceptan y qué adjuntos
 * de un correo son facturas que leer.
 */

export const MAIL_INBOX_MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
export const MAIL_INBOX_MAX_ATTACHMENTS_PER_MESSAGE = 10;
/** Las imágenes más pequeñas suelen ser logos o firmas incrustadas, no facturas. */
export const MAIL_INBOX_MIN_IMAGE_BYTES = 15 * 1024;

const INVOICE_TYPES: Record<string, string> = {
  "application/pdf": "application/pdf",
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/webp": "image/webp",
};
const EXTENSION_TYPES: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** Lista de remitentes permitidos: direcciones completas o dominios ("@empresa.com" o "empresa.com"). */
export function parseAllowedSenders(raw: string) {
  return [...new Set(raw
    .split(/[\s,;]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => (entry.includes("@") ? entry : `@${entry}`)))];
}

export function isAllowedSender(fromAddress: string | null | undefined, allowed: readonly string[]) {
  const address = fromAddress?.trim().toLowerCase();
  if (!address || !address.includes("@") || allowed.length === 0) return false;
  const domain = address.slice(address.lastIndexOf("@"));
  return allowed.some((entry) => (entry.startsWith("@") ? entry === domain : entry === address));
}

export type MailAttachmentInput = {
  filename?: string | null;
  contentType?: string | null;
  size?: number;
  content: Buffer;
};

export type InvoiceAttachment = { fileName: string; contentType: string; content: Buffer };

/** Tipo del adjunto por su MIME o, si viene genérico (application/octet-stream), por su extensión. */
export function invoiceContentType(attachment: Pick<MailAttachmentInput, "filename" | "contentType">) {
  const declared = attachment.contentType?.toLowerCase().split(";")[0]?.trim() ?? "";
  if (INVOICE_TYPES[declared]) return INVOICE_TYPES[declared];
  const extension = attachment.filename?.toLowerCase().split(".").pop() ?? "";
  return EXTENSION_TYPES[extension] ?? null;
}

/**
 * Adjuntos que son facturas: PDF e imágenes (PNG, JPG, WEBP) de hasta 12 MB. Se descartan las
 * imágenes diminutas (logos, firmas) y se toman como mucho 10 por correo. Devuelve también los
 * descartados con el motivo, para informar.
 */
export function selectInvoiceAttachments(attachments: readonly MailAttachmentInput[]) {
  const accepted: InvoiceAttachment[] = [];
  const skipped: Array<{ fileName: string; reason: string }> = [];
  attachments.forEach((attachment, index) => {
    const fileName = attachment.filename?.trim() || `adjunto-${index + 1}`;
    const contentType = invoiceContentType(attachment);
    const size = attachment.size ?? attachment.content.byteLength;
    if (!contentType) skipped.push({ fileName, reason: "no es PDF ni imagen" });
    else if (size > MAIL_INBOX_MAX_ATTACHMENT_BYTES) skipped.push({ fileName, reason: "supera 12 MB" });
    else if (contentType !== "application/pdf" && size < MAIL_INBOX_MIN_IMAGE_BYTES) skipped.push({ fileName, reason: "imagen demasiado pequeña (logo o firma)" });
    else if (accepted.length >= MAIL_INBOX_MAX_ATTACHMENTS_PER_MESSAGE) skipped.push({ fileName, reason: "más de 10 adjuntos en el correo" });
    else accepted.push({ fileName, contentType, content: attachment.content });
  });
  return { accepted, skipped };
}

/** Mensaje de error comprensible para la configuración (sin detalles internos). */
export function mailInboxErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const details = error && typeof error === "object" ? error as { authenticationFailed?: boolean; code?: string; responseText?: string; serverResponseCode?: string } : {};
  // Primero los fallos de red (el nombre del servidor no debe confundirse con un error de credenciales).
  if (details.code === "ENOTFOUND" || details.code === "EAI_AGAIN") return "No se encuentra el servidor IMAP: revisa la dirección.";
  if (details.code === "ECONNREFUSED" || details.code === "ETIMEDOUT" || details.code === "ECONNRESET" || details.code === "NoConnection" || /timeout|timed out/i.test(raw)) {
    return "No se pudo conectar con el servidor IMAP: revisa el servidor, el puerto y el cifrado (SSL/TLS).";
  }
  if (details.authenticationFailed || details.serverResponseCode === "AUTHENTICATIONFAILED" || /authenticat|login failed|invalid credentials/i.test(details.responseText ?? "")) {
    return "El servidor rechazó el usuario o la contraseña. En Gmail u Outlook usa una contraseña de aplicación.";
  }
  if (/mailbox|folder|nonexistent|doesn't exist/i.test(`${details.responseText ?? ""} ${raw}`)) return "No existe la carpeta indicada en el buzón.";
  return `No se pudo leer el buzón: ${raw.slice(0, 200)}`;
}
