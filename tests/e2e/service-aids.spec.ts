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

async function catalog(page: Page) {
  const taxes = await api<Array<{ id: string; rate: string; kind: string; operation: string }>>(page, "GET", "/api/taxes");
  const vat10 = taxes.find((entry) => Number(entry.rate) === 10 && entry.kind === "VAT" && entry.operation === "ADD")!;
  const kitchen = await postJson<{ id: string }>(page, "/api/item-categories", { code: "COC", name: "Cocina" });
  const drinks = await postJson<{ id: string }>(page, "/api/item-categories", { code: "BEB", name: "Bebidas" });
  const cana = await postJson<{ id: string }>(page, "/api/items", { name: "Caña", sku: "CANA", salePrice: 2, isService: true, categoryId: drinks.id, defaultTaxId: vat10.id });
  const vino = await postJson<{ id: string }>(page, "/api/items", { name: "Vino", sku: "VINO", salePrice: 3, isService: true, categoryId: drinks.id, defaultTaxId: vat10.id });
  const croquetas = await postJson<{ id: string }>(page, "/api/items", { name: "Croquetas", sku: "CROQ", salePrice: 7, isService: true, categoryId: kitchen.id, defaultTaxId: vat10.id });
  await api(page, "PUT", "/api/pos/hospitality/stations", { entries: [{ categoryId: kitchen.id, station: "KITCHEN" }, { categoryId: drinks.id, station: "BAR" }] });
  return { cana, vino, croquetas };
}

async function pin(page: Page, digits: string) {
  for (const key of digits) await page.getByRole("dialog").getByRole("button", { name: key, exact: true }).click();
}

