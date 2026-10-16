import { expect, test } from "@playwright/test";

import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

test("módulos: desactivar oculta el menú y bloquea páginas y API; activar lo recupera sin perder nada", async ({ page }) => {
  test.setTimeout(90_000);
  await registerAndSignIn(page, "Modules E2E");
  await completeOnboarding(page, "Empresa módulos E2E S.L.");

  const mainNav = page.getByRole("navigation", { name: "Navegación principal" }).first();
  await page.goto("/settings/modules");
  const inventoryCard = page.getByTestId("module-card-inventory");
  const inventorySwitch = inventoryCard.getByRole("switch");
  await expect(inventorySwitch).toBeChecked();
  // CRM y TPV vienen desactivados: son de nicho.
  await expect(page.getByTestId("module-card-crm").getByRole("switch")).not.toBeChecked();
  await expect(page.getByTestId("module-card-pos").getByRole("switch")).not.toBeChecked();
  await expect(mainNav.locator('a[href="/inventory"]')).toHaveCount(1);

  await inventorySwitch.click();
  await expect(inventorySwitch).not.toBeChecked();
  await expect(inventoryCard).toContainText("Desactivado");
  await expect(mainNav.locator('a[href="/inventory"]')).toHaveCount(0);
  // El catálogo de artículos sigue accesible desde Ventas.
  await expect(mainNav.locator('a[href="/inventory/items"]')).toHaveCount(1);

  // La API del módulo responde 403 con la explicación; el catálogo (núcleo) sigue funcionando.
  const blocked = await page.request.get("/api/inventory");
  expect(blocked.status()).toBe(403);
  expect((await blocked.json()).message).toMatch(/Inventario y almacenes.*no está activado/);
  expect((await page.request.get("/api/items")).ok()).toBe(true);

  // La página lleva a la pantalla del módulo, que permite activarlo y volver a donde se iba.
  await page.goto("/inventory/movements");
  await expect(page).toHaveURL(/\/modules\/inventory\?from=%2Finventory%2Fmovements/);
  await expect(page.getByTestId("module-disabled")).toContainText("Inventario y almacenes");
  await page.getByTestId("activate-module").click();
  await expect(page).toHaveURL(/\/inventory\/movements$/);
  await expect(mainNav.locator('a[href="/inventory"]')).toHaveCount(1);
  expect((await page.request.get("/api/inventory")).ok()).toBe(true);
});
