/**
 * WhatsApp Business (Cloud API de Meta). Los mensajes que inicia el negocio deben usar plantillas
 * aprobadas por Meta; aquí se envían con sus variables {{1}}, {{2}}… en orden.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

/** Teléfono en formato internacional sin «+» (34600111222). Null si no parece un móvil válido. */
export function normalizePhone(raw: string | null | undefined, defaultCountry = "34") {
  if (!raw) return null;
  let digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.length <= 10) digits = `${defaultCountry}${digits.replace(/^0+/, "")}`;
  digits = digits.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

export type WhatsAppCredentials = { phoneNumberId: string; accessToken: string };

async function call<T>(credentials: WhatsAppCredentials, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${GRAPH}${path}`, {
    method,
    headers: { Authorization: `Bearer ${credentials.accessToken}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(`WhatsApp: ${json.error?.message ?? `error ${response.status}`}`);
  return json;
}

/** Envía una plantilla aprobada con sus variables de texto. */
export function sendTemplate(credentials: WhatsAppCredentials, input: { to: string; template: string; language: string; parameters: string[] }) {
  return call<{ messages?: Array<{ id: string }> }>(credentials, "POST", `/${encodeURIComponent(credentials.phoneNumberId)}/messages`, {
    messaging_product: "whatsapp",
    to: input.to,
    type: "template",
    template: {
      name: input.template,
      language: { code: input.language },
      components: input.parameters.length > 0 ? [{ type: "body", parameters: input.parameters.map((text) => ({ type: "text", text: text.slice(0, 1000) })) }] : [],
    },
  });
}

/** Comprobar el número y el token. */
export function whatsappNumberCheck(credentials: WhatsAppCredentials) {
  return call<{ display_phone_number?: string; verified_name?: string }>(credentials, "GET", `/${encodeURIComponent(credentials.phoneNumberId)}?fields=display_phone_number,verified_name`);
}
