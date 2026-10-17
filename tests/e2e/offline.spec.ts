import { expect, test, type Page } from "@playwright/test";

import { postJson } from "./helpers/api-client";
import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

async function api<T>(page: Page, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  return page.evaluate(async ({ method, path, body, headers }) => {
    const token = document.cookie.split("; ").find((cookie) => cookie.startsWith("csrf-token="))?.split("=")[1] ?? "";
    const response = await fetch(path, { method, headers: { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(token), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text}`);
    return (text ? JSON.parse(text) : null) as T;
  }, { method, path, body, headers });
}

test("Corte de conexión: se sigue tomando nota, cobrar espera y al volver se envía todo una sola vez", async ({ context, page }) => {
  test.setTimeout(180_000);
  await registerAndSignIn(page, "Sin Red E2E");
  await completeOnboarding(page, "Bar Sin Red E2E S.L.");
  await api(page, "PUT", "/api/modules", { moduleId: "pos", enabled: true });
  await api(page, "PUT", "/api/modules", { moduleId: "hospitality", enabled: true });
  const taxes = await api<Array<{ id: string; rate: string; kind: string; operation: string }>>(page, "GET", "/api/taxes");
  const vat10 = taxes.find((entry) => Number(entry.rate) === 10 && entry.kind === "VAT" && entry.operation === "ADD")!;
  const drinks = await postJson<{ id: string }>(page, "/api/item-categories", { code: "BEB", name: "Bebidas" });
  await postJson(page, "/api/items", { name: "Caña", sku: "CANA", salePrice: 2, isService: true, categoryId: drinks.id, defaultTaxId: vat10.id });
  await postJson(page, "/api/items", { name: "Tinto", sku: "TINT", salePrice: 2.5, isService: true, categoryId: drinks.id, defaultTaxId: vat10.id });
  await api(page, "PUT", "/api/pos/hospitality/stations", { entries: [{ categoryId: drinks.id, station: "BAR" }] });
  const register = await postJson<{ id: string }>(page, "/api/pos/registers", { name: "Barra", seriesCode: "S", seriesPrefix: "S", simplifiedLimit: 400, mode: "TABLES" });
  const area = await postJson<{ id: string }>(page, "/api/pos/hospitality/areas", { name: "Terraza" });
  await postJson(page, "/api/pos/hospitality/tables", { areaId: area.id, prefix: "Mesa", from: 1, to: 1, seats: 4 });

  await page.goto(`/pos/${register.id}`);
  await page.getByLabel("Fondo de caja").fill("50");
  await page.getByTestId("pos-open-submit").click();
  await page.waitForLoadState("networkidle");
  await page.getByTestId("pos-table-Mesa 1").click();
  await page.getByTestId("pos-guests-dialog").getByRole("button", { name: "2", exact: true }).click();
  await expect(page.getByTestId("pos-order-screen")).toBeVisible();
  await page.waitForLoadState("networkidle");
  const orderId = page.url().split("/orders/")[1];

  // Se va la conexión: el TPV avisa y deja seguir tomando nota.
  await context.setOffline(true);
  await expect(page.getByTestId("pos-connection-banner")).toContainText("Sin conexión");
  await page.getByTestId("pos-item-CANA").click();
  await page.getByTestId("pos-item-CANA").click();
  await page.getByTestId("pos-item-TINT").click();
  await expect(page.getByTestId("pos-connection-banner")).toContainText("3 operaciones guardadas");
  await expect(page.getByTestId("pos-order-lines")).toContainText("Caña");
  await expect(page.getByTestId("pos-order-pending")).toContainText("7,15");
  await page.getByTestId("pos-order-send").click();
  await expect(page.getByTestId("pos-connection-banner")).toContainText("4 operaciones guardadas");
  // Cobrar necesita conexión.
  await expect(page.getByTestId("pos-order-charge")).toBeDisabled();

  // Vuelve la conexión: se envía solo, en orden y una sola vez.
  await context.setOffline(false);
  await expect(page.getByText(/Enviadas 4 operaciones pendientes/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("pos-connection-banner")).toHaveCount(0);
  await expect(page.getByTestId("pos-order-charge")).toBeEnabled();
  const order = await api<{ lines: Array<{ description: string; quantity: number; status: string }> }>(page, "GET", `/api/pos/hospitality/orders/${orderId}`);
  expect(order.lines.map((line) => [line.description, line.quantity, line.status])).toEqual([["Caña", 2, "SENT"], ["Tinto", 1, "SENT"]]);

  // Reenviar la misma operación (respuesta perdida) no duplica.
  const key = `retry-${Date.now()}`;
  const line = { itemId: null, description: "Pan", unitPrice: 1, taxRate: 10, quantity: 1 };
  await api(page, "POST", `/api/pos/hospitality/orders/${orderId}/lines`, { lines: [line] }, { "x-request-key": key });
  await api(page, "POST", `/api/pos/hospitality/orders/${orderId}/lines`, { lines: [line] }, { "x-request-key": key });
  const after = await api<{ lines: Array<{ description: string; quantity: number }> }>(page, "GET", `/api/pos/hospitality/orders/${orderId}`);
  expect(after.lines.filter((entry) => entry.description === "Pan").map((entry) => entry.quantity)).toEqual([1]);
});
