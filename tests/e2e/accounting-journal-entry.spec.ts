import { expect, type Page, test } from "@playwright/test";

async function registerAndSignIn(page: Page, email: string) {
  const response = await page.request.post("/api/auth/register", {
    data: {
      name: "Playwright Accounting",
      email,
      password: "playwright-e2e-password",
    },
  });

  expect(response.ok()).toBeTruthy();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function createAccount(page: Page, code: string, name: string, type: string) {
  await page.getByPlaceholder("Codigo").fill(code);
  await page.getByPlaceholder("Nombre").fill(name);
  await page.locator("form").filter({ has: page.getByRole("button", { name: "Crear cuenta" }) }).locator("select").selectOption(type);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByText(`${code} - ${name} (${type})`)).toBeVisible();
}

test("journal entry form creates a balanced multi-line entry and exposes ledger impact", async ({ page }, testInfo) => {
  await registerAndSignIn(page, `accounting-${testInfo.workerIndex}-${Date.now()}@example.com`);
  await page.goto("/accounting");

  await createAccount(page, "1000", "Caja", "ASSET");
  await createAccount(page, "7000", "Ventas", "REVENUE");
  await createAccount(page, "4770", "IVA repercutido", "LIABILITY");

  await expect(page.getByRole("link", { name: "Ver mayor" }).first()).toBeVisible();
  await page.getByLabel("Fecha").fill("2026-05-09");
  await page.getByLabel("Referencia").fill("E2E-BALANCE");
  await page.getByLabel("Cuenta linea 1").selectOption({ label: "1000 - Caja" });
  await page.getByLabel("Debe").first().fill("100");
  await page.getByLabel("Cuenta linea 2").selectOption({ label: "7000 - Ventas" });
  await page.getByLabel("Haber").nth(1).fill("80");
  await page.getByRole("button", { name: "Anadir linea" }).click();
  await page.getByLabel("Cuenta linea 3").selectOption({ label: "4770 - IVA repercutido" });
  await page.getByLabel("Haber").nth(2).fill("19");

  await expect(page.getByText(/Desbalanceado/)).toBeVisible();
  await expect(page.getByText(/Diferencia: 1\.00/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Crear asiento" })).toBeDisabled();

  await page.getByLabel("Haber").nth(2).fill("20");
  await expect(page.getByText(/Balanceado/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Crear asiento" })).toBeEnabled();
  await page.getByRole("button", { name: "Crear asiento" }).click();

  await expect(page.getByText(/E2E-BALANCE/)).toBeVisible();
  await page.getByRole("link", { name: "Ver mayor" }).first().click();
  await expect(page.getByText(/E2E-BALANCE/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver asiento E2E-BALANCE" })).toBeVisible();
});
