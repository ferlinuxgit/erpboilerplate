import { expect, test } from "@playwright/test";

import { postJson } from "./helpers/api-client";
import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

/**
 * Tesorería: importar un extracto con el asistente, conciliar asignando a cuenta con
 * "Recordar para la próxima vez", deshacer desde el aviso y consultar previsión y remesas.
 */
test("importar extracto, asignar una comisión a cuenta, deshacer y ver la previsión", async ({ page }) => {
  await registerAndSignIn(page, "Treasury E2E");
  await completeOnboarding(page, "Tesorería E2E S.L.");
  const bankAccount = await postJson<{ id: string }>(page, "/api/bank-accounts", {
    bankName: "Banco extracto",
    iban: "ES91 2100 0418 4502 0005 1332",
  });

  const today = new Date();
  const day = (offset: number) => {
    const date = new Date(today.getTime() - offset * 86_400_000);
    return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
  };
  const csv = [
    "Extracto de movimientos",
    "Fecha operación;Concepto;Importe;Saldo",
    `${day(3)};COMISION MANTENIMIENTO CUENTA;-12,50;1.987,50`,
    `${day(2)};TRANSFERENCIA RECIBIDA CLIENTE;1.210,00;3.197,50`,
    `${day(1)};RECIBO TGSS AUTONOMOS;-294,00;2.903,50`,
    "Total;;;",
  ].join("\n");

  await page.goto(`/treasury/import?account=${bankAccount.id}`);
  await expect(page.getByRole("heading", { name: "Importar extracto bancario" })).toBeVisible();
  await page.getByLabel("Extracto").setInputFiles({ name: "extracto.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  await page.getByRole("button", { name: "Ver vista previa" }).click();
  await expect(page.getByText("Así quedarán los movimientos (3 válidos, 1 filas descartadas)")).toBeVisible();

  const importResponse = page.waitForResponse((response) => response.url().endsWith("/api/treasury/import") && response.request().method() === "POST");
  await page.getByTestId("bank-import-submit").click();
  expect((await importResponse).status()).toBe(201);
  const report = page.getByTestId("bank-import-report");
  await expect(report).toContainText("Importados");
  await expect(report).toContainText("3");

  await report.getByRole("link", { name: "Conciliar ahora" }).click();
  await expect(page.getByRole("heading", { name: "Conciliación bancaria" })).toBeVisible();
  const movements = page.getByTestId("workbench-movement");
  await expect(movements).toHaveCount(3);

  const fee = movements.filter({ hasText: "COMISION MANTENIMIENTO CUENTA" });
  await fee.getByRole("button", { name: "Asignar a cuenta…" }).click();
  const dialog = page.getByRole("dialog", { name: "Asignar a cuenta" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Comisión bancaria" }).click();
  await expect(dialog.getByLabel("El concepto contiene")).toHaveValue("comision mantenimiento cuenta");
  const applyResponse = page.waitForResponse((response) => response.url().includes("/api/treasury/reconciliation/apply"));
  await dialog.getByRole("button", { name: "Asignar", exact: true }).click();
  expect((await applyResponse).ok()).toBeTruthy();
  await expect(movements).toHaveCount(2);

  // Deshacer desde el aviso: el movimiento vuelve a pendiente.
  const undoResponse = page.waitForResponse((response) => response.url().includes("/api/treasury/reconciliation/undo"));
  await page.getByRole("button", { name: "Deshacer" }).first().click();
  expect((await undoResponse).ok()).toBeTruthy();
  await expect(movements).toHaveCount(3);

  // La regla recordada ya propone la cuenta para esa comisión.
  await expect(fee.getByTestId("workbench-suggestion").first()).toContainText("626");
  await page.goto("/treasury/rules");
  await expect(page.getByTestId("reconciliation-rule-row")).toContainText("comision mantenimiento cuenta");

  await page.goto("/treasury/bank-transactions");
  await expect(page.getByTestId("bank-transactions-list")).toContainText("Pendiente de conciliar");

  await page.goto("/treasury/forecast?h=30");
  await expect(page.getByRole("heading", { name: "Previsión de tesorería" })).toBeVisible();
  await expect(page.getByTestId("treasury-forecast-summary")).toContainText(/2\.?903,50/);
  await expect(page.getByTestId("treasury-forecast-week")).toHaveCount(5);

  await page.goto("/treasury/remittances/new");
  await expect(page.getByRole("heading", { name: "Nueva remesa de pagos" })).toBeVisible();
});
