import { expect, test } from "@playwright/test";

import { registerAndSignIn } from "./helpers/authenticated-session";

test.describe("keyboard-only application operation", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test.beforeEach(async ({ page }, testInfo) => {
    await registerAndSignIn(page, `Keyboard E2E ${testInfo.workerIndex}-${testInfo.title}-${Date.now()}`);
  });

  test("navigates help, focus zones, tabs, command search and module codes", async ({ page }, testInfo) => {
    await page.goto("/customers");

    await page.keyboard.press("F1");
    const helpDialog = page.getByRole("dialog", { name: /KEYBOARD\.EXE/ });
    await expect(helpDialog).toBeVisible();
    await expect(helpDialog).toContainText("G + código");
    await testInfo.attach("keyboard-help-dialog", {
      body: await page.screenshot({ caret: "initial", fullPage: true }),
      contentType: "image/png",
    });
    await page.keyboard.press("Escape");
    await expect(helpDialog).toBeHidden();

    await page.keyboard.press("Alt+1");
    const customersNav = page.getByTestId("nav-link-customers");
    await expect(customersNav).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("nav-link-sales-quotes")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/sales\/quotes$/);

    await page.keyboard.press("Alt+2");
    await expect(page.getByRole("navigation", { name: "Secciones de Comercial" }).getByRole("link", { name: "Presupuestos" })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("navigation", { name: "Secciones de Comercial" }).getByRole("link", { name: "Pedidos", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/sales\/orders$/);

    await page.keyboard.press("Control+k");
    const commandSearch = page.getByPlaceholder("Cliente, factura, nuevo gasto…");
    await expect(commandSearch).toBeFocused();
    await commandSearch.fill("inventario");
    await commandSearch.press("ArrowDown");
    await expect(page.locator("[data-command-item]:focus")).toContainText("Inventario");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/inventory$/);

    await page.keyboard.press("g");
    await page.keyboard.press("3");
    await page.keyboard.press("1");
    await expect(page).toHaveURL(/\/accounting$/);

    await page.keyboard.press("Alt+3");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("creates, filters, selects and opens a customer without pointer input", async ({ page }) => {
    const runId = Date.now();
    const customerName = `Cliente teclado ${runId}`;

    await page.goto("/customers/new");
    await page.getByTestId("customer-name-input").fill(customerName);
    await page.getByTestId("customer-tax-id-input").fill("B12345674");
    await page.getByTestId("customer-address-input").fill("Calle Teclado 1");
    await page.getByTestId("customer-postal-code-input").fill("28013");
    await page.getByTestId("customer-city-input").fill("Madrid");
    await page.getByTestId("customer-province-input").fill("Madrid");
    await page.getByTestId("customer-email-input").fill(`teclado-${runId}@example.test`);
    const phone = page.getByTestId("customer-phone-input");
    await phone.fill("+34 600 123 123");

    const customerResponse = page.waitForResponse(
      (response) => response.url().endsWith("/api/customers") && response.request().method() === "POST",
    );
    await phone.press("Control+Enter");
    expect((await customerResponse).ok()).toBe(true);
    await expect(page).toHaveURL(/\/customers$/);

    const localSearch = page.getByTestId("customers-table").locator("[data-resource-search]");
    await expect(localSearch).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Clientes", exact: true })).toBeVisible();
    await page.keyboard.press("Alt+f");
    await expect(localSearch).toBeFocused();
    await localSearch.fill(customerName);
    await expect(page.getByTestId("customers-table")).toContainText(customerName);
    await localSearch.press("Escape");
    await expect(localSearch).toHaveValue("");

    await localSearch.fill(customerName);
    const row = page.getByTestId("customers-table").locator("tbody tr").first();
    await row.focus();
    await row.press(" ");
    await expect(page.getByTestId("customers-table")).toContainText("1 seleccionados");
    await row.focus();
    await row.press("Enter");
    await expect(page).toHaveURL(/\/customers\/[^/]+$/);
    await expect(page.getByRole("heading", { name: customerName })).toBeVisible();
  });
});

test.describe("keyboard-only mobile drawer operation", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("opens, traverses and closes mobile navigation from the keyboard", async ({ page }) => {
    await registerAndSignIn(page, `Keyboard Mobile E2E ${Date.now()}`);
    await page.goto("/customers");

    await page.keyboard.press("Alt+1");
    const drawer = page.getByRole("dialog", { name: "Navegación principal" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId("nav-link-customers")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(drawer.getByTestId("nav-link-sales-quotes")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/sales\/quotes$/);
    await expect(drawer).toBeHidden();

    await page.keyboard.press("F1");
    await expect(page.getByRole("dialog", { name: /KEYBOARD\.EXE/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Alt+3");
    await expect(page.locator("#main-content")).toBeFocused();
  });
});
