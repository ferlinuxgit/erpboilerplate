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
    heading: /(Buenos días|Buenas tardes|Buenas noches),/,
    evidence: /Actividad de/,
  },
  {
    path: "/customers",
    navLabel: "Clientes",
    heading: "Clientes",
    evidence: "Clientes registrados",
  },
  {
    path: "/invoices",
    navLabel: "Facturas",
    heading: "Facturas",
    evidence: /Emitidas y rectificativas/
  },
  {
    path: "/purchases/orders",
    navLabel: "Pedidos de compra",
    heading: "Pedidos de compra",
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
    heading: "Tesorería y bancos",
    evidence: "Cuentas bancarias",
  },
  {
    path: "/fiscal",
    navLabel: "Fiscalidad",
    heading: "Fiscalidad España",
    evidence: /Modelos 303, 390, 347, 349, 111, 115 y 130/i,
  },
  {
    path: "/reporting",
    navLabel: "Informes",
    heading: "Informes",
    evidence: /Indicadores del periodo/i,
  },
  {
    path: "/settings/security",
    navLabel: "Seguridad",
    heading: "Seguridad",
    evidence: "Gestión habilitada",
  },
];

async function registerSignInAndSeed(page: Page, runId: string) {
  await registerAndSignIn(page, `Core Smoke E2E ${runId}`);
  await completeOnboarding(page, `Empresa smoke ${runId} S.L.`);
}

test.describe("core product module smoke coverage", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const safeTitle = testInfo.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    await registerAndSignIn(page, `Core Smoke E2E ${testInfo.workerIndex}-${safeTitle}-${Date.now()}`);
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
        // Fresh account (no setup yet): fiscal-data banner, then the single setup checklist first.
        const checklist = page.getByTestId("dashboard-setup-checklist");

        await expect(page.getByTestId("dashboard-metrics")).toBeVisible();
        await expect(page.getByTestId("dashboard-fiscal-banner")).toContainText("Completa tus datos fiscales");
        await expect(checklist).toBeVisible();
        await expect(checklist).toContainText("Puesta en marcha");
        await expect(checklist).toContainText(/de 5 pasos completados/);
        await expect(checklist.getByRole("link", { name: "Completar datos fiscales" })).toHaveAttribute("href", "/settings/company");
        await expect(checklist.getByRole("link", { name: "Crear cliente" })).toHaveAttribute("href", "/customers/new");
        await expect(checklist.getByRole("link", { name: "Crear factura" })).toHaveAttribute("href", "/invoices/new");
        // Fiscal deadlines and "Qué hacer hoy" are visible from day one.
        await expect(page.getByTestId("dashboard-today")).toBeVisible();
        await expect(page.getByTestId("dashboard-empty-states")).toHaveCount(0);
      }
    });
  }
});

test("customers and invoices create flows work after prerequisite onboarding and customer setup", async ({ page }, testInfo) => {
  const runId = `${testInfo.workerIndex}-${Date.now()}`;
  const customerName = `Cliente humo ${runId}`;

  await registerSignInAndSeed(page, `create-flow-${runId}`);

  await page.goto("/customers/new");
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
  await page.getByTestId("invoice-line-1-taxes").locator("summary").click();
  await page.getByTestId("invoice-line-1-taxes").getByRole("checkbox", { name: /IVA general/ }).check();

  await expect(page.getByTestId("invoice-subtotal")).toContainText("100,00 €");
  await expect(page.getByTestId("invoice-tax-total")).toHaveText("Impuestos añadidos: 21,00 €");
  await expect(page.getByTestId("invoice-grand-total")).toHaveText("Total: 121,00 €");

  const invoiceResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/invoices") && response.request().method() === "POST",
    { timeout: 30_000 },
  );
  // Emitir siempre pasa por la confirmación (Enter solo guarda borradores).
  await page.getByTestId("invoice-create-submit").click();
  await page.getByTestId("invoice-issue-confirm").click();
  const invoiceResponse = await invoiceResponsePromise;
  expect(invoiceResponse.ok(), await invoiceResponse.text()).toBe(true);
  const createdInvoice = (await invoiceResponse.json()) as { number: string };
  await expect(page.getByText(`Factura ${createdInvoice.number} emitida correctamente.`)).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/invoices\/[^/]+$/);
  await expect(page.getByRole("heading", { name: createdInvoice.number })).toBeVisible();

  await page.goto("/invoices");
  const invoicesList = page.getByTestId("invoices-list");
  await expect(invoicesList).toContainText(createdInvoice.number);
  await expect(invoicesList).toContainText(customerName);
  await expect(invoicesList).toContainText("121,00 €");
});
