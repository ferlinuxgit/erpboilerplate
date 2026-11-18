import { expect, test } from "@playwright/test";

import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

test("plan y facturación: plan base de 9 €, módulos con precio y créditos de IA", async ({ page }) => {
  test.setTimeout(120_000);
  await registerAndSignIn(page, "Billing E2E");
  await completeOnboarding(page, "Empresa facturación S.L.");

  await page.goto("/billing");
  await expect(page.getByRole("heading", { name: "Plan y facturación", level: 1 })).toBeVisible();
  await expect(page.getByText("Contabilidad y facturación", { exact: true })).toBeVisible();
  // Créditos de bienvenida para probar la lectura de facturas con IA.
  await expect(page.getByTestId("billing-credits")).toHaveText("25");

  const modules = page.getByTestId("billing-modules");
  for (const name of ["Presupuestos y pedidos", "Pedidos de compra", "Inventario y almacenes", "Banca y conciliación", "Lectura de facturas con IA"]) {
    const box = modules.getByRole("checkbox", { name: new RegExp(name) });
    if (await box.isChecked()) await box.uncheck();
  }
  await expect(page.getByTestId("billing-total")).toHaveText("9 €");
  // Hostelería necesita el TPV: se marca con ella. 9 + 9 + 12 = 30 €.
  await modules.getByRole("checkbox", { name: /Hostelería/ }).check();
  await expect(modules.getByRole("checkbox", { name: /^TPV/ })).toBeChecked();
  await expect(page.getByTestId("billing-total")).toHaveText("30 €");
  await modules.getByRole("checkbox", { name: /^TPV/ }).uncheck();
  await expect(modules.getByRole("checkbox", { name: /Hostelería/ })).not.toBeChecked();
  await expect(page.getByTestId("billing-total")).toHaveText("9 €");

  // Configuración › Módulos muestra el precio de cada uno.
  await page.goto("/settings/modules");
  await expect(page.getByTestId("module-card-pos")).toContainText("+9 €/mes");
});
