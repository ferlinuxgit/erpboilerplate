import { expect, type Page, test } from "@playwright/test";

import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

type ModuleSmokeCase = {
  path: string;
  navLabel: string;
  heading: string | RegExp;
  evidence: string | RegExp;
};

const coreModules: ModuleSmokeCase[] = [
  {
    path: "/dashboard",
    navLabel: "Panel",
    heading: "Panel ERP SaaS",
    evidence: /Tenant activo:/,
  },
  {
    path: "/customers",
    navLabel: "Clientes",
    heading: "Clientes",
    evidence: "Listado",
  },
  {
    path: "/invoices",
    navLabel: "Facturas",
    heading: "Facturas",
    evidence: "Listado",
  },
  {
    path: "/purchases",
    navLabel: "Compras",
    heading: "Compras",
    evidence: /pedido de compra/i,
  },
  {
    path: "/inventory",
    navLabel: "Inventario",
    heading: "Control de stock",
    evidence: /histórico/i,
  },
  {
    path: "/accounting",
    navLabel: "Contabilidad",
    heading: "Contabilidad",
    evidence: "Plan contable",
  },
  {
    path: "/treasury",
    navLabel: "Tesorería",
    heading: "Tesorería y Bancos",
    evidence: "Cuentas bancarias",
  },
  {
    path: "/fiscal",
    navLabel: "Fiscal",
    heading: "Fiscalidad España",
    evidence: /modelos 303, 390, 347, 111 y 115/i,
  },
  {
    path: "/reporting",
    navLabel: "Informes",
    heading: "Reporting y BI",
    evidence: /KPIs/i,
  },
  {
    path: "/settings/security",
    navLabel: "Seguridad",
    heading: "Tenant security controls",
    evidence: "Admin controls enabled",
  },
];

async function registerSignInAndSeed(page: Page, runId: string) {
  await registerAndSignIn(page, `Core Smoke E2E ${runId}`);
  await completeOnboarding(page, `Empresa smoke ${runId} S.L.`);
}

test.describe("core product module smoke coverage", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const safeTitle = testInfo.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    await registerSignInAndSeed(page, `${testInfo.workerIndex}-${safeTitle}-${Date.now()}`);
  });

  for (const moduleCase of coreModules) {
    test(`${moduleCase.navLabel} module renders an authenticated smoke surface`, async ({ page }) => {
      await page.goto(moduleCase.path);

      const surface = page.locator("body");
      await expect(surface).toContainText(moduleCase.heading, { timeout: 15_000 });
      await expect(surface).toContainText(moduleCase.evidence);
      const navTestId = `nav-link-${moduleCase.path.replace(/\//g, "-").replace(/^-/, "")}`;
      await expect(page.getByTestId(navTestId).and(page.locator("[aria-current='page']"))).toBeVisible();

      if (moduleCase.path === "/dashboard") {
        const primaryActions = page.getByTestId("dashboard-primary-actions");
        const emptyStates = page.getByTestId("dashboard-empty-states");

        await expect(page.getByTestId("dashboard-metrics")).toBeVisible();
        await expect(primaryActions).toBeVisible();
        await expect(primaryActions).toContainText("Crea tu primer cliente");
        await expect(primaryActions).toContainText("Prepara una oferta o pedido");
        await expect(primaryActions).toContainText("Revisa inventario y servicios");
        await expect(emptyStates).toBeVisible();
        await expect(emptyStates).toContainText("Sin clientes todavía");
        await expect(emptyStates).toContainText("Sin documentos de venta");
        await expect(surface).toContainText("Demo guiada");
        await expect(page.getByTestId("dashboard-guided-demo")).toContainText("Crear cliente");
        await expect(page.getByTestId("dashboard-guided-demo")).toContainText("Crear presupuesto/pedido");
      }
    });
  }
});

test("customers and invoices create flows work after prerequisite onboarding and customer setup", async ({ page }, testInfo) => {
  const runId = `${testInfo.workerIndex}-${Date.now()}`;
  const customerName = `Cliente humo ${runId}`;

  await registerSignInAndSeed(page, `create-flow-${runId}`);

  await page.goto("/customers");
  await page.getByTestId("customer-name-input").fill(customerName);
  await page.getByTestId("customer-tax-id-input").fill("B12345674");
  await page.getByTestId("customer-address-input").fill("Calle Smoke 1");
  await page.getByTestId("customer-postal-code-input").fill("28013");
  await page.getByTestId("customer-city-input").fill("Madrid");
  await page.getByTestId("customer-province-input").fill("Madrid");
  await page.getByTestId("customer-email-input").fill(`cliente-humo-${runId}@example.test`);
  await page.getByTestId("customer-phone-input").fill("+34 600 000 000");
  const customerResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/customers") && response.request().method() === "POST",
    { timeout: 30_000 },
  );
  await page.getByTestId("customer-create-submit").click();
  const customerResponse = await customerResponsePromise;
  expect(customerResponse.ok(), await customerResponse.text()).toBe(true);
  await expect(page.getByText("Cliente creado correctamente.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("customers-table").getByRole("row").filter({ hasText: customerName })).toBeVisible();

  await page.goto("/invoices/new");
  await page.getByRole("button", { name: "Buscar cliente" }).click();
  await page.getByLabel("Nombre, email o teléfono").fill(customerName);
  await page.getByRole("button", { name: new RegExp(customerName) }).click();
  await page.getByTestId("invoice-issue-date-input").fill("2026-05-09");
  await page.getByTestId("invoice-line-1-description").fill("Servicio smoke");
  await page.getByTestId("invoice-line-1-quantity").fill("2");
  await page.getByTestId("invoice-line-1-unit-price").fill("50");
  await page.getByTestId("invoice-line-1-tax-rate").fill("21");

  await expect(page.getByTestId("invoice-subtotal")).toHaveText("Subtotal: 100,00 €");
  await expect(page.getByTestId("invoice-tax-total")).toHaveText("IVA: 21,00 €");
  await expect(page.getByTestId("invoice-grand-total")).toHaveText("Total: 121,00 €");

  const invoiceResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/invoices") && response.request().method() === "POST",
    { timeout: 30_000 },
  );
  await page.getByTestId("invoice-create-submit").click();
  const invoiceResponse = await invoiceResponsePromise;
  expect(invoiceResponse.ok(), await invoiceResponse.text()).toBe(true);
  const createdInvoice = (await invoiceResponse.json()) as { number: string };
  await expect(page.getByText("Factura creada correctamente.")).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/invoices\/[^/]+$/);
  await expect(page.getByRole("heading", { name: createdInvoice.number })).toBeVisible();

  await page.goto("/invoices");
  const invoicesList = page.getByTestId("invoices-list");
  await expect(invoicesList).toContainText(createdInvoice.number);
  await expect(invoicesList).toContainText(customerName);
  await expect(invoicesList).toContainText("121,00 €");
});
