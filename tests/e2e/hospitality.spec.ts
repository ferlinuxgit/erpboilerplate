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

test("Hostelería: mesas, rondas con notas, cocina y barra, pre-cuenta, cuenta dividida con propina, mover y juntar", async ({ browser, page }) => {
  test.setTimeout(180_000);
  await registerAndSignIn(page, "Restaurante E2E");
  await completeOnboarding(page, "Restaurante La Plaza E2E S.L.");

  // Configuración por API: módulos, categorías con IVA del 10 %, estaciones, caja en modo mesas, sala y PIN.
  await api(page, "PUT", "/api/modules", { moduleId: "pos", enabled: true });
  await api(page, "PUT", "/api/modules", { moduleId: "hospitality", enabled: true });
  const taxes = await api<Array<{ id: string; rate: string; kind: string; operation: string }>>(page, "GET", "/api/taxes");
  const vat10 = taxes.find((entry) => Number(entry.rate) === 10 && entry.kind === "VAT" && entry.operation === "ADD");
  expect(vat10).toBeTruthy();
  const kitchen = await postJson<{ id: string }>(page, "/api/item-categories", { code: "COC", name: "Cocina" });
  const drinks = await postJson<{ id: string }>(page, "/api/item-categories", { code: "BEB", name: "Bebidas" });
  await postJson(page, "/api/items", { name: "Caña", sku: "CANA", salePrice: 2, isService: true, categoryId: drinks.id, defaultTaxId: vat10!.id });
  await postJson(page, "/api/items", { name: "Croquetas", sku: "CROQ", salePrice: 7, isService: true, categoryId: kitchen.id, defaultTaxId: vat10!.id });
  await postJson(page, "/api/items", { name: "Menú del día", sku: "MENU", salePrice: 13, isService: true, categoryId: kitchen.id, defaultTaxId: vat10!.id });
  await api(page, "PUT", "/api/pos/hospitality/stations", { entries: [{ categoryId: kitchen.id, station: "KITCHEN" }, { categoryId: drinks.id, station: "BAR" }] });
  const bank = await postJson<{ id: string }>(page, "/api/bank-accounts", { bankName: "Banco datáfono", iban: "ES91 2100 0418 4502 0005 1332" });
  const register = await postJson<{ id: string }>(page, "/api/pos/registers", { name: "Sala", seriesCode: "T", seriesPrefix: "T", simplifiedLimit: 400, mode: "TABLES", cardBankAccountId: bank.id });
  const area = await postJson<{ id: string }>(page, "/api/pos/hospitality/areas", { name: "Salón" });
  await postJson(page, "/api/pos/hospitality/tables", { areaId: area.id, prefix: "Mesa", from: 1, to: 4, seats: 4 });
  const staff = await api<Array<{ userId: string; name: string }>>(page, "GET", "/api/pos/hospitality/staff");
  await api(page, "PUT", `/api/pos/hospitality/staff/${staff[0].userId}`, { pin: "1234" });

  // Abrir la caja y ver el plano.
  await page.goto(`/pos/${register.id}`);
  await page.getByLabel("Fondo de caja").fill("100");
  await page.getByTestId("pos-open-submit").click();
  await expect(page.getByTestId("pos-floor")).toBeVisible();
  await expect(page.getByTestId("pos-tables").getByRole("button")).toHaveCount(4);
  await page.waitForLoadState("networkidle");

  // El camarero se identifica con su PIN.
  await page.getByTestId("pos-waiter-button").click();
  const pin = page.getByTestId("pos-pin-dialog");
  for (const key of ["1", "2", "3", "4"]) await pin.getByRole("button", { name: key, exact: true }).click();
  await page.getByTestId("pos-pin-confirm").click();
  await expect(page.getByTestId("pos-waiter-button")).toContainText("Restaurante");

  // Mesa 1 con 2 comensales: primera ronda (2 cañas y croquetas para compartir).
  await page.getByTestId("pos-table-Mesa 1").click();
  await page.getByTestId("pos-guests-dialog").getByRole("button", { name: "2", exact: true }).click();
  await expect(page.getByTestId("pos-order-screen")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByTestId("pos-item-CANA").click();
  await page.getByTestId("pos-item-CANA").click();
  await page.getByTestId("pos-item-CROQ").click();
  await expect(page.getByTestId("pos-order-lines")).toContainText("Sin enviar (2)");
  await expect(page.getByTestId("pos-order-pending")).toContainText("12,10");
  await page.getByRole("button", { name: "Editar Croquetas" }).click();
  await page.getByTestId("pos-order-line-sheet").getByRole("button", { name: "Para compartir" }).click();
  await page.getByTestId("pos-order-line-save").click();
  await expect(page.getByTestId("pos-order-lines")).toContainText("Para compartir");
  await page.getByTestId("pos-order-send").click();
  await expect(page.getByText(/Enviado a cocina y barra|Enviado a barra y cocina/)).toBeVisible();
  await expect(page.getByTestId("pos-order-lines")).not.toContainText("Sin enviar");

  // Cocina (otra tablet): ve las croquetas con su nota y las marca listas; barra ve las cañas.
  const kitchenPage = await browser.newPage({ storageState: await page.context().storageState() });
  await kitchenPage.goto("/pos/kitchen");
  const batch = kitchenPage.getByTestId("pos-kitchen-batch-Mesa 1");
  await expect(batch).toContainText("Croquetas");
  await expect(batch).toContainText("Para compartir");
  await expect(batch).not.toContainText("Caña");
  await batch.getByTestId("pos-kitchen-all-ready").click();
  await kitchenPage.getByTestId("pos-kitchen-station-bar").click();
  await expect(kitchenPage.getByTestId("pos-kitchen-batch-Mesa 1")).toContainText("Caña");
  await kitchenPage.close();

  // El camarero ve el aviso de «listo» (se sincroniza sola) y pide la segunda ronda.
  await expect(page.getByText(/1 plato listo para servir/)).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("pos-item-MENU").click();
  await page.getByTestId("pos-item-MENU").click();
  await page.getByTestId("pos-order-send").click();
  await expect(page.getByTestId("pos-order-pending")).toContainText("40,70");

  // Pre-cuenta: no es factura, total 40,70 y por persona.
  const prebillPopup = page.waitForEvent("popup");
  await page.getByTestId("pos-order-bill").click();
  const prebill = await prebillPopup;
  await expect(prebill.getByTestId("pos-prebill")).toContainText("NO VÁLIDO COMO FACTURA");
  await expect(prebill.getByTestId("pos-prebill-total")).toContainText("40,70");
  await expect(prebill.getByTestId("pos-prebill")).toContainText("Por persona (2)");
  await prebill.close();

  // Cuenta a partes iguales entre 2: primera parte en efectivo.
  await page.getByTestId("pos-order-charge").click();
  await page.getByTestId("pos-split-equal").click();
  await expect(page.getByTestId("pos-split-parts")).toHaveText("2");
  await expect(page.getByTestId("pos-split-amount")).toContainText("20,35");
  await page.getByTestId("pos-split-continue").click();
  await page.getByRole("button", { name: "Exacto" }).click();
  await page.getByTestId("pos-pay-confirm").click();
  await expect(page.getByTestId("pos-order-remaining")).toContainText("20,35");
  await page.getByTestId("pos-order-continue").click();

  // Segunda parte con tarjeta y propina del 5 %: la mesa queda cobrada.
  await page.getByTestId("pos-order-charge").click();
  await expect(page.getByTestId("pos-split-dialog")).toContainText("parte 2 de 2");
  await page.getByTestId("pos-split-continue").click();
  await page.getByTestId("pos-method-card").click();
  await page.getByTestId("pos-tip").getByRole("button", { name: "5 %" }).click();
  await page.getByTestId("pos-pay-confirm").click();
  await expect(page.getByTestId("pos-order-closed")).toContainText("Mesa 1 cobrada");
  await page.getByTestId("pos-order-back").click();
  await expect(page.getByTestId("pos-table-Mesa 1")).toContainText("Libre");

  // Mover la cuenta de la mesa 2 a la 3 (libre) y juntar la 4 con la 3.
  await page.getByTestId("pos-table-Mesa 2").click();
  await page.getByTestId("pos-guests-dialog").getByRole("button", { name: "1", exact: true }).click();
  await page.waitForLoadState("networkidle");
  await page.getByTestId("pos-item-CANA").click();
  await expect(page.getByTestId("pos-order-pending")).toContainText("2,20");
  await page.getByTestId("pos-order-move").click();
  await page.getByTestId("pos-move-target-Mesa 3").click();
  await expect(page.getByText("Cuenta movida.")).toBeVisible();
  await expect(page.getByTestId("pos-kiosk-bar")).toContainText("Mesa 3");

  await page.goto(`/pos/${register.id}`);
  await expect(page.getByTestId("pos-table-Mesa 2")).toContainText("Libre");
  await page.getByTestId("pos-table-Mesa 4").click();
  await page.getByTestId("pos-guests-dialog").getByRole("button", { name: "3", exact: true }).click();
  await page.waitForLoadState("networkidle");
  await page.getByTestId("pos-item-CROQ").click();
  await expect(page.getByTestId("pos-order-pending")).toContainText("7,70");
  await page.getByTestId("pos-order-move").click();
  await page.getByTestId("pos-move-target-Mesa 3").click();
  await expect(page.getByText("Mesas juntadas.")).toBeVisible();
  await expect(page.getByTestId("pos-order-pending")).toContainText("9,90");
  await expect(page.getByTestId("pos-kiosk-bar")).toContainText("4 comensales");

  // Al cerrar la caja avisa de la mesa abierta; el informe recoge la propina.
  await page.goto(`/pos/${register.id}/close`);
  await expect(page.getByTestId("pos-close-open-orders")).toContainText("1 mesa abierta");
  await expect(page.getByTestId("pos-session-report")).toContainText("40,70");
  await expect(page.getByTestId("pos-tips")).toContainText("1,02");
});