test("Puesta en marcha en 3 pasos desde una caja de mostrador y modo formación sin tickets reales", async ({ page }) => {
  test.setTimeout(180_000);
  await registerAndSignIn(page, "Asistente E2E");
  await completeOnboarding(page, "Bar Asistente E2E S.L.");
  await api(page, "PUT", "/api/modules", { moduleId: "pos", enabled: true });
  await api(page, "PUT", "/api/modules", { moduleId: "hospitality", enabled: true });
  await catalog(page);
  // Como en un bar real: la caja se creó en modo mostrador antes de activar Hostelería.
  await postJson(page, "/api/pos/registers", { name: "Mostrador", seriesCode: "T", seriesPrefix: "T", simplifiedLimit: 400, mode: "COUNTER" });

  // Con una sola caja no se entra directo: se ofrece el asistente.
  await page.goto("/pos");
  await expect(page.getByTestId("pos-home-setup")).toBeVisible();
  await page.getByTestId("pos-home-setup").getByRole("link", { name: "Empezar" }).click();
  const wizard = page.getByTestId("pos-setup-wizard");
  await expect(wizard).toBeVisible();
  await wizard.getByTestId("pos-setup-register-Mostrador").click();
  await wizard.getByTestId("pos-setup-next").click();
  await wizard.getByRole("button", { name: /^Bar\s*8 mesas/ }).click();
  await wizard.getByRole("button", { name: "Mesas: uno más" }).click();
  await expect(wizard.getByTestId("pos-setup-tables-0")).toHaveText("9");
  await wizard.getByTestId("pos-setup-next").click();
  await expect(wizard.getByTestId("pos-setup-summary")).toContainText("Salón: 9 mesas de 4 plazas (Mesa 1–9)");
  await wizard.getByTestId("pos-setup-finish").click();

  // La caja queda en modo mesas: tras abrirla se ve el plano con las 9 mesas.
  await page.getByLabel("Fondo de caja").fill("50");
  await page.getByTestId("pos-open-submit").click();
  await expect(page.getByTestId("pos-floor")).toBeVisible();
  await expect(page.getByTestId("pos-tables").getByRole("button")).toHaveCount(9);
  await page.waitForLoadState("networkidle");

  // Modo formación: franja siempre visible, se practica una mesa entera y se cobra sin ticket.
  await page.getByTestId("pos-training-enter").click();
  await expect(page.getByTestId("pos-training-banner")).toContainText("Modo formación");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("pos-table-Mesa 1").click();
  await page.getByTestId("pos-guests-dialog").getByRole("button", { name: "2", exact: true }).click();
  await expect(page.getByTestId("pos-order-screen")).toBeVisible();
  await expect(page.getByTestId("pos-training-banner")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByTestId("pos-item-CROQ").click();
  await page.getByTestId("pos-order-send").click();
  await expect(page.getByTestId("pos-order-lines")).not.toContainText("Sin enviar");
  await page.getByTestId("pos-order-charge").click();
  await page.getByTestId("pos-split-continue").click();
  await page.getByRole("button", { name: "Exacto" }).click();
  await page.getByTestId("pos-pay-confirm").click();
  await expect(page.getByTestId("pos-order-closed")).toContainText("Mesa 1 cobrada");
  await expect(page.getByTestId("pos-order-print-ticket")).toHaveCount(0);
  await page.getByTestId("pos-order-back").click();
  await expect(page.getByTestId("pos-training-banner")).toBeVisible();

  // Cocina no ha visto nada de la práctica y la caja real no tiene tickets.
  await page.goto("/pos/kitchen");
  await expect(page.getByTestId("pos-kitchen")).toContainText("Todo al día");
  const registers = await api<Array<{ id: string; openSession: { id: string } | null }>>(page, "GET", "/api/pos/registers");
  const session = registers[0].openSession!;
  const detail = await api<{ tickets: unknown[] }>(page, "GET", `/api/pos/sessions/${session.id}`);
  expect(detail.tickets).toHaveLength(0);
});

test("Sala más rápida: aviso al salir sin enviar, otra ronda, deshacer, listos para recoger, alérgenos en cocina, recuperar y PIN de encargado", async ({ browser, page }) => {
  test.setTimeout(240_000);
  await registerAndSignIn(page, "Sala Rapida E2E");
  await completeOnboarding(page, "Taberna Rápida E2E S.L.");
  await api(page, "PUT", "/api/modules", { moduleId: "pos", enabled: true });
  await api(page, "PUT", "/api/modules", { moduleId: "hospitality", enabled: true });
  const { croquetas } = await catalog(page);
  await api(page, "PUT", `/api/pos/menu/items/${croquetas.id}`, { sectionId: null, visible: true, displayName: null, nameEn: null, description: null, descriptionEn: null, allergens: ["GLUTEN", "MILK"], traces: ["EGGS"], tags: [] });
  const register = await postJson<{ id: string }>(page, "/api/pos/registers", { name: "Sala", seriesCode: "S", seriesPrefix: "S", simplifiedLimit: 400, mode: "TABLES" });
  const area = await postJson<{ id: string }>(page, "/api/pos/hospitality/areas", { name: "Salón" });
  await postJson(page, "/api/pos/hospitality/tables", { areaId: area.id, prefix: "Mesa", from: 1, to: 3, seats: 4 });
  const staff = await api<Array<{ userId: string; name: string }>>(page, "GET", "/api/pos/hospitality/staff");
  await api(page, "PUT", `/api/pos/hospitality/staff/${staff[0].userId}`, { pin: "1234" });

  // Encargado y regla de autorización desde la configuración.
  await page.goto("/pos/settings#camareros");
  await page.waitForLoadState("networkidle");
  await page.getByTestId(`pos-staff-manager-${staff[0].name}`).check();
  await expect(page.getByText(`${staff[0].name} es encargado.`)).toBeVisible();
  await page.getByTestId("pos-manager-approval").check();
  await expect(page.getByText("A partir de ahora, anular lo enviado pide el PIN de un encargado.")).toBeVisible();

  await page.goto(`/pos/${register.id}`);
  await page.getByLabel("Fondo de caja").fill("100");
  await page.getByTestId("pos-open-submit").click();
  await expect(page.getByTestId("pos-floor")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByTestId("pos-waiter-button").click();
  await pin(page, "1234");
  await page.getByTestId("pos-pin-confirm").click();
  await expect(page.getByTestId("pos-waiter-button")).toContainText(staff[0].name.split(" ")[0]);

  // Mesa 1: dos cañas y un vino; «Deshacer» quita la última caña añadida por error.
  await page.getByTestId("pos-table-Mesa 1").click();
  await page.getByTestId("pos-guests-dialog").getByRole("button", { name: "2", exact: true }).click();
  await expect(page.getByTestId("pos-order-screen")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByTestId("pos-item-CANA").click();
  await page.getByTestId("pos-item-CANA").click();
  await page.getByTestId("pos-item-CANA").click();
  await page.getByTestId("pos-item-VINO").click();
  await page.getByTestId("pos-item-CANA").click();
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(page.getByText("Quitado: Caña.")).toBeVisible();
  await expect(page.getByTestId("pos-order-pending")).toContainText("9,90"); // 3 cañas (6,60) + vino (3,30)

  // Salir sin enviar: lo pregunta; «Enviar y volver» lo manda a barra y vuelve al plano.
  await page.getByTestId("pos-kiosk-back").click();
  await expect(page.getByTestId("pos-leave-dialog")).toBeVisible();
  await page.getByTestId("pos-leave-send").click();
  await expect(page.getByTestId("pos-floor")).toBeVisible();

  // «Otra ronda»: repite las 3 cañas y el vino (queda sin enviar para revisarla).
  await page.getByTestId("pos-table-Mesa 1").click();
  await expect(page.getByTestId("pos-order-screen")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByTestId("pos-order-repeat").click();
  await expect(page.getByTestId("pos-order-lines")).toContainText("Sin enviar (2)");
  await expect(page.getByTestId("pos-order-pending")).toContainText("19,80");
  // Croquetas para cocina y se envía todo.
  await page.getByTestId("pos-item-CROQ").click();
  await page.getByTestId("pos-order-send").click();
  await expect(page.getByTestId("pos-order-lines")).not.toContainText("Sin enviar");

  // Cocina: alérgenos con su nombre, resumen de producción, letra grande y alto contraste.
  const kitchen = await browser.newPage({ storageState: await page.context().storageState() });
  await kitchen.goto("/pos/kitchen");
  const batch = kitchen.getByTestId("pos-kitchen-batch-Mesa 1");
  await expect(batch.getByTestId("pos-kitchen-allergens")).toContainText("Gluten");
  await expect(batch.getByTestId("pos-kitchen-allergens")).toContainText("Lácteos");
  await expect(batch.getByTestId("pos-kitchen-allergens")).toContainText("trazas");
  await kitchen.getByTestId("pos-kitchen-summary-toggle").click();
  await expect(kitchen.getByTestId("pos-kitchen-summary")).toContainText("Croquetas");
  await kitchen.getByTestId("pos-kitchen-scale").click();
  await kitchen.getByTestId("pos-kitchen-contrast").click();
  await expect(kitchen.getByTestId("pos-kitchen")).toHaveClass(/dark/);
  // Listo y «Servido» por error: se recupera desde «Recuperar».
  await batch.getByTestId("pos-kitchen-all-ready").click();
  await expect(batch.getByTestId("pos-kitchen-served")).toBeEnabled();

  // El camarero recibe el aviso de listo y lo ve en «Para recoger».
  await page.getByTestId("pos-kiosk-back").click();
  await expect(page.getByTestId("pos-floor")).toBeVisible();
  await expect(page.getByTestId("pos-pickup-count")).toHaveText("1", { timeout: 15_000 });
  await page.getByTestId("pos-pickup-button").click();
  await expect(page.getByTestId("pos-pickup-Mesa 1")).toContainText("Croquetas");
  await page.keyboard.press("Escape");

  await batch.getByTestId("pos-kitchen-served").click();
  await expect(kitchen.getByTestId("pos-kitchen-batch-Mesa 1")).toHaveCount(0);
  await kitchen.getByTestId("pos-kitchen-recover").click();
  await kitchen.getByTestId("pos-kitchen-recover-Mesa 1").click();
  await expect(kitchen.getByTestId("pos-kitchen-batch-Mesa 1")).toContainText("Croquetas");
  await kitchen.close();

  // Anular algo ya enviado pide el PIN del encargado y queda en el cierre de caja.
  await page.getByTestId("pos-table-Mesa 1").click();
  await expect(page.getByTestId("pos-order-screen")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Editar Vino" }).first().click();
  const sheet = page.getByTestId("pos-order-line-sheet");
  await sheet.getByRole("button", { name: "Una unidad menos" }).click();
  await sheet.locator("#pos-line-cancel-reason").fill("Se equivocó de bebida");
  await page.getByTestId("pos-order-line-save").click();
  await expect(page.getByTestId("pos-manager-pin-dialog")).toBeVisible();
  await pin(page, "9999");
  await page.getByTestId("pos-manager-pin-confirm").click();
  await expect(page.getByText("PIN de encargado incorrecto.")).toBeVisible();
  await page.getByRole("button", { name: "Editar Vino" }).first().click();
  await sheet.getByRole("button", { name: "Una unidad menos" }).click();
  await sheet.locator("#pos-line-cancel-reason").fill("Se equivocó de bebida");
  await page.getByTestId("pos-order-line-save").click();
  await pin(page, "1234");
  await page.getByTestId("pos-manager-pin-confirm").click();
  await expect(page.getByText("Anulado: Vino.")).toBeVisible();

  await page.goto(`/pos/${register.id}/close`);
  const voids = page.getByTestId("pos-report-voids");
  await expect(voids).toContainText("Vino");
  await expect(voids).toContainText(`autorizó ${staff[0].name}`);
  await expect(voids).toContainText("Se equivocó de bebida");
});
