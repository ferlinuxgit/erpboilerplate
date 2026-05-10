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
  await expect(page.getByRole("heading", { name: "Operaciones de stock" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alertas de stock mínimo" })).toBeVisible();

  const alertsSection = page.getByRole("region", { name: "Alertas de stock mínimo" });
  const lowStockLink = alertsSection.getByRole("link").filter({ hasText: item.name });
  await expect(lowStockLink).toContainText("Sin almacén");
  await expect(lowStockLink).toHaveAttribute("href", /#stock-/);
  await lowStockLink.click();

  const operationForm = page.locator("form").first();
  await operationForm.getByLabel("Tipo de operación").selectOption("ADJUSTMENT");
  await operationForm.getByLabel("Producto").selectOption(item.id);
  await operationForm.getByLabel("Almacén / ubicación origen").selectOption(warehouse.id);
  await operationForm.getByLabel("Cantidad").fill("7.5");
  await operationForm.getByLabel("Fecha").fill("2026-05-09T10:30");
  await operationForm.getByLabel("Motivo").fill("Conteo físico E2E");
  await operationForm.getByLabel("Referencia").fill(`CNT-${runId}`);
  await operationForm.getByRole("button", { name: "Registrar movimiento" }).click();

  await expect(page.getByText("Movimiento de stock registrado. Datos actualizados.")).toBeVisible();

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
  await expect(historySection.getByText("No hay movimientos para los filtros seleccionados.")).toBeVisible();
  await historySection.getByLabel("Tipo").selectOption("ADJUSTMENT");
  await expect(historySection.getByRole("row").filter({ hasText: item.name })).toBeVisible();
});
