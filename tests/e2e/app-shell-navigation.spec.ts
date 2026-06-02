import { expect, test } from "@playwright/test";

import { registerAndSignIn } from "./helpers/authenticated-session";

const routes = [
  { path: "/dashboard", label: "Panel" },
  { path: "/customers", label: "Clientes" },
  { path: "/accounting", label: "Contabilidad" },
] as const;

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

for (const viewport of viewports) {
  test.describe(`app shell navigation ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const route of routes) {
      test(`${route.path} exposes responsive Spanish navigation and active route`, async ({ page }, testInfo) => {
        const safeTitle = testInfo.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
        await registerAndSignIn(page, `shell-${testInfo.workerIndex}-${safeTitle}@example.com`);
        await page.goto(route.path);

        const activeLink = page.getByRole("link", { name: route.label }).and(page.locator("[aria-current='page']"));

        if (viewport.name === "desktop") {
          await expect(page.getByTestId("desktop-sidebar")).toBeVisible();
          await expect(page.getByRole("navigation", { name: "Navegación principal" })).toBeVisible();
          await expect(page.getByText("Operación", { exact: true })).toBeVisible();
          await expect(page.getByText("Administración", { exact: true })).toBeVisible();
          await expect(page.getByTestId("context-switcher-desktop")).toBeVisible();
          await expect(activeLink).toBeVisible();
        } else {
          await expect(page.getByTestId("mobile-topbar")).toBeVisible();
          await expect(page.getByTestId("desktop-sidebar")).toBeHidden();
          await expect(page.getByRole("button", { name: "Abrir navegación" })).toBeVisible();
          await page.getByRole("button", { name: "Abrir navegación" }).click();
          const drawer = page.getByRole("dialog", { name: "Navegación principal" });
          await expect(drawer).toBeVisible();
          await expect(drawer.getByRole("navigation", { name: "Navegación principal" })).toBeVisible();
          await expect(drawer.getByText("Contexto activo", { exact: true })).toBeVisible();
          await expect(activeLink).toBeVisible();
        }

        await testInfo.attach(`${viewport.name}-${route.path.replace("/", "")}-app-shell`, {
          body: await page.screenshot({ caret: "initial", fullPage: true }),
          contentType: "image/png",
        });
      });
    }
  });
}
