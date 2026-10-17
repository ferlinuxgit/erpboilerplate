import { expect, test, type Page } from "@playwright/test";

import { decodeParameters, encodeParameters, redsysSignature } from "../../src/server/integrations/redsys";
import { postJson } from "./helpers/api-client";
import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  return page.evaluate(async ({ method, path, body }) => {
    const token = document.cookie.split("; ").find((cookie) => cookie.startsWith("csrf-token="))?.split("=")[1] ?? "";
    const response = await fetch(path, { method, headers: { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(token) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text}`);
    return (text ? JSON.parse(text) : null) as T;
  }, { method, path, body });
}

// Comercio y clave de pruebas públicos de Redsys.
const REDSYS_TEST_KEY = "sq7HjrUOBfKmC576ILgskD5srU870gJ7";

function tomorrowInMadrid() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

test("Fianza: Redsys configurado, reserva de grupo retenida hasta pagar, aviso firmado del banco y «no vino»", async ({ browser, page }) => {
  test.setTimeout(180_000);
  await registerAndSignIn(page, "Fianza E2E");
  await completeOnboarding(page, "Asador Fianza E2E S.L.");
  await api(page, "PUT", "/api/modules", { moduleId: "pos", enabled: true });
  await api(page, "PUT", "/api/modules", { moduleId: "hospitality", enabled: true });
  const register = await postJson<{ id: string }>(page, "/api/pos/registers", { name: "Sala", seriesCode: "F", seriesPrefix: "F", simplifiedLimit: 400, mode: "TABLES" });
  const area = await postJson<{ id: string }>(page, "/api/pos/hospitality/areas", { name: "Sala" });
  await postJson(page, "/api/pos/hospitality/tables", { areaId: area.id, prefix: "Mesa", from: 1, to: 1, seats: 8 });

  // Redsys desde la pantalla de ajustes (la clave queda cifrada y no se vuelve a mostrar).
  await page.goto("/pos/settings#integraciones");
  await page.waitForLoadState("networkidle");
  const redsys = page.getByTestId("integration-REDSYS");
  await redsys.getByLabel("Código de comercio (FUC)").fill("999008881");
  await redsys.getByLabel("Clave secreta (SHA-256)").fill(REDSYS_TEST_KEY);
  await redsys.getByLabel("Nombre que verá el cliente").fill("Asador Fianza");
  await redsys.getByRole("checkbox", { name: "Activo" }).click();
  await redsys.getByTestId("integration-REDSYS-save").click();
  await expect(page.getByText("Redsys (TPV virtual del banco) guardado.")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("integration-REDSYS").getByLabel("Clave secreta (SHA-256)")).toHaveAttribute("placeholder", /guardada/);
  await page.getByTestId("integration-REDSYS-test").click();
  await expect(page.getByTestId("integration-REDSYS")).toContainText("Datos de Redsys completos");
  const companyUrl = await page.getByTestId("integration-REDSYS").locator("code").textContent();
  const companyId = companyUrl!.split("/").pop()!;

  // Reservas con fianza de 10 € por persona desde 6.
  const slug = `fianza-e2e-${Date.now().toString(36)}`;
  await api(page, "PUT", "/api/pos/bookings/settings", {
    enabled: true, slug, registerId: register.id, slotMinutes: 30, durationMinutes: 90, minPartySize: 1, maxPartySize: 8, leadMinutes: 60, maxDaysAhead: 30,
    autoConfirm: true, cancellationHours: 2, allowCombining: true, welcomeMessage: null, notifyEmail: null, sendReminders: false,
    depositEnabled: true, depositProvider: "REDSYS", depositPerPerson: 10, depositMinParty: 6, depositRefundable: true,
    hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "21:00", lastStart: "21:00" })),
  });
  const date = tomorrowInMadrid();

  // El formulario avisa de la fianza al elegir 6 personas.
  const guest = await browser.newContext();
  const customer = await guest.newPage();
  await customer.goto(`/reservar/${slug}?fecha=${date}&personas=6`);
  await customer.waitForLoadState("networkidle");
  await customer.getByTestId("booking-slot-21:00").click();
  await expect(customer.getByTestId("booking-contact")).toContainText("fianza de 10,00 € por persona (60,00 €)");
  await expect(customer.getByTestId("booking-submit")).toContainText("Reservar y pagar fianza (60,00 €)");
  await guest.close();

  // Reserva de 6: queda esperando el pago, con la mesa retenida y el formulario firmado para Redsys.
  const created = await api<{ token: string; status: string; payment: { kind: string; url: string; fields: Record<string, string> } }>(page, "POST", `/api/public/bookings/${slug}`, { date, time: "21:00", partySize: 6, name: "Grupo Fianza", phone: "600111222", email: "grupo@example.com", notes: null, consent: true });
  expect(created.status).toBe("AWAITING_PAYMENT");
  expect(created.payment.kind).toBe("form");
  expect(created.payment.url).toContain("sis-t.redsys.es");
  const sent = decodeParameters(created.payment.fields.Ds_MerchantParameters);
  expect(sent.DS_MERCHANT_AMOUNT).toBe("6000");
  const availability = await api<{ slots: Array<{ time: string; available: boolean }> }>(page, "GET", `/api/public/bookings/${slug}/availability?date=${date}&party=2`);
  expect(availability.slots.find((slot) => slot.time === "21:00")?.available).toBe(false);

  // Una notificación con la firma mal no hace nada.
  const order = sent.DS_MERCHANT_ORDER;
  const paid = encodeParameters({ Ds_Order: order, Ds_Response: "0000", Ds_Amount: "6000", Ds_AuthorisationCode: "123456" });
  const notify = (signature: string) => page.evaluate(async ({ url, encoded, signature }) => {
    const body = new URLSearchParams({ Ds_SignatureVersion: "HMAC_SHA256_V1", Ds_MerchantParameters: encoded, Ds_Signature: signature });
    return (await fetch(url, { method: "POST", body })).status;
  }, { url: `/api/public/payments/redsys/${companyId}`, encoded: paid, signature });
  expect(await notify("firma-falsa")).toBe(400);

  // El banco avisa del pago (firmado): la reserva queda confirmada con la fianza pagada.
  expect(await notify(redsysSignature(paid, order, REDSYS_TEST_KEY))).toBe(200);
  await page.goto(`/reservar/gestion/${created.token}`);
  await expect(page.getByTestId("booking-manage-status")).toContainText("Reserva confirmada");
  await expect(page.getByTestId("booking-deposit-status")).toContainText("Fianza pagada");
  await expect(page.getByTestId("booking-deposit-status")).toContainText("60,00");

  // En la sala: ven la fianza; si no vienen, se queda.
  await page.goto(`/pos/bookings?date=${date}&register=${register.id}`);
  const card = page.getByTestId("pos-booking-Grupo Fianza");
  await expect(card.getByTestId("pos-booking-deposit")).toContainText("Fianza pagada");
  await card.getByTestId("pos-booking-no-show").click();
  await expect(card.getByTestId("pos-booking-deposit")).toContainText("Fianza retenida");
});
