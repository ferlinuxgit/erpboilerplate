import { expect, test } from "@playwright/test";

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
