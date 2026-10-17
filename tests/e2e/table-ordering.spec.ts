import { expect, test, type Page } from "@playwright/test";

import { postJson } from "./helpers/api-client";
import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  return page.evaluate(async ({ method, path, body }) => {
    const token = document.cookie.split("; ").find((cookie) => cookie.startsWith("csrf-token="))?.split("=")[1] ?? "";
    const response = await fetch(path, { method, headers: { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(token) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text}`);
    return (text ? JSON.parse(text) : null) as T;
  }, { method, path, body });
}

test("Desde la mesa: el cliente pide y llama con el QR, el camarero lo ve en el plano y lo acepta", async ({ browser, page }) => {
  test.setTimeout(180_000);
  await registerAndSignIn(page, "Mesa QR E2E");
  await completeOnboarding(page, "Cervecería Mesa QR E2E S.L.");
  await api(page, "PUT", "/api/modules", { moduleId: "pos", enabled: true });
  await api(page, "PUT", "/api/modules", { moduleId: "hospitality", enabled: true });
  const taxes = await api<Array<{ id: string; rate: string; kind: string; operation: string }>>(page, "GET", "/api/taxes");
  const vat10 = taxes.find((entry) => Number(entry.rate) === 10 && entry.kind === "VAT" && entry.operation === "ADD")!;
  const drinks = await postJson<{ id: string }>(page, "/api/item-categories", { code: "BEB", name: "Bebidas" });
  const kitchen = await postJson<{ id: string }>(page, "/api/item-categories", { code: "COC", name: "Cocina" });
  await postJson(page, "/api/items", { name: "Caña", sku: "CANA", salePrice: 2, isService: true, categoryId: drinks.id, defaultTaxId: vat10.id });
  const entrecot = await postJson<{ id: string }>(page, "/api/items", { name: "Entrecot", sku: "ENTR", salePrice: 18.18, isService: true, categoryId: kitchen.id, defaultTaxId: vat10.id });
  await api(page, "PUT", "/api/pos/hospitality/stations", { entries: [{ categoryId: drinks.id, station: "BAR" }, { categoryId: kitchen.id, station: "KITCHEN" }] });
  await postJson(page, "/api/pos/hospitality/modifiers", { name: "Punto", minSelect: 1, maxSelect: 1, options: [{ name: "Al punto", price: 0 }], itemIds: [entrecot.id] });
  const register = await postJson<{ id: string }>(page, "/api/pos/registers", { name: "Sala", seriesCode: "Q", seriesPrefix: "Q", simplifiedLimit: 400, mode: "TABLES" });
  const area = await postJson<{ id: string }>(page, "/api/pos/hospitality/areas", { name: "Terraza" });
  await postJson(page, "/api/pos/hospitality/tables", { areaId: area.id, prefix: "Mesa", from: 1, to: 1, seats: 4 });
  await postJson(page, "/api/pos/menu/import", {});
  const slug = `mesa-qr-${Date.now().toString(36)}`;
  const settings = { enabled: true, slug, intro: null, introEn: null, showBookingLink: false, tableService: true, tableOrdering: true, directToKitchen: false };
  await api(page, "PUT", "/api/pos/menu/settings", settings);
  const floor = await api<{ areas: Array<{ tables: Array<{ id: string }> }> }>(page, "GET", `/api/pos/hospitality/floor?registerId=${register.id}`);
  const tableId = floor.areas[0].tables[0].id;

  // Caja abierta y plano a la vista.
  await page.goto(`/pos/${register.id}`);
  await page.getByLabel("Fondo de caja").fill("50");
  await page.getByTestId("pos-open-submit").click();
  await expect(page.getByTestId("pos-floor")).toBeVisible();

  // El cliente escanea el QR de su mesa.
  const guest = await browser.newContext({ locale: "es-ES" });
  const customer = await guest.newPage();
  await customer.goto(`/carta/${slug}?mesa=${tableId}`);
  await customer.waitForLoadState("networkidle");
  await expect(customer.getByTestId("public-menu-dish-Entrecot")).toContainText("Pídelo al camarero");
  const cana = customer.getByTestId("public-menu-dish-Caña");
  await cana.getByTestId("table-add").click();
  await cana.getByRole("button", { name: "Añadir 1" }).click();
  await expect(cana.getByTestId("table-qty")).toHaveText("2");
  await customer.getByTestId("table-view-order").click();
  await customer.getByLabel(/Nota .*Caña/).fill("Bien fría");
  await customer.getByTestId("table-send-order").click();
  await expect(customer.getByTestId("table-message")).toContainText("Pedido enviado");
  await customer.getByTestId("table-call-waiter").click();
  await expect(customer.getByTestId("table-message")).toContainText("el camarero viene");

  // En el plano la mesa avisa; el camarero atiende la llamada y acepta el pedido.
  const table = page.getByTestId("pos-table-Mesa 1");
  await expect(table.getByTestId("pos-table-request")).toContainText("Pedido", { timeout: 15_000 });
  await expect(table.getByTestId("pos-table-request")).toContainText("Llama");
  await table.click();
  await page.getByTestId("pos-requests-dialog").getByTestId("pos-request-done").click();
  await expect(page.getByText("Atendido.")).toBeVisible();
  await table.click();
  await page.getByTestId("pos-requests-dialog").getByTestId("pos-request-accept").click();
  await expect(page.getByTestId("pos-order-screen")).toBeVisible();
  await expect(page.getByTestId("pos-order-lines")).toContainText("Caña");
  await expect(page.getByTestId("pos-order-lines")).toContainText("QR: Bien fría");
  await expect(page.getByTestId("pos-order-pending")).toContainText("4,40");

  // El cliente ve que su pedido está confirmado.
  await expect(customer.getByTestId("table-message")).toContainText("Pedido confirmado", { timeout: 20_000 });

  // Modo directo a cocina: entra en la cuenta y se envía sin confirmación.
  await api(page, "PUT", "/api/pos/menu/settings", { ...settings, directToKitchen: true });
  await customer.reload();
  await customer.waitForLoadState("networkidle");
  await customer.getByTestId("public-menu-dish-Caña").getByTestId("table-add").click();
  await customer.getByTestId("table-view-order").click();
  await customer.getByTestId("table-send-order").click();
  await expect(customer.getByTestId("table-message")).toContainText("enviado a cocina");
  const orderId = page.url().split("/orders/")[1];
  const order = await api<{ lines: Array<{ description: string; quantity: number; status: string }> }>(page, "GET", `/api/pos/hospitality/orders/${orderId}`);
  expect(order.lines.filter((line) => line.description === "Caña").map((line) => [line.quantity, line.status])).toEqual(expect.arrayContaining([[1, "SENT"]]));
  await guest.close();
});
