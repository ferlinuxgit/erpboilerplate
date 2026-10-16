import { expect, test } from "@playwright/test";

import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

test("lectura solo con OpenAI y buzón de facturas por email", async ({ page }) => {
  test.setTimeout(90_000);
  await registerAndSignIn(page, "Mail Inbox E2E");
  await completeOnboarding(page, "Empresa buzón E2E S.L.");

  // Sin OCR local: no hay selector de motor. Sin OPENAI_API_KEY en el servidor de tests, se avisa y no se puede subir.
  await page.goto("/expenses/inbox");
  await expect(page.getByLabel("Cómo leer los documentos")).toHaveCount(0);
  await expect(page.getByTestId("expense-reading-unavailable")).toContainText("OPENAI_API_KEY");

  await page.goto("/settings/automation#correo");
  const form = page.getByTestId("mail-inbox-form");
  await expect(form).toBeVisible();
  // El remitente permitido se propone con el correo del usuario.
  await expect(form.getByLabel("Remitentes permitidos")).toHaveValue(/@example\.test/);

  await form.getByRole("button", { name: "Gmail" }).click();
  await expect(form.getByLabel("Servidor IMAP")).toHaveValue("imap.gmail.com");
  await expect(form.getByLabel(/^Puerto/)).toHaveValue("993");

  // Validación: sin remitentes permitidos no se guarda.
  await form.getByLabel("Usuario").fill("facturas@empresa.test");
  await form.getByLabel("Contraseña").fill("secreto");
  await form.getByLabel("Remitentes permitidos").fill("");
  await page.getByTestId("mail-inbox-save").click();
  await expect(form.getByRole("alert")).toContainText("remitente permitido");

  // Error de conexión explicado (servidor inexistente).
  await form.getByLabel("Servidor IMAP").fill("imap.no-existe.invalid");
  await page.getByTestId("mail-inbox-test").click();
  await expect(form.getByRole("alert")).toContainText(/servidor IMAP/i, { timeout: 30_000 });

  // Guardado correcto: la contraseña no se devuelve y queda indicada como guardada.
  await form.getByLabel("Remitentes permitidos").fill("yo@empresa.test, @proveedor.test");
  await form.getByLabel("Revisar este buzón automáticamente").uncheck();
  const saved = page.waitForResponse((response) => response.url().endsWith("/api/expenses/mail-inbox") && response.request().method() === "PUT");
  await page.getByTestId("mail-inbox-save").click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body).toMatchObject({ configured: true, enabled: false, hasPassword: true, allowedSenders: "yo@empresa.test, @proveedor.test" });
  expect(JSON.stringify(body)).not.toContain("secreto");
  await page.reload();
  await expect(page.getByTestId("mail-inbox-form").getByLabel("Contraseña")).toHaveValue("");
  await expect(page.getByTestId("mail-inbox-status")).toContainText("Desactivado");
});
