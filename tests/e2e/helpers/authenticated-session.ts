import { expect, type Page } from "@playwright/test";

type TestUser = {
  email: string;
  password: string;
};

export async function registerAndSignIn(page: Page, prefix: string): Promise<TestUser> {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const slug = prefix.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const user = {
    email: `${slug}-${runId}@example.test`,
    password: "Password123!",
  };

  const response = await page.request.post("/api/auth/register", {
    data: {
      name: prefix,
      email: user.email,
      password: user.password,
    },
  });

  expect(response.ok()).toBeTruthy();

  await page.goto("/dashboard");
  await expect(page.getByText("Vista general").first()).toBeVisible();

  return user;
}

export async function signIn(page: Page, user: TestUser) {
  const response = await page.request.post("/api/auth/login", {
    data: {
      email: user.email,
      password: user.password,
    },
  });

  expect(response.ok()).toBeTruthy();

  await page.goto("/dashboard");
  await expect(page.getByText("Vista general").first()).toBeVisible();
}

/**
 * Runs the setup wizard ("Puesta en marcha") with valid Spanish fiscal data. The business
 * type is "Productos y servicios" so every module stays in the navigation for later steps.
 */
export async function completeOnboarding(page: Page, legalName: string, options: { vatNumber?: string } = {}) {
  await page.goto("/onboarding");
  await expect(page.getByText("Paso 1 de 4")).toBeVisible();
  await page.getByLabel("Nombre o razón social").fill(legalName);
  await page.getByLabel("NIF/CIF").fill(options.vatNumber ?? "B12345674");
  await page.getByRole("radio", { name: /Productos y servicios/ }).check();
  await page.getByRole("button", { name: "Guardar y seguir" }).click();

  await expect(page.getByText("Paso 2 de 4")).toBeVisible();
  await page.getByLabel("Dirección fiscal").fill("Calle Mayor 1");
  await page.getByLabel("Código postal").fill("28013");
  await page.getByLabel("Ciudad").fill("Madrid");
  await page.getByLabel("Provincia").fill("Madrid");
  await page.getByRole("button", { name: "Guardar y seguir" }).click();

  // Saving the invoice series applies the chart of accounts the first time: allow it some time.
  await expect(page.getByText("Paso 3 de 4")).toBeVisible();
  await expect(page.getByLabel("Prefijo de tus facturas")).toHaveValue("FA");
  await page.getByRole("button", { name: "Guardar y seguir" }).click();

  await expect(page.getByText("Paso 4 de 4")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Finalizar sin invitar" }).click();
  await expect(page.getByRole("heading", { name: "Tu empresa está lista para facturar" })).toBeVisible({ timeout: 30_000 });
}
