import { expect, test } from "@playwright/test";

import { totpCodeAt, totpStep } from "../../src/server/auth/totp";

import { registerAndSignIn } from "./helpers/authenticated-session";

test("contraseña y sesiones: cambiar la contraseña desde Preferencias y ver la sesión actual", async ({ page, playwright, baseURL }) => {
  test.setTimeout(90_000);
  const account = await registerAndSignIn(page, "Account Security");

  await page.goto("/settings/preferences#seguridad");
  await expect(page.getByTestId("user-sessions")).toContainText("Esta sesión");
  await page.getByLabel("Contraseña actual").fill(account.password);
  await page.getByLabel("Contraseña nueva").fill("OtraClave456!");
  await page.getByRole("button", { name: "Cambiar contraseña" }).click();
  await expect(page.getByText(/Contraseña cambiada/)).toBeVisible();

  // La antigua ya no vale y la nueva sí (desde otro navegador).
  const other = await playwright.request.newContext({ baseURL });
  expect((await other.post("/api/auth/login", { data: { email: account.email, password: account.password } })).status()).toBe(401);
  expect((await other.post("/api/auth/login", { data: { email: account.email, password: "OtraClave456!" } })).ok()).toBe(true);
  await other.dispose();
});

test("verificación en dos pasos con app: activar desde Preferencias y entrar con el código", async ({ page, playwright, baseURL }) => {
  test.setTimeout(90_000);
  const account = await registerAndSignIn(page, "Totp Security");

  await page.goto("/settings/preferences#seguridad");
  await page.getByRole("button", { name: "Activar con app" }).click();
  const secret = (await page.getByTestId("totp-secret").innerText()).replace(/\s/g, "");
  const step = totpStep();
  await page.getByLabel("Código de la app").fill(totpCodeAt(secret, step));
  await page.getByRole("button", { name: "Confirmar y activar" }).click();
  await expect(page.getByTestId("totp-recovery-codes").locator("li")).toHaveCount(10);
  const recovery = await page.getByTestId("totp-recovery-codes").locator("li").first().innerText();

  // Desde otro navegador: la contraseña sola ya no basta; con el código de la app (o uno de recuperación) sí.
  const other = await playwright.request.newContext({ baseURL });
  const login = async () => {
    const response = await other.post("/api/auth/login", { data: { email: account.email, password: account.password } });
    expect(response.status()).toBe(202);
    const body = (await response.json()) as { challengeId: string; method: string };
    expect(body.method).toBe("totp");
    return body.challengeId;
  };
  const challengeId = await login();
  expect((await other.post("/api/auth/verify-two-factor", { data: { challengeId, code: totpCodeAt(secret, step) } })).status()).toBe(401);
  expect((await other.post("/api/auth/verify-two-factor", { data: { challengeId, code: totpCodeAt(secret, step + 1) } })).ok()).toBe(true);
  expect((await other.post("/api/auth/verify-two-factor", { data: { challengeId: await login(), code: recovery } })).ok()).toBe(true);
  await other.dispose();
});
