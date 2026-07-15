import { expect, test } from "@playwright/test";

import { registerAndSignIn } from "./helpers/authenticated-session";

test.describe("admin security policy", () => {
  test("admin changes a security setting and sees the audit entry", async ({ page }) => {
    await registerAndSignIn(page, "Security Policy Admin E2E");

    await page.goto("/settings/security");
    await expect(page.getByRole("heading", { name: "Seguridad" })).toBeVisible();

    const currentTimeout = Number(await page.getByLabel("Tiempo de sesión (minutos)").inputValue());
    const timeoutMinutes = `${Number.isFinite(currentTimeout) && currentTimeout >= 5 && currentTimeout < 1440 ? currentTimeout + 1 : 45}`;
    await page.getByLabel("Tiempo de sesión (minutos)").fill(timeoutMinutes);
    await page.getByRole("radio", { name: "Activo", exact: true }).check();
    await page.getByRole("button", { name: "Guardar política" }).click();

    await expect(page.getByText("Política actualizada y auditada.")).toBeVisible();
    await expect(page.getByText(`${timeoutMinutes} minutos`).first()).toBeVisible();

    await page.goto("/settings/audit");
    await expect(page.getByText(/security_policy\.(created|updated)/).first()).toBeVisible();
  });
});
