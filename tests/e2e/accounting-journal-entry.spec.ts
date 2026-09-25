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
  await page.goto("/accounting");
  await page.getByRole("link", { name: "Nueva cuenta" }).click();
  await expect(page).toHaveURL(/\/accounting\/accounts\/new$/);
  await page.getByLabel("Código").fill(code);
  await page.getByLabel("Nombre").fill(name);
  await page.getByLabel("Tipo").selectOption(type);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page).toHaveURL(/\/accounting$/);
  await expect(page.getByText(new RegExp(`${code}.*${name}`)).first()).toBeVisible();
}

/** Elige una cuenta en el selector con buscador (combobox) de la línea indicada. */
async function pickAccount(page: Page, line: number, code: string, name: string) {
  const picker = page.getByLabel(`Cuenta de la línea ${line}`);
  await picker.fill(code);
  await page.getByRole("option", { name: new RegExp(`${code} · ${name}`) }).click();
  await expect(picker).toHaveValue(`${code} · ${name}`);
}

test("journal entry form creates a balanced multi-line entry and exposes ledger impact", async ({ page }, testInfo) => {
  await registerAndSignIn(page, `accounting-${testInfo.workerIndex}-${Date.now()}@example.com`);
  await page.goto("/accounting");

  await createAccount(page, "1000", "Caja", "ASSET");
  await createAccount(page, "7000", "Ventas", "REVENUE");
  await createAccount(page, "4770", "IVA repercutido", "LIABILITY");

  await expect(page.getByRole("link", { name: "Ver mayor" }).first()).toBeVisible();
  await page.goto("/accounting/entries/new");
  const dateInput = page.getByLabel("Fecha");
  // La fecha llega rellenada con la de hoy; se cambia a una fecha concreta del ejercicio.
  await expect(dateInput).not.toHaveValue("");
  await dateInput.fill("2026-05-09");
  await page.getByLabel("Referencia").fill("E2E-BALANCE");
  await pickAccount(page, 1, "1000", "Caja");
  await page.getByLabel("Debe").first().fill("100");
  await pickAccount(page, 2, "7000", "Ventas");
  await page.getByLabel("Haber").nth(1).fill("80");
  await page.getByRole("button", { name: "Añadir línea" }).click();
  await pickAccount(page, 3, "4770", "IVA repercutido");
  await page.getByLabel("Haber").nth(2).fill("19");

  await expect(page.getByText(/\| Descuadrado/)).toBeVisible();
  await expect(page.getByText(/Diferencia: 1,00/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Crear asiento" })).toBeDisabled();
  // El formulario explica por qué no se puede guardar.
  await expect(page.getByText(/Descuadre de 1,00 €: el debe supera al haber/)).toBeVisible();

  // Importe con formato español: se acepta la coma decimal.
  await page.getByLabel("Haber").nth(2).fill("20,00");
  // Reassert the required date after adding dynamic lines; this also guards
  // against a pre-hydration edit being replaced by the controlled input state.
  await dateInput.fill("2026-05-09");
  await expect(dateInput).toHaveValue("2026-05-09");
  await expect(page.getByText(/\| Cuadrado/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Crear asiento" })).toBeEnabled();
  await page.getByRole("button", { name: "Crear asiento" }).click();

  await expect(page.getByText(/Asiento .* creado/)).toBeVisible();
  await expect(page.getByText(/E2E-BALANCE/)).toBeVisible();
  await page.getByRole("link", { name: "Ver mayor" }).first().click();
  await expect(page.getByText(/E2E-BALANCE/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver asiento E2E-BALANCE" })).toBeVisible();
});
