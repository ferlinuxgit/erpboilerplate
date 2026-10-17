import { expect, test } from "@playwright/test";

import { postJson } from "./helpers/api-client";
import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("TPV en el móvil: pantalla propia, productos y ticket, editar línea y cobro con teclado táctil", async ({ page }) => {
  test.setTimeout(120_000);
  await registerAndSignIn(page, "POS Mobile E2E");
  await completeOnboarding(page, "Cafetería Móvil E2E S.L.");
  await postJson(page, "/api/items", { name: "Café con leche", sku: "CAFE", salePrice: 1.65 });
  await page.evaluate(async () => {
    const token = document.cookie.split("; ").find((cookie) => cookie.startsWith("csrf-token="))?.split("=")[1] ?? "";
    await fetch("/api/modules", { method: "PUT", headers: { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(token) }, body: JSON.stringify({ moduleId: "pos", enabled: true }) });
  });
  const register = await postJson<{ id: string }>(page, "/api/pos/registers", { name: "Barra", seriesCode: "T", seriesPrefix: "T", simplifiedLimit: 400 });

  // La caja se abre en su propia pantalla, sin el menú del ERP, con el teclado táctil.
  await page.goto(`/pos/${register.id}`);
  await expect(page.getByTestId("pos-kiosk-bar")).toBeVisible();
  await expect(page.getByTestId("desktop-sidebar")).toBeHidden();
  await page.getByTestId("pos-keypad").getByRole("button", { name: "5" }).tap();
  await page.getByTestId("pos-keypad").getByRole("button", { name: "0" }).tap();
  await expect(page.getByLabel("Fondo de caja")).toHaveValue("50");
  await page.getByTestId("pos-open-submit").tap();

  // Pantalla de productos con la barra de cobro abajo.
  await expect(page.getByTestId("pos-mobile-bar")).toBeVisible();
  await page.waitForLoadState("networkidle");
  const cafe = page.getByTestId("pos-item-CAFE");
  await cafe.tap();
  await cafe.tap();
  await expect(page.getByTestId("pos-units-badge")).toHaveText("2");
  // 2 × 2,00 € con IVA del 21 % no cuadra al céntimo: se cobra 3,99 € (nunca de más) y se ve el redondeo.
  await expect(page.getByTestId("pos-mobile-total")).toContainText("3,99");
  await expect(page.getByTestId("pos-cart")).toBeHidden();

  // Pantalla del ticket: tocar la línea abre el editor (cantidad con botones grandes).
  await page.getByTestId("pos-toggle-view").tap();
  await expect(page.getByTestId("pos-cart")).toBeVisible();
  await expect(page.getByTestId("pos-catalog")).toBeHidden();
  await expect(page.getByTestId("pos-rounding")).toContainText("-0,01");
  await page.getByRole("button", { name: "Editar Café con leche" }).tap();
  await page.getByRole("button", { name: "Una unidad más" }).tap();
  await expect(page.getByTestId("pos-line-quantity")).toHaveText("3");
  await page.getByTestId("pos-line-save").tap();
  await expect(page.getByTestId("pos-mobile-total")).toContainText("6,00");

  // Cobro: 10 € con el teclado táctil → cambio 4,00 €.
  await page.getByTestId("pos-charge-mobile").tap();
  const keypad = page.getByTestId("pos-payment-dialog").getByTestId("pos-keypad");
  await keypad.getByRole("button", { name: "1" }).tap();
  await keypad.getByRole("button", { name: "0" }).tap();
  await expect(page.getByTestId("pos-change")).toContainText("4,00");
  await page.getByTestId("pos-pay-confirm").tap();
  await expect(page.getByTestId("pos-last-sale")).toContainText("Ticket T000001 cobrado");
  await expect(page.getByTestId("pos-last-sale")).toContainText("Cambio 4,00");

  // Nueva venta vuelve a los productos.
  await page.getByRole("button", { name: "Nueva venta" }).tap();
  await expect(page.getByTestId("pos-catalog")).toBeVisible();
});
