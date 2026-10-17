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

test("Escandallos: coste y food cost del plato y, al cobrar la mesa, salen sus ingredientes del almacén", async ({ page }) => {
  test.setTimeout(180_000);
  await registerAndSignIn(page, "Escandallos E2E");
  await completeOnboarding(page, "Hamburguesería Escandallo E2E S.L.");

  for (const moduleId of ["pos", "hospitality", "inventory"]) await api(page, "PUT", "/api/modules", { moduleId, enabled: true });
  const taxes = await api<Array<{ id: string; rate: string; kind: string; operation: string }>>(page, "GET", "/api/taxes");
  const vat10 = taxes.find((entry) => Number(entry.rate) === 10 && entry.kind === "VAT" && entry.operation === "ADD")!;
  const kitchen = await postJson<{ id: string }>(page, "/api/item-categories", { code: "COC", name: "Cocina" });
  const pan = await postJson<{ id: string }>(page, "/api/items", { name: "Pan de hamburguesa", sku: "PAN", costPrice: 0.4, defaultTaxId: vat10.id });
  const carne = await postJson<{ id: string }>(page, "/api/items", { name: "Carne picada (kg)", sku: "CARNE", costPrice: 12, defaultTaxId: vat10.id });
  const burger = await postJson<{ id: string }>(page, "/api/items", { name: "Hamburguesa", sku: "BURG", salePrice: 9.09, isService: true, categoryId: kitchen.id, defaultTaxId: vat10.id }); // 10,00 € con IVA
  const warehouse = await postJson<{ id: string }>(page, "/api/warehouses", { name: "Cocina", code: "COC" });
  for (const [itemId, quantity] of [[pan.id, "10"], [carne.id, "5"]] as const) {
    await postJson(page, "/api/stock-movements", { itemId, warehouseId: warehouse.id, movementType: "IN", quantity, movedAt: "2026-05-01T10:00", reason: "Stock inicial", reference: `INI-${itemId}` });
  }
  await api(page, "PUT", "/api/pos/hospitality/stations", { entries: [{ categoryId: kitchen.id, station: "KITCHEN" }] });
  const register = await postJson<{ id: string }>(page, "/api/pos/registers", { name: "Barra", seriesCode: "H", seriesPrefix: "H", simplifiedLimit: 400, mode: "TABLES", warehouseId: warehouse.id });
  const area = await postJson<{ id: string }>(page, "/api/pos/hospitality/areas", { name: "Local" });
  await postJson(page, "/api/pos/hospitality/tables", { areaId: area.id, prefix: "Mesa", from: 1, to: 1, seats: 4 });

  // Escandallo: 1 pan y 0,18 kg de carne = 0,40 + 2,16 = 2,56 € por ración.
  await page.goto("/pos/recipes");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("pos-recipe-item").selectOption(burger.id);
  await page.getByTestId("pos-recipe-new").click();
  const dialog = page.getByTestId("pos-recipe-dialog");
  await dialog.getByLabel("Buscar ingrediente").fill("pan");
  await dialog.getByRole("button", { name: /^Pan de hamburguesa/ }).click();
  await dialog.getByLabel("Cantidad de Pan de hamburguesa").fill("1");
  await dialog.getByLabel("Buscar ingrediente").fill("carne");
  await dialog.getByRole("button", { name: /^Carne picada/ }).click();
  await dialog.getByLabel("Cantidad de Carne picada (kg)").fill("0,18");
  await expect(dialog.getByTestId("pos-recipe-dialog-cost")).toContainText("2,56");
  await dialog.getByTestId("pos-recipe-save").click();
  await expect(page.getByText("Escandallo guardado.")).toBeVisible();
  const row = page.getByTestId("pos-recipe-Hamburguesa");
  await expect(row.getByTestId("pos-recipe-cost")).toContainText("2,56");
  // 2,56 / 9,09 sin IVA = 28,2 %
  await expect(row.getByTestId("pos-recipe-food-cost")).toHaveText("28,2 %");

  // Un plato no puede contenerse a sí mismo.
  await expect(api(page, "PUT", `/api/pos/recipes/${pan.id}`, { lines: [{ ingredientItemId: burger.id, quantity: 1 }] })).rejects.toThrow(/bucle/);

  // Mesa con dos hamburguesas, cobrada.
  await page.goto(`/pos/${register.id}`);
  await page.getByLabel("Fondo de caja").fill("50");
  await page.getByTestId("pos-open-submit").click();
  await expect(page.getByTestId("pos-floor")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByTestId("pos-table-Mesa 1").click();
  await page.getByTestId("pos-guests-dialog").getByRole("button", { name: "2", exact: true }).click();
  await expect(page.getByTestId("pos-order-screen")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByTestId("pos-item-BURG").click();
  await page.getByTestId("pos-item-BURG").click();
  await expect(page.getByTestId("pos-order-pending")).toContainText("20,00");
  await page.getByTestId("pos-order-send").click();
  await expect(page.getByText(/Enviado a cocina/)).toBeVisible();
  await page.getByTestId("pos-order-charge").click();
  await page.getByTestId("pos-split-continue").click();
  await page.getByRole("button", { name: "Exacto" }).click();
  await page.getByTestId("pos-pay-confirm").click();
  await expect(page.getByTestId("pos-order-closed")).toContainText("Mesa 1 cobrada");

  // Del almacén han salido 2 panes y 0,36 kg de carne (no «hamburguesas»).
  const stock = await api<Array<{ itemId: string; warehouseId: string | null; quantity: string }>>(page, "GET", "/api/inventory");
  const quantity = (itemId: string) => Number(stock.find((entry) => entry.itemId === itemId && entry.warehouseId === warehouse.id)?.quantity ?? 0);
  expect(quantity(pan.id)).toBe(8);
  expect(quantity(carne.id)).toBeCloseTo(4.64, 3);
});
