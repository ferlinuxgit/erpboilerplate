import { afterEach, describe, expect, it, vi } from "vitest";

const integration = { enabled: true, config: { phoneNumberId: "1234567890", language: "es", countryCode: "34", templateConfirmed: "reserva_confirmada" } as Record<string, string>, secrets: { accessToken: "token" } as Record<string, string> };

vi.mock("@/server/integrations/service", () => ({ loadIntegration: vi.fn(async () => integration) }));

const { sendBookingWhatsApp } = await import("./booking-whatsapp");

const base = { phone: "600 11 22 33", optIn: true, name: "Ana", restaurant: "Bar Pepe", when: "sábado 21:00", partySize: 4, link: "https://erp.test/reservar/gestion/x" };

describe("avisos de reservas por WhatsApp", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("envía la plantilla con las variables en orden al móvil en formato internacional", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendBookingWhatsApp("company", "CONFIRMED", base)).toEqual({ sent: true, reason: null });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/1234567890/messages");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ messaging_product: "whatsapp", to: "34600112233", type: "template", template: { name: "reserva_confirmada", language: { code: "es" } } });
    expect(body.template.components[0].parameters.map((parameter: { text: string }) => parameter.text)).toEqual(["Ana", "Bar Pepe", "sábado 21:00", "4", "https://erp.test/reservar/gestion/x"]);
  });

  it("no envía sin consentimiento, sin plantilla o si falla, y nunca rompe la reserva", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Template not found" } }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await sendBookingWhatsApp("company", "CONFIRMED", { ...base, optIn: false })).sent).toBe(false);
    expect((await sendBookingWhatsApp("company", "REMINDER", base)).reason).toBe("sin plantilla");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await sendBookingWhatsApp("company", "CONFIRMED", base)).toEqual({ sent: false, reason: "error" });
  });
});
