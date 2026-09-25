import { expect, test } from "@playwright/test";

import { postJson } from "./helpers/api-client";
import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

test("crear ajuste desde inventario actualiza stock e historial filtrable", async ({ page }) => {
  const runId = Date.now();
  await registerAndSignIn(page, "Inventory Operations E2E");
  await completeOnboarding(page, `Inventario E2E ${runId} S.L.`);

  const item = await postJson<{ id: string; name: string; sku: string }>(page, "/api/items", {
    name: `Producto ajuste ${runId}`,
    sku: `ADJ-${runId}`,
  });
  const warehouse = await postJson<{ id: string; name: string; code: string }>(page, "/api/warehouses", {
    name: `Almacén ajuste ${runId}`,
    code: `AJ-${runId}`,
  });

  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: "Alertas de stock mínimo" })).toBeVisible();

  const alertsSection = page.getByRole("region", { name: "Alertas de stock mínimo" });
  const lowStockLink = alertsSection.getByRole("link").filter({ hasText: item.name });
  await expect(lowStockLink).toContainText("Sin almacén");
  await expect(lowStockLink).toHaveAttribute("href", /#stock-/);
  await page.getByRole("link", { name: "Nuevo movimiento" }).click();
  await expect(page).toHaveURL(/\/inventory\/movements\/new$/);
  await expect(page.getByRole("heading", { name: "Nuevo movimiento" })).toBeVisible();

  const operationForm = page.locator("form").first();
  await operationForm.getByLabel("Tipo de operación").selectOption("ADJUSTMENT");
  await operationForm.getByLabel("Producto").selectOption(item.id);
  await operationForm.getByLabel("Almacén / ubicación origen").selectOption(warehouse.id);
  await operationForm.getByLabel("Cantidad").fill("7.5");
  await operationForm.getByLabel("Fecha").fill("2026-05-09T10:30");
  await operationForm.getByLabel("Motivo").fill("Conteo físico E2E");
  await operationForm.getByLabel("Referencia").fill(`CNT-${runId}`);
  await operationForm.getByRole("button", { name: "Registrar movimiento" }).click();

  // The stock movement write plus the redirect can exceed 5s on cold CI dev compiles.
  await expect(page).toHaveURL(/\/inventory$/, { timeout: 20_000 });

  const stockSection = page.getByRole("region", { name: "Stock por producto y almacén" });
  const stockRow = stockSection.getByRole("row").filter({ hasText: item.name }).filter({ hasText: warehouse.name });
  await expect(stockRow).toContainText("7,5");

  const historySection = page.getByRole("region", { name: "Historial de movimientos" });
  await expect(historySection.getByRole("row").filter({ hasText: item.name }).filter({ hasText: "Conteo físico E2E" })).toContainText(
    `CNT-${runId}`,
  );

  await historySection.getByLabel("Buscar").fill(`CNT-${runId}`);
  await expect(historySection.getByRole("row").filter({ hasText: item.name })).toBeVisible();
  await historySection.getByLabel("Tipo").selectOption("IN");
  await expect(historySection.getByRole("cell", { name: "No hay movimientos para los filtros seleccionados." })).toBeVisible();
  await historySection.getByLabel("Tipo").selectOption("ADJUSTMENT");
  await expect(historySection.getByRole("row").filter({ hasText: item.name })).toBeVisible();
});

test("hoja de recuento calcula diferencias y registra todos los ajustes de una vez", async ({ page }) => {
  const runId = Date.now();
  await registerAndSignIn(page, "Inventory Count E2E");
  await completeOnboarding(page, `Recuento E2E ${runId} S.L.`);

  const item = await postJson<{ id: string; name: string }>(page, "/api/items", { name: `Producto recuento ${runId}`, sku: `CNT-${runId}` });
  const warehouse = await postJson<{ id: string; name: string }>(page, "/api/warehouses", { name: `Almacén recuento ${runId}`, code: `RC-${runId}` });
  await postJson(page, "/api/stock-movements", {
    itemId: item.id,
    warehouseId: warehouse.id,
    movementType: "IN",
    quantity: "10",
    movedAt: "2026-05-01T10:00",
    reason: "Stock inicial E2E",
    reference: `INI-${runId}`,
  });

  // El formulario de movimiento enseña el stock actual y no propone una cantidad por defecto.
  await page.goto(`/inventory/movements/new?itemId=${item.id}&warehouseId=${warehouse.id}`);
  await expect(page.getByTestId("stock-movement-current")).toContainText("Stock actual en este almacén: 10");
  await expect(page.getByLabel("Cantidad")).toHaveValue("");

  await page.goto("/inventory/count");
  await expect(page.getByRole("heading", { name: "Recuento de inventario" })).toBeVisible();
  await page.getByLabel("Almacén que cuentas").selectOption(warehouse.id);
  const row = page.getByRole("row").filter({ hasText: item.name });
  await expect(row.getByRole("cell").first()).toHaveText("10");
  await row.getByLabel(`Cantidad contada de ${item.name}`).fill("7");
  await expect(row.getByRole("cell").last()).toHaveText("-3");

  await page.getByRole("button", { name: "Revisar y registrar recuento" }).click();
  const dialog = page.getByRole("dialog", { name: "Registrar recuento" });
  await expect(dialog).toContainText("10 → 7 (-3)");
  await dialog.getByRole("button", { name: "Registrar recuento" }).click();

  // Tras registrar se vuelve al control de stock filtrado por la referencia del recuento.
  await expect(page).toHaveURL(/\/inventory\?q=RECUENTO-/, { timeout: 20_000 });
  const stockRow = page
    .getByRole("region", { name: "Stock por producto y almacén" })
    .getByRole("row")
    .filter({ hasText: item.name })
    .filter({ hasText: warehouse.name });
  await expect(stockRow.getByRole("cell").nth(2)).toHaveText("7");
  const historyRow = page.getByRole("region", { name: "Historial de movimientos" }).getByRole("row").filter({ hasText: "Recuento físico" });
  await expect(historyRow).toContainText("RECUENTO-");
  await expect(historyRow.getByRole("cell").nth(4)).toHaveText("-3");
});
