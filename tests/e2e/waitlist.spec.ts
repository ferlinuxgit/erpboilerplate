import { expect, test, type Page } from "@playwright/test";

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

function tomorrowInMadrid() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

test("Lista de espera: día completo, aviso al liberarse mesa y grupo en la puerta", async ({ browser, page }) => {
  test.setTimeout(180_000);
  await registerAndSignIn(page, "Espera E2E");
  await completeOnboarding(page, "Bistró Espera E2E S.L.");
  await api(page, "PUT", "/api/modules", { moduleId: "pos", enabled: true });
  await api(page, "PUT", "/api/modules", { moduleId: "hospitality", enabled: true });
  const register = await postJson<{ id: string }>(page, "/api/pos/registers", { name: "Sala", seriesCode: "W", seriesPrefix: "W", simplifiedLimit: 400, mode: "TABLES" });
  const area = await postJson<{ id: string }>(page, "/api/pos/hospitality/areas", { name: "Sala" });
  await postJson(page, "/api/pos/hospitality/tables", { areaId: area.id, prefix: "Mesa", from: 1, to: 1, seats: 4 });
  const slug = `espera-e2e-${Date.now().toString(36)}`;
  await api(page, "PUT", "/api/pos/bookings/settings", {
    enabled: true, slug, registerId: register.id, slotMinutes: 30, durationMinutes: 90, minPartySize: 1, maxPartySize: 6, leadMinutes: 60, maxDaysAhead: 30,
    autoConfirm: true, cancellationHours: 2, allowCombining: true, welcomeMessage: null, notifyEmail: null, sendReminders: false,
    hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "13:00", lastStart: "13:00" })),
  });
  const date = tomorrowInMadrid();

  // Alguien reserva la única mesa a las 13:00.
  const first = await api<{ token: string }>(page, "POST", `/api/public/bookings/${slug}`, { date, time: "13:00", partySize: 4, name: "Ana Primera", phone: "600111222", email: "ana@example.com", notes: null, consent: true });

  // Otro cliente llega al formulario desde un enlace con día y personas: está completo y se apunta a la lista.
  const guest = await browser.newContext();
  const customer = await guest.newPage();
  await customer.goto(`/reservar/${slug}?fecha=${date}&personas=4`);
  await customer.waitForLoadState("networkidle");
  await expect(customer.getByTestId("booking-slot-13:00")).toBeDisabled();
  await customer.getByTestId("booking-waitlist-open").click();
  const waitlist = customer.getByTestId("booking-waitlist");
  await waitlist.getByLabel("Nombre").fill("Luis Espera");
  await waitlist.getByLabel("Teléfono").fill("600333444");
  await waitlist.getByLabel("Email").fill("luis@example.com");
  await waitlist.getByRole("checkbox").click();
  await waitlist.getByTestId("booking-waitlist-submit").click();
  await expect(customer.getByTestId("booking-waitlist-done")).toBeVisible();
  await guest.close();

  // El restaurante lo ve en las reservas de ese día.
  await page.goto(`/pos/bookings?date=${date}&register=${register.id}`);
  await expect(page.getByTestId("pos-waitlist-Luis Espera")).toContainText("Web");
  await expect(page.getByTestId("pos-waitlist-Luis Espera").getByTestId("pos-waitlist-notified")).toHaveCount(0);

  // Ana cancela: la mesa se ofrece a la lista de espera (aviso por email) y queda marcado como avisado.
  await api(page, "POST", `/api/public/bookings/manage/${first.token}/cancel`);
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId("pos-waitlist-Luis Espera").getByTestId("pos-waitlist-notified")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });

  // Hoy llega un grupo sin reserva: se apunta en la puerta y se le da mesa.
  await page.getByTestId("pos-waitlist-walk-in").click();
  const walkIn = page.getByTestId("pos-walk-in-dialog");
  await walkIn.getByLabel("Nombre").fill("Pareja Puerta");
  await walkIn.getByLabel("Teléfono (para avisarle)").fill("611000111");
  await walkIn.getByTestId("pos-walk-in-save").click();
  await expect(page.getByText("Pareja Puerta apuntado en la lista de espera.")).toBeVisible();
  const entry = page.getByTestId("pos-waitlist-Pareja Puerta");
  await expect(entry).toContainText("En la puerta");
  await entry.getByTestId("pos-waitlist-seat").click();
  const dialog = page.getByTestId("pos-booking-dialog");
  await expect(dialog.getByLabel("Nombre")).toHaveValue("Pareja Puerta");
  await dialog.getByTestId("pos-booking-save").click();
  await expect(page.getByText("Pareja Puerta ya tiene mesa.")).toBeVisible();
  await expect(page.getByTestId("pos-waitlist-Pareja Puerta")).toHaveCount(0);
  await expect(page.getByTestId("pos-booking-Pareja Puerta")).toContainText("Sin reserva");
});
