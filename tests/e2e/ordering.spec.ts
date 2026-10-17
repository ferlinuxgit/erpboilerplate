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

test("Sala: modificadores con suplemento, menú del día con platos a elegir y marchar por tiempos", async ({ browser, page }) => {
  test.setTimeout(180_000);
  await registerAndSignIn(page, "Comandas E2E");
  await completeOnboarding(page, "Asador Comandas E2E S.L.");

  await api(page, "PUT", "/api/modules", { moduleId: "pos", enabled: true });
  await api(page, "PUT", "/api/modules", { moduleId: "hospitality", enabled: true });
  const taxes = await api<Array<{ id: string; rate: string; kind: string; operation: string }>>(page, "GET", "/api/taxes");
  const vat10 = taxes.find((entry) => Number(entry.rate) === 10 && entry.kind === "VAT" && entry.operation === "ADD")!;
  const kitchen = await postJson<{ id: string }>(page, "/api/item-categories", { code: "COC", name: "Cocina" });
  const drinks = await postJson<{ id: string }>(page, "/api/item-categories", { code: "BEB", name: "Bebidas" });
  const item = (name: string, sku: string, salePrice: number, categoryId: string) => postJson<{ id: string }>(page, "/api/items", { name, sku, salePrice, isService: true, categoryId, defaultTaxId: vat10.id });
  const entrecot = await item("Entrecot", "ENTR", 18.18, kitchen.id); // 20,00 € con IVA
  const sopa = await item("Sopa", "SOPA", 5, kitchen.id);
  const ensalada = await item("Ensalada", "ENSA", 6, kitchen.id);
  const pollo = await item("Pollo", "POLL", 9, kitchen.id);
  const flan = await item("Flan", "FLAN", 3, kitchen.id);
  const menu = await item("Menú del día", "MENU", 13.18, kitchen.id); // 14,50 € con IVA
  await item("Caña", "CANA", 2, drinks.id);
  await api(page, "PUT", "/api/pos/hospitality/stations", { entries: [{ categoryId: kitchen.id, station: "KITCHEN" }, { categoryId: drinks.id, station: "BAR" }] });
  const register = await postJson<{ id: string }>(page, "/api/pos/registers", { name: "Comedor", seriesCode: "M", seriesPrefix: "M", simplifiedLimit: 400, mode: "TABLES" });
  const area = await postJson<{ id: string }>(page, "/api/pos/hospitality/areas", { name: "Comedor" });
  await postJson(page, "/api/pos/hospitality/tables", { areaId: area.id, prefix: "Mesa", from: 1, to: 2, seats: 4 });

  // Modificador obligatorio creado desde la configuración.
  await page.goto("/pos/settings#modificadores");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("pos-modifier-group-new").click();
  const dialog = page.getByTestId("pos-modifier-dialog");
  await dialog.getByLabel("Nombre").fill("Punto de la carne");
  await dialog.getByRole("checkbox", { name: "Obligatorio" }).click();
  await dialog.getByLabel("Opción 1", { exact: true }).fill("Poco hecho");
  await dialog.getByLabel("Opción 2", { exact: true }).fill("Al punto");
  await dialog.getByRole("button", { name: "Opción", exact: true }).click();
  await dialog.getByLabel("Opción 3", { exact: true }).fill("Muy hecho");
  await dialog.getByLabel("Buscar producto").fill("Entre");
  await dialog.getByRole("button", { name: /^Entrecot/ }).click();
  await dialog.getByTestId("pos-modifier-save").click();
  await expect(page.getByText("Modificadores guardados.")).toBeVisible();
  await expect(page.getByTestId("pos-modifier-group-Punto de la carne")).toContainText("En: Entrecot");

  // Extras con suplemento y el menú del día, por API.
  await postJson(page, "/api/pos/hospitality/modifiers", { name: "Extras", minSelect: 0, maxSelect: 2, options: [{ name: "Patatas", price: 1.5 }, { name: "Huevo", price: 1 }], itemIds: [entrecot.id] });
  await api(page, "PUT", `/api/pos/hospitality/set-menus/${menu.id}`, { courses: [
    { name: "Primero", course: 1, choices: [{ itemId: sopa.id, supplement: 0 }, { itemId: ensalada.id, supplement: 0 }] },
    { name: "Segundo", course: 2, choices: [{ itemId: pollo.id, supplement: 0 }, { itemId: entrecot.id, supplement: 3 }] },
    { name: "Postre", course: 4, choices: [{ itemId: flan.id, supplement: 0 }] },
  ] });

  // Abrir caja y mesa.
  await page.goto(`/pos/${register.id}`);
  await page.getByLabel("Fondo de caja").fill("100");
  await page.getByTestId("pos-open-submit").click();
  await expect(page.getByTestId("pos-floor")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByTestId("pos-table-Mesa 1").click();
  await page.getByTestId("pos-guests-dialog").getByRole("button", { name: "2", exact: true }).click();
  await expect(page.getByTestId("pos-order-screen")).toBeVisible();
  await page.waitForLoadState("networkidle");

  // Una caña (barra, sin tiempo).
  await page.getByTestId("pos-item-CANA").click();

  // Entrecot de segundo: punto obligatorio y patatas (+1,50).
  await page.getByTestId("pos-course-2").click();
  await page.getByTestId("pos-item-ENTR").click();
  const options = page.getByTestId("pos-product-options");
  await expect(options.getByTestId("pos-product-options-add")).toBeDisabled();
  await options.getByTestId("pos-modifier-Al punto").click();
  await options.getByTestId("pos-modifier-Patatas").click();
  await expect(options.getByTestId("pos-product-options-add")).toContainText("21,50");
  await options.getByTestId("pos-product-options-add").click();
  await expect(page.getByTestId("pos-order-lines")).toContainText("Entrecot · Al punto, Patatas");

  // Menú del día: sopa, entrecot (+3 €) y flan.
  await page.getByTestId("pos-course-1").click();
  await page.getByTestId("pos-item-MENU").click();
  await options.getByTestId("pos-menu-choice-Sopa").click();
  await options.getByTestId("pos-menu-choice-Entrecot").click();
  await expect(options.getByTestId("pos-product-options-add")).toContainText("17,50");
  await options.getByTestId("pos-product-options-add").click();
  await expect(page.getByTestId("pos-order-lines")).toContainText("Menú del día");
  await expect(page.getByTestId("pos-order-lines")).toContainText("Flan");
  await expect(page.getByTestId("pos-order-pending")).toContainText("41,19");

  // Enviar: salen la caña y la sopa; segundos y postre esperan.
  await page.getByTestId("pos-order-send").click();
  await expect(page.getByText(/3 en espera hasta «Marchar»/)).toBeVisible();
  await expect(page.getByTestId("pos-order-fire")).toHaveText(/Marchar segundos/);

  const kitchenPage = await browser.newPage({ storageState: await page.context().storageState() });
  await kitchenPage.goto("/pos/kitchen");
  const batch = kitchenPage.getByTestId("pos-kitchen-batch-Mesa 1");
  await expect(batch.getByTestId("pos-kitchen-line")).toHaveCount(1);
  await expect(batch.getByTestId("pos-kitchen-line")).toContainText("Sopa");
  await expect(batch.getByTestId("pos-kitchen-held")).toContainText("Entrecot · Al punto, Patatas");
  await expect(batch.getByTestId("pos-kitchen-held")).toContainText("Flan");

  // Marchar segundos: cocina los ve resaltados; el postre sigue esperando.
  await page.getByTestId("pos-order-fire").click();
  await expect(page.getByText("Marchan los segundos (2).")).toBeVisible();
  await kitchenPage.reload();
  await kitchenPage.waitForLoadState("networkidle");
  await expect(batch.getByTestId("pos-kitchen-fired")).toHaveCount(2);
  await expect(batch.getByTestId("pos-kitchen-held")).toContainText("Flan");
  await expect(batch.getByTestId("pos-kitchen-held")).not.toContainText("Entrecot");
  await expect(page.getByTestId("pos-order-fire")).toHaveText(/Marchar postres/);
  await page.getByTestId("pos-order-fire").click();
  await expect(page.getByText("Marchan los postres (1).")).toBeVisible();
  await kitchenPage.reload();
  await kitchenPage.waitForLoadState("networkidle");
  await expect(batch.getByTestId("pos-kitchen-held")).toHaveCount(0);
  await kitchenPage.close();

  // Cobrar todo: el menú con sus platos a 0 € cierra la mesa.
  await page.getByTestId("pos-order-charge").click();
  // 41,19 € en PVP; al 10 % no hay bases exactas para esa suma y el ticket cobra 41,18 (nunca de más).
  await expect(page.getByTestId("pos-split-amount")).toContainText("41,18");
  await page.getByTestId("pos-split-continue").click();
  await page.getByRole("button", { name: "Exacto" }).click();
  await page.getByTestId("pos-pay-confirm").click();
  await expect(page.getByTestId("pos-order-closed")).toContainText("Mesa 1 cobrada");
});
