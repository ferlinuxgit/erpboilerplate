import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { decodeParameters, isRedsysAuthorized, redsysOrderNumber, redsysPaymentForm, redsysSignature, verifyRedsysNotification } from "./redsys";
import { verifyStripeWebhook } from "./stripe";

// Clave de pruebas pública de Redsys (entorno de test).
const TEST_KEY = "sq7HjrUOBfKmC576ILgskD5srU870gJ7";
const credentials = { merchantCode: "999008881", terminal: "1", merchantKey: TEST_KEY, environment: "test" as const };

describe("Redsys", () => {
  it("genera números de pedido válidos (12, los 4 primeros numéricos)", () => {
    const order = redsysOrderNumber();
    expect(order).toMatch(/^\d{12}$/);
  });

  it("firma el formulario de pago y la firma es estable", () => {
    const form = redsysPaymentForm(credentials, { order: "123456789012", amountCents: 2000, description: "Fianza reserva", merchantName: "Bar Pepe", urlOk: "https://x/ok", urlKo: "https://x/ko", notificationUrl: "https://x/n" });
    expect(form.url).toContain("sis-t.redsys.es");
    expect(decodeParameters(form.fields.Ds_MerchantParameters)).toMatchObject({ DS_MERCHANT_AMOUNT: "2000", DS_MERCHANT_ORDER: "123456789012", DS_MERCHANT_CURRENCY: "978" });
    expect(form.fields.Ds_Signature).toBe(redsysSignature(form.fields.Ds_MerchantParameters, "123456789012", TEST_KEY));
    expect(form.fields.Ds_Signature).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("acepta notificaciones bien firmadas (también en base64url) y rechaza las manipuladas", () => {
    const encoded = Buffer.from(JSON.stringify({ Ds_Order: "123456789012", Ds_Response: "0000", Ds_Amount: "2000" })).toString("base64");
    const signature = redsysSignature(encoded, "123456789012", TEST_KEY);
    const urlSafe = signature.replace(/\+/g, "-").replace(/\//g, "_");
    const parameters = verifyRedsysNotification(encoded, urlSafe, TEST_KEY);
    expect(parameters?.Ds_Response).toBe("0000");
    expect(isRedsysAuthorized(parameters!)).toBe(true);
    const tampered = Buffer.from(JSON.stringify({ Ds_Order: "123456789012", Ds_Response: "0000", Ds_Amount: "1" })).toString("base64");
    expect(verifyRedsysNotification(tampered, signature, TEST_KEY)).toBeNull();
    expect(isRedsysAuthorized({ Ds_Response: "0190" })).toBe(false);
  });
});

describe("Stripe webhooks", () => {
  const secret = "whsec_test";
  const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1" } } });
  const now = 1_800_000_000_000;
  const sign = (timestamp: number, body = payload) => `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;

  it("verifica la firma y la antigüedad", () => {
    expect(verifyStripeWebhook(payload, sign(now / 1000), secret, now)?.type).toBe("checkout.session.completed");
    expect(verifyStripeWebhook(payload, sign(now / 1000 - 600), secret, now)).toBeNull();
    expect(verifyStripeWebhook(`${payload} `, sign(now / 1000), secret, now)).toBeNull();
    expect(verifyStripeWebhook(payload, null, secret, now)).toBeNull();
  });
});

describe("WhatsApp", () => {
  it("normaliza teléfonos a formato internacional", async () => {
    const { normalizePhone } = await import("./whatsapp");
    expect(normalizePhone("600 11 22 33")).toBe("34600112233");
    expect(normalizePhone("+34 600-11-22-33")).toBe("34600112233");
    expect(normalizePhone("0044 7700 900123")).toBe("447700900123");
    expect(normalizePhone("612345678", "351")).toBe("351612345678");
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});
