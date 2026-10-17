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

/** Mañana en Madrid (zona por defecto de la empresa) y su día de la semana. */
function tomorrowInMadrid() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const date = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return { date, weekday: new Date(`${date}T00:00:00Z`).getUTCDay() };
}

async function bookOnline(page: Page, slug: string, input: { date: string; party: number; time: string; name: string }) {
  await page.goto(`/reservar/${slug}`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("booking-form").getByRole("button", { name: String(input.party), exact: true }).click();
  await page.getByTestId(`booking-day-${input.date}`).click();
  await page.getByTestId(`booking-slot-${input.time}`).click();
  const contact = page.getByTestId("booking-contact");
  await contact.getByLabel("Nombre").fill(input.name);
  await contact.getByLabel("Teléfono").fill("600 123 456");
  await contact.getByLabel("Email").fill(`${input.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, ".")}@example.com`);
  await contact.getByRole("checkbox", { name: /Acepto que/ }).click();
  await page.getByTestId("booking-submit").click();
  await expect(page.getByTestId("booking-manage")).toBeVisible();
}

test("Reservas: plano editable, formulario público con aforo, cancelación por enlace y gestión en sala", async ({ browser, page }) => {
  test.setTimeout(180_000);
  await registerAndSignIn(page, "Reservas E2E");
  await completeOnboarding(page, "Casa Reservas E2E S.L.");

  await api(page, "PUT", "/api/modules", { moduleId: "pos", enabled: true });
  await api(page, "PUT", "/api/modules", { moduleId: "hospitality", enabled: true });
  const register = await postJson<{ id: string }>(page, "/api/pos/registers", { name: "Comedor", seriesCode: "R", seriesPrefix: "R", simplifiedLimit: 400, mode: "TABLES" });
  const area = await postJson<{ id: string }>(page, "/api/pos/hospitality/areas", { name: "Comedor" });
  await postJson(page, "/api/pos/hospitality/tables", { areaId: area.id, prefix: "Mesa", from: 1, to: 2, seats: 4 });

  // Plano: la Mesa 1 pasa a ser redonda de 2 plazas y se mueve con el teclado.
  await page.goto("/pos/settings#mesas");
  const plan = page.getByTestId("pos-plan-Comedor");
  await expect(plan.getByTestId("pos-plan-table-Mesa 1")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await plan.getByTestId("pos-plan-table-Mesa 1").click();
  const panel = page.getByTestId("pos-plan-panel");
  await panel.getByLabel("Plazas").fill("2");
  await panel.getByRole("button", { name: "Redonda" }).click();
  await panel.getByTestId("pos-plan-table-save").click();
  await expect(page.getByText("Mesa guardada.")).toBeVisible();
  // El plano se recarga con los datos guardados (y cierra el panel) antes de seguir.
  await expect(plan.getByTestId("pos-plan-table-Mesa 1")).toContainText("2 pax");
  await expect(panel).toBeHidden();
  await plan.getByTestId("pos-plan-table-Mesa 2").focus();
  for (let step = 0; step < 4; step += 1) await page.keyboard.press("ArrowDown");
  await page.getByTestId("pos-plan-save-Comedor").click();
  await expect(page.getByText("Plano guardado.")).toBeVisible();
  const floor = await api<{ areas: Array<{ planned: boolean; tables: Array<{ name: string; seats: number; shape: string; posY: number }> }> }>(page, "GET", `/api/pos/hospitality/floor?registerId=${register.id}`);
  expect(floor.areas[0].planned).toBe(true);
  expect(floor.areas[0].tables.find((table) => table.name === "Mesa 1")).toMatchObject({ seats: 2, shape: "ROUND" });
  expect(floor.areas[0].tables.find((table) => table.name === "Mesa 2")?.posY).toBe(4);

  // Reservas online: turno de comidas todos los días, hasta 6 personas.
  const { date, weekday } = tomorrowInMadrid();
  const slug = `casa-e2e-${Date.now().toString(36)}`;
  await page.goto("/pos/settings#reservas");
  await page.waitForLoadState("networkidle");
  const settings = page.getByTestId("booking-settings");
  await settings.getByTestId("booking-enabled").click();
  await settings.getByTestId("booking-slug").fill(slug);
  await settings.getByTestId(`booking-add-shift-${weekday}`).click();
  await settings.getByRole("button", { name: "Copiar a todos" }).click();
  await settings.getByTestId("booking-max-party").fill("6");
  await settings.getByTestId("booking-settings-save").click();
  await expect(page.getByText("Reservas guardadas y activas.")).toBeVisible();

  // Cliente sin sesión: reserva para 4 a las 13:00 (le toca la Mesa 2).
  const guest = await browser.newContext();
  const customer = await guest.newPage();
  await bookOnline(customer, slug, { date, party: 4, time: "13:00", name: "Ana García" });
  await expect(customer.getByTestId("booking-manage-status")).toContainText("¡Reserva confirmada!");
  await expect(customer.getByTestId("booking-code")).toHaveText(/^[A-Z2-9]{6}$/);

  // Aforo: otro grupo de 4 ya no cabe a esa hora ni mientras dure la comida (90 min).
  await customer.goto(`/reservar/${slug}`);
  await customer.waitForLoadState("networkidle");
  await customer.getByTestId("booking-form").getByRole("button", { name: "4", exact: true }).click();
  await customer.getByTestId(`booking-day-${date}`).click();
  await expect(customer.getByTestId("booking-slot-13:00")).toBeDisabled();
  await expect(customer.getByTestId("booking-slot-14:00")).toBeDisabled();
  await expect(customer.getByTestId("booking-slot-14:30")).toBeEnabled();

  // Una pareja sí cabe (Mesa 1) y luego cancela desde su enlace.
  await bookOnline(customer, slug, { date, party: 2, time: "13:00", name: "Luis Pérez" });
  const availability = () => api<{ slots: Array<{ time: string; available: boolean }> }>(page, "GET", `/api/public/bookings/${slug}/availability?date=${date}&party=2`);
  expect((await availability()).slots.find((slot) => slot.time === "13:00")?.available).toBe(false);
  await customer.getByTestId("booking-cancel").click();
  await customer.getByTestId("booking-cancel-confirm").click();
  await expect(customer.getByTestId("booking-manage-status")).toContainText("Reserva cancelada");
  expect((await availability()).slots.find((slot) => slot.time === "13:00")?.available).toBe(true);
  await guest.close();

  // En sala: abrir la caja, ver las reservas de mañana y apuntar una por teléfono.
  await page.goto(`/pos/${register.id}`);
  await page.getByLabel("Fondo de caja").fill("50");
  await page.getByTestId("pos-open-submit").click();
  await expect(page.getByTestId("pos-floor")).toBeVisible();
  // La sala está dibujada: en pantalla grande se ve el plano (y se puede pasar a lista).
  await expect(page.getByTestId("pos-floor-view")).toBeVisible();
  await page.getByTestId("pos-bookings-link").click();
  await expect(page.getByTestId("pos-bookings")).toBeVisible();
  await page.goto(`/pos/bookings?date=${date}&register=${register.id}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("pos-booking-Ana García")).toContainText("Mesa 2");
  await expect(page.getByTestId("pos-booking-Luis Pérez").getByTestId("pos-booking-status")).toHaveText("Cancelada");

  await page.getByTestId("pos-booking-new").click();
  const dialog = page.getByTestId("pos-booking-dialog");
  await dialog.getByTestId("pos-booking-slot-15:00").click();
  await dialog.getByLabel("Nombre").fill("Marta Teléfono");
  await dialog.getByLabel("Teléfono").fill("611 222 333");
  await dialog.getByTestId("pos-booking-save").click();
  await expect(page.getByText("Reserva apuntada.")).toBeVisible();
  await expect(page.getByTestId("pos-booking-Marta Teléfono")).toContainText("Teléfono");
  await page.getByTestId("pos-booking-Marta Teléfono").getByTestId("pos-booking-no-show").click();
  await expect(page.getByTestId("pos-booking-Marta Teléfono").getByTestId("pos-booking-status")).toHaveText("No vino");

  // Sentar a Ana: se abre la cuenta de la Mesa 2 con 4 comensales.
  await page.getByTestId("pos-booking-Ana García").getByTestId("pos-booking-seat").click();
  await expect(page.getByTestId("pos-order-screen")).toBeVisible();
  const orderId = page.url().split("/orders/")[1];
  const order = await api<{ tableName: string; guests: number }>(page, "GET", `/api/pos/hospitality/orders/${orderId}`);
  expect(order).toMatchObject({ tableName: "Mesa 2", guests: 4 });
  await page.goto(`/pos/bookings?date=${date}&register=${register.id}`);
  await expect(page.getByTestId("pos-booking-Ana García").getByTestId("pos-booking-status")).toHaveText("Sentados");

  // Sin el módulo de hostelería, el formulario deja de aceptar reservas.
  await api(page, "PUT", "/api/modules", { moduleId: "hospitality", enabled: false });
  const anonymous = await browser.newContext();
  const visitor = await anonymous.newPage();
  await visitor.goto(`/reservar/${slug}`);
  await expect(visitor.getByRole("heading", { name: "Reservas no disponibles" })).toBeVisible();
  await anonymous.close();
});
