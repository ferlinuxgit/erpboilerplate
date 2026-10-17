import { expect, test } from "@playwright/test";

import { postJson } from "./helpers/api-client";
import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

test("TPV: caja, venta con cambio, ticket simplificado, devolución y cierre cuadrado", async ({ page }) => {
  test.setTimeout(150_000);
  await registerAndSignIn(page, "POS E2E");
  await completeOnboarding(page, "Tienda TPV E2E S.L.");
  await postJson(page, "/api/items", { name: "Café con leche", sku: "CAFE", salePrice: 1.65 });

  // Activar el TPV.
  await page.goto("/settings/modules");
  const posSwitch = page.getByTestId("module-card-pos").getByRole("switch");
  await posSwitch.click();
  await expect(posSwitch).toBeChecked();

  // Sin cajas: se propone crear la primera.
  await page.goto("/pos");
  await page.getByTestId("pos-setup-link").click();
  await expect(page).toHaveURL(/\/pos\/settings$/);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("pos-register-save").click();
  await expect(page.getByText("Caja creada.")).toBeVisible();

  // Con una sola caja se entra directamente; se abre con 50 € de fondo.
  await page.goto("/pos");
  await expect(page.getByTestId("pos-open-panel")).toBeVisible();
  await page.getByLabel("Fondo de caja").fill("50");
  await page.getByTestId("pos-open-submit").click();
  await expect(page.getByTestId("pos-terminal")).toBeVisible();
  await page.waitForLoadState("networkidle");

  // Dos cafés (2,00 € IVA incluido) y un concepto libre de 0,50 €.
  const cafe = page.getByTestId("pos-item-CAFE");
  await expect(cafe).toContainText("2,00");
  await cafe.click();
  await cafe.click();
  const freeLine = page.getByTestId("pos-free-line");
  await freeLine.getByLabel("Concepto libre").fill("Bollo");
  await freeLine.getByLabel("PVP").fill("0,50");
  await freeLine.getByRole("button", { name: "Añadir concepto" }).click();
  await expect(page.getByTestId("pos-cart-line")).toHaveCount(2);
  await expect(page.getByTestId("pos-charge")).toContainText("4,50");

  // Cobro en efectivo con 10 €: cambio 5,50 €.
  await page.getByTestId("pos-charge").click();
  const dialog = page.getByTestId("pos-payment-dialog");
  await dialog.getByLabel("Entregado").fill("10");
  await expect(page.getByTestId("pos-change")).toContainText("5,50");
  await page.getByTestId("pos-pay-confirm").click();
  const lastSale = page.getByTestId("pos-last-sale");
  await expect(lastSale).toContainText("Ticket T000001 cobrado");
  await expect(lastSale).toContainText("Cambio 5,50");

  // Ticket imprimible: factura simplificada con su número, desglose e importe.
  const popupPromise = page.waitForEvent("popup");
  await page.getByTestId("pos-print-last").click();
  const popup = await popupPromise;
  await expect(popup.getByTestId("pos-ticket-print")).toContainText("FACTURA SIMPLIFICADA");
  await expect(popup.getByTestId("pos-ticket-print")).toContainText("T000001");
  await expect(popup.getByTestId("pos-ticket-print")).toContainText("Cambio");
  await expect(popup.getByTestId("pos-ticket-print")).toContainText("4,50");
  await popup.close();

  // Devolución del ticket: rectificativa y el efectivo sale del cajón.
  await page.getByTestId("pos-open-tickets").click();
  page.once("dialog", (prompt) => void prompt.accept("Cambia de opinión"));
  await page.getByTestId("pos-refund-T000001").click();
  await expect(page.getByText(/Devolución .*: devuelve 4,50/)).toBeVisible();
  await expect(page.getByTestId("pos-tickets-dialog")).toContainText("Devolución");
  await page.getByRole("dialog", { name: "Tickets" }).getByRole("button", { name: "Cerrar diálogo" }).click();

  // Cierre: fondo 50 + 4,50 − 4,50 = 50 € esperados; se cuentan 50 → cuadra.
  await page.getByTestId("pos-close-link").click();
  await expect(page.getByTestId("pos-expected-cash")).toContainText("50,00");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Efectivo contado").fill("50");
  await expect(page.getByTestId("pos-close-difference")).toContainText("Cuadra");
  await page.getByTestId("pos-close-submit").click();
  await expect(page).toHaveURL(/\/pos\/sessions\/[^/]+$/);
  await expect(page.getByRole("heading", { name: /Informe Z/ })).toBeVisible();
  await expect(page.getByTestId("pos-net-total")).toContainText("0,00");
  await expect(page.getByTestId("pos-difference")).toContainText("0,00");

  // Las dos facturas (ticket y rectificativa) están en Facturas.
  await page.goto("/invoices");
  await expect(page.getByText("T000001").first()).toBeVisible();
});
