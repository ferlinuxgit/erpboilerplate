import { expect, test, type Page } from "@playwright/test";

import { postJson } from "./helpers/api-client";
import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

// Móvil (iPhone 13/14): táctil y 390 px de ancho.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

/** La página nunca debe desbordarse en horizontal (contenido cortado a la derecha). */
async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "la página se desborda en horizontal").toBeLessThanOrEqual(1);
}

test("crear y emitir una factura desde el móvil", async ({ page }) => {
  test.setTimeout(120_000);
  const runId = Date.now();
  const customerName = `Construcciones Móvil ${runId}`;
  await registerAndSignIn(page, "Mobile Invoice E2E");
  await completeOnboarding(page, "Empresa móvil E2E S.L.");
  await postJson(page, "/api/customers", {
    name: customerName,
    taxId: "B12345674",
    address: "Calle Mayor 1",
    postalCode: "28001",
    city: "Madrid",
    province: "Madrid",
    countryCode: "ES",
    email: `movil-${runId}@example.test`,
  });

  await page.goto("/invoices/new");
  await page.waitForLoadState("networkidle");
  await expectNoHorizontalOverflow(page);
  const stickyTotal = page.getByTestId("invoice-sticky-total");
  await expect(stickyTotal).toBeInViewport();
  await expect(stickyTotal).toContainText("0,00");

  // Cliente: un solo botón ancho; el buscador encuentra también por CIF/NIF.
  await page.getByRole("button", { name: "Buscar cliente" }).tap();
  await page.getByLabel("Número, nombre, email o teléfono").fill(customerName);
  await page.getByRole("button", { name: new RegExp(customerName) }).tap();
  await expect(page.getByRole("button", { name: "Cambiar cliente" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Total 0: aviso claro y foco en el precio, sin abrir la confirmación.
  await page.getByTestId("invoice-line-1-description").fill("Reforma de cocina");
  await page.getByTestId("invoice-create-submit").tap();
  await expect(page.getByText("Indica el precio de al menos una línea").first()).toBeVisible();
  await expect(page.getByTestId("invoice-line-1-unit-price")).toBeFocused();
  await expect(page.getByRole("dialog", { name: "¿Emitir la factura?" })).toBeHidden();

  // Al tocar el precio «0,00» se sustituye al teclear; el total fijo se actualiza.
  await page.getByTestId("invoice-line-1-unit-price").tap();
  await page.keyboard.type("1200");
  await page.getByRole("button", { name: "Añadir otra línea" }).tap();
  await page.getByTestId("invoice-line-2-description").fill("Desplazamiento");
  await page.getByTestId("invoice-line-2-unit-price").tap();
  await page.keyboard.type("45,5");
  await page.getByTestId("invoice-line-2-description").tap();
  // (1.200 + 45,50) × 1,21 = 1.507,06 €
  await expect(stickyTotal).toContainText("1507,06");
  await expect(stickyTotal).toBeInViewport();
  await expectNoHorizontalOverflow(page);

  await page.getByTestId("invoice-create-submit").tap();
  await page.getByTestId("invoice-issue-confirm").tap();
  await page.waitForURL((url) => /\/invoices\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith("/new"), { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: /^FA/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Ficha: acciones secundarias en «Más…».
  await expect(page.getByTestId("invoice-create-credit-note")).toBeHidden();
  await page.getByTestId("invoice-more-actions").tap();
  await expect(page.getByRole("menuitem", { name: "Crear rectificativa" })).toBeVisible();

  // Listado: filtros plegados hasta pulsar «Filtrar»; la factura se ve sin desplazar los filtros.
  await page.goto("/invoices");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("combobox", { name: /Estado de cobro/i })).toBeHidden();
  await page.getByRole("button", { name: /Filtrar/ }).tap();
  await expect(page.getByRole("combobox", { name: /Estado de cobro/i })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("gastos y pedidos de compra en el móvil: tarjetas completas y total a la vista", async ({ page }) => {
  test.setTimeout(120_000);
  const runId = Date.now();
  await registerAndSignIn(page, "Mobile Expenses E2E");
  await completeOnboarding(page, "Empresa gastos móvil E2E S.L.");
  const expense = await postJson<{ id: string }>(page, "/api/expenses", {
    supplierName: `Suministros Eléctricos del Levante Mediterráneo y Asociados ${runId} SL`,
    supplierTaxId: "B12345674",
    supplierDocumentNumber: `SUM-${runId}`,
    issueDate: new Date().toISOString(),
    lines: [{ description: "Material eléctrico", quantity: 1, unitPrice: 300, taxRate: 21 }],
  });

  // Un proveedor muy largo no ensancha la tarjeta: la etiqueta de estado queda dentro de la pantalla.
  await page.goto("/expenses");
  await page.waitForLoadState("networkidle");
  await expectNoHorizontalOverflow(page);
  const card = page.getByTestId("resource-list-mobile").locator("article").first();
  const badge = card.getByText("Pendiente", { exact: true }).first();
  const badgeBox = await badge.boundingBox();
  expect(badgeBox, "etiqueta de estado visible").not.toBeNull();
  expect(badgeBox!.x + badgeBox!.width).toBeLessThanOrEqual(390);

  await page.goto(`/expenses/${expense.id}`);
  await page.waitForLoadState("networkidle");
  await expectNoHorizontalOverflow(page);

  // Pedido de compra: el total estimado acompaña a la barra fija del formulario.
  await page.goto("/purchases/new");
  await page.waitForLoadState("networkidle");
  const summary = page.locator('[data-slot="form-actions-summary"]');
  await expect(summary).toBeInViewport();
  await expect(summary).toContainText("Total estimado");
  await expectNoHorizontalOverflow(page);
});
