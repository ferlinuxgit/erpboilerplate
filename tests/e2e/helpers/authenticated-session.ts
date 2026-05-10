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
  await expect(page.getByText("Panel ERP SaaS").first()).toBeVisible();

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
  await expect(page.getByText("Panel ERP SaaS").first()).toBeVisible();
}

export async function completeOnboarding(page: Page, legalName: string) {
  await page.goto("/onboarding");
  await page.getByLabel("Razón social").fill(legalName);
  for (let index = 0; index < 4; index += 1) {
    await page.getByRole("button", { name: "Siguiente" }).click();
  }
  await page.getByRole("button", { name: "Finalizar onboarding" }).click();
  await expect(page.getByRole("heading", { name: "Onboarding completado" })).toBeVisible();
}
