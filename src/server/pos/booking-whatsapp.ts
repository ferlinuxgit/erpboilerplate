import { loadIntegration } from "@/server/integrations/service";
import { normalizePhone, sendTemplate } from "@/server/integrations/whatsapp";

/**
 * Avisos de reservas por WhatsApp (plantillas aprobadas por Meta). Solo a quien lo aceptó en el
 * formulario y si el restaurante tiene WhatsApp activo y la plantilla de ese aviso configurada.
 * Variables de todas las plantillas: {{1}} nombre, {{2}} restaurante, {{3}} día y hora, {{4}} personas, {{5}} enlace.
 */

export type WhatsAppNotice = "CONFIRMED" | "PENDING" | "REMINDER" | "CANCELLED" | "WAITLIST";

const TEMPLATE_KEY: Record<WhatsAppNotice, string> = {
  CONFIRMED: "templateConfirmed",
  PENDING: "templatePending",
  REMINDER: "templateReminder",
  CANCELLED: "templateCancelled",
  WAITLIST: "templateWaitlist",
};

export async function sendBookingWhatsApp(companyId: string, notice: WhatsAppNotice, input: { phone: string | null; optIn: boolean; name: string; restaurant: string; when: string; partySize: number; link: string | null }) {
  if (!input.optIn || !input.phone) return { sent: false, reason: "sin consentimiento o teléfono" };
  try {
    const integration = await loadIntegration(companyId, "WHATSAPP");
    if (!integration?.enabled || !integration.config.phoneNumberId || !integration.secrets.accessToken) return { sent: false, reason: "WhatsApp no activo" };
    const template = integration.config[TEMPLATE_KEY[notice]];
    if (!template) return { sent: false, reason: "sin plantilla" };
    const to = normalizePhone(input.phone, integration.config.countryCode || "34");
    if (!to) return { sent: false, reason: "teléfono no válido" };
    await sendTemplate({ phoneNumberId: integration.config.phoneNumberId, accessToken: integration.secrets.accessToken }, {
      to,
      template,
      language: integration.config.language || "es",
      parameters: [input.name, input.restaurant, input.when, String(input.partySize), input.link ?? ""],
    });
    return { sent: true, reason: null };
  } catch (error) {
    console.error("Booking WhatsApp failed", error instanceof Error ? error.message : error);
    return { sent: false, reason: "error" };
  }
}

/** ¿Ofrecer avisos por WhatsApp en el formulario? (WhatsApp activo y con plantilla de confirmación). */
export async function whatsappOffered(companyId: string) {
  const integration = await loadIntegration(companyId, "WHATSAPP").catch(() => null);
  return Boolean(integration?.enabled && integration.config.phoneNumberId && (integration.config.templateConfirmed || integration.config.templatePending));
}
