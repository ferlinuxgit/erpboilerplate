import { expect, test } from "@playwright/test";

import { postJson } from "./helpers/api-client";
import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

test("TPV: venta con cambio, ticket simplificado, devoluciones parciales, tarjeta, factura con NIF y cierre", async ({ page }) => {
  test.setTimeout(150_000);
  await registerAndSignIn(page, "POS E2E");
  await completeOnboarding(page, "Tienda TPV E2E S.L.");
  await postJson(page, "/api/items", { name: "Café con leche", sku: "CAFE", salePrice: 1.65 });
  // Banco para los cobros con tarjeta y un cliente con NIF para la factura completa.
  await postJson(page, "/api/bank-accounts", { bankName: "Banco datáfono", iban: "ES91 2100 0418 4502 0005 1332" });
  await postJson(page, "/api/customers", { name: "Hostelería Pérez S.L.", taxId: "B12345674", address: "Calle Mayor 1", postalCode: "28001", city: "Madrid", province: "Madrid", countryCode: "ES" });

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
  await page.getByTestId("pos-free-amount-tile").click();
  const freeAmount = page.getByTestId("pos-free-amount");
  await freeAmount.getByLabel("Concepto").fill("Bollo");
  await freeAmount.getByLabel("Importe (IVA incluido)").fill("0,50");
  await page.getByTestId("pos-free-amount-add").click();
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

  // Devolución parcial: solo un café (2,00 €) en efectivo.
  await page.getByTestId("pos-open-tickets").click();
  await page.getByTestId("pos-refund-T000001").click();
  const refund = page.getByTestId("pos-refund-dialog");
  await expect(refund.getByTestId("pos-refund-line")).toHaveCount(2);
  await refund.getByRole("button", { name: "Nada" }).click();
  await refund.getByRole("button", { name: "Devolver una unidad más de Café con leche" }).click();
  await expect(page.getByTestId("pos-refund-amount")).toContainText("2,00");
  await page.getByTestId("pos-refund-confirm").click();
  await expect(page.getByText(/Devolución .*: devuelve 2,00\s€ en efectivo/)).toBeVisible();

  // Después, el resto (1 café + bollo = 2,50 €): se vuelve a la lista y se propone todo lo que queda.
  await expect(page.getByTestId("pos-tickets-dialog")).toContainText("Devuelto en parte");
  await page.getByTestId("pos-refund-T000001").click();
  await expect(page.getByTestId("pos-refund-amount")).toContainText("2,50");
  await page.getByTestId("pos-refund-confirm").click();
  await expect(page.getByText(/Devolución .*: devuelve 2,50\s€ en efectivo/)).toBeVisible();
  await expect(page.getByTestId("pos-ticket-T000001")).toContainText("Devuelto");
  await expect(page.getByTestId("pos-refund-T000001")).toHaveCount(0);
  await page.getByRole("dialog", { name: "Tickets" }).getByRole("button", { name: "Cerrar diálogo" }).click();

  // Cobro con tarjeta: no cuenta en el efectivo del cajón.
  await page.getByRole("button", { name: "Nueva venta" }).click();
  await cafe.click();
  await page.getByTestId("pos-charge").click();
  await page.getByTestId("pos-method-card").click();
  await page.getByTestId("pos-pay-confirm").click();
  await expect(page.getByTestId("pos-last-sale")).toContainText("Ticket T000002 cobrado");

  // Por encima del límite de la simplificada (400 €) hay que identificar al cliente: factura completa.
  await page.getByRole("button", { name: "Nueva venta" }).click();
  await page.getByTestId("pos-free-amount-tile").click();
  await freeAmount.getByLabel("Concepto").fill("Cafetera industrial");
  await freeAmount.getByLabel("Importe (IVA incluido)").fill("605,00");
  await page.getByTestId("pos-free-amount-add").click();
  await expect(page.getByTestId("pos-charge")).toBeDisabled();
  await expect(page.getByText(/identifica al cliente/)).toBeVisible();
  await page.getByTestId("pos-customer-button").click();
  await page.getByLabel("Buscar cliente").fill("Pérez");
  await page.getByRole("button", { name: /Hostelería Pérez S\.L\./ }).click();
  await expect(page.getByTestId("pos-charge")).toBeEnabled();
  await page.getByTestId("pos-charge").click();
  await page.getByTestId("pos-method-card").click();
  await page.getByTestId("pos-pay-confirm").click();
  await expect(page.getByTestId("pos-last-sale")).toContainText("Ticket T000003 cobrado");
  const fullInvoicePopup = page.waitForEvent("popup");
  await page.getByTestId("pos-print-last").click();
  const invoicePrint = await fullInvoicePopup;
  await expect(invoicePrint.getByTestId("pos-ticket-print")).toContainText("B12345674");
  await expect(invoicePrint.getByTestId("pos-ticket-print")).not.toContainText("SIMPLIFICADA");
  await invoicePrint.close();

  // Ingreso de 20 € del cajón en el banco: traspaso contabilizado (572 a 570).
  await page.getByRole("button", { name: "Entrada/salida de efectivo" }).click();
  const movement = page.getByRole("dialog", { name: "Entrada o salida de efectivo" });
  await movement.getByLabel("¿Va al banco?").selectOption({ label: "Banco datáfono" });
  await movement.getByLabel("Importe").fill("20");
  await movement.getByLabel("Motivo").fill("Ingreso diario");
  await movement.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Salida de efectivo anotada y contabilizada.")).toBeVisible();

  // Cierre: fondo 50 + 4,50 − 2,00 − 2,50 − 20 = 30 € en efectivo (las tarjetas no cuentan).
  // Se cuentan 29 €: falta 1 €, que se contabiliza (678 a 570).
  await page.getByTestId("pos-close-link").click();
  await expect(page.getByTestId("pos-expected-cash")).toContainText("30,00");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Efectivo contado").fill("29");
  await expect(page.getByTestId("pos-close-difference")).toContainText("Faltan 1,00");
  await expect(page.getByLabel(/Contabilizar la diferencia de caja/)).toBeChecked();
  page.once("dialog", (confirmDialog) => void confirmDialog.accept());
  await page.getByTestId("pos-close-submit").click();
  await expect(page).toHaveURL(/\/pos\/sessions\/[^/]+$/);
  await expect(page.getByRole("heading", { name: /Informe Z/ })).toBeVisible();
  // Ventas netas: 4,50 − 4,50 + 2,00 (tarjeta) + 605,00 (factura) = 607,00.
  await expect(page.getByTestId("pos-net-total")).toContainText("607,00");
  await expect(page.getByTestId("pos-difference")).toContainText("-1,00");
  await expect(page.getByText("La diferencia se contabilizó")).toBeVisible();

  // Los dos asientos de caja están en el diario.
  await page.goto("/accounting/entries?q=TPV");
  await expect(page.getByText(/ingreso de caja en el banco/).first()).toBeVisible();
  await expect(page.getByText(/diferencia de caja \(faltante\)/).first()).toBeVisible();

  // Panel de inicio e Informes: ventas netas de hoy (607,00 €) con 3 tickets.
  await page.goto("/dashboard");
  await expect(page.getByTestId("dashboard-pos-today")).toContainText("607,00");
  await expect(page.getByTestId("dashboard-pos-today")).toContainText("3 tickets");
  await page.goto("/reporting");
  await expect(page.getByTestId("reporting-pos")).toContainText("607,00");

  // Las dos facturas (ticket y rectificativa) están en Facturas.
  await page.goto("/invoices");
  await expect(page.getByText("T000001").first()).toBeVisible();
});
