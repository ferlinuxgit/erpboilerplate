import { expect, test } from "@playwright/test";

import { postJson } from "./helpers/api-client";
import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

test("CRM: activar, oportunidad con seguimiento, alta del contacto, presupuesto vinculado, embudo y agenda", async ({ page }) => {
  test.setTimeout(120_000);
  await registerAndSignIn(page, "CRM E2E");
  await completeOnboarding(page, "Empresa CRM E2E S.L.");

  // Activar el módulo desde Configuración → Módulos.
  await page.goto("/settings/modules");
  const crmSwitch = page.getByTestId("module-card-crm").getByRole("switch");
  await crmSwitch.click();
  await expect(crmSwitch).toBeChecked();
  const mainNav = page.getByRole("navigation", { name: "Navegación principal" }).first();
  await expect(mainNav.locator('a[href="/crm"]')).toHaveCount(1);

  // Embudo inicial con sus etapas.
  await page.goto("/crm");
  await expect(page.getByTestId("crm-stage-0")).toContainText("Nuevo contacto");
  await expect(page.getByTestId("crm-stage-4")).toContainText("Ganada");

  // Nueva oportunidad para un contacto que aún no es cliente.
  await page.getByTestId("crm-new-opportunity").click();
  const form = page.getByTestId("opportunity-form");
  await form.getByLabel("Título").fill("Web corporativa");
  await form.getByLabel(/^Persona de contacto/).fill("Ana Prospecto");
  await form.getByLabel("Email").fill("ana@prospecto.test");
  await form.getByLabel("Importe estimado").fill("1500");
  await page.getByTestId("opportunity-save").click();
  await expect(page).toHaveURL(/\/crm\/opportunities\/(?!new$)[^/]+$/);
  const opportunityUrl = page.url();
  await expect(page.getByRole("heading", { name: "Web corporativa" })).toBeVisible();

  // Seguimiento: una llamada ya vencida aparece como pendiente y vencida.
  const activityForm = page.getByTestId("crm-activity-form").first();
  await activityForm.getByLabel("Qué hay que hacer").fill("Llamar para cerrar");
  await activityForm.getByLabel("Cuándo").fill("2026-01-05T10:00");
  await page.getByTestId("crm-activity-save").first().click();
  await expect(page.getByTestId("crm-activity-list").first()).toContainText("Llamar para cerrar");
  await expect(page.getByTestId("crm-activity-list").first()).toContainText("vencida");

  // Alta del contacto como cliente.
  await page.getByTestId("crm-convert-contact").click();
  await page.getByLabel("CIF/NIF").fill("B12345674");
  await page.getByLabel("Dirección").fill("Calle Mayor 1");
  await page.getByLabel("Código postal").fill("28001");
  await page.getByLabel("Ciudad").fill("Madrid");
  await page.getByLabel("Provincia").fill("Madrid");
  await page.getByTestId("crm-convert-save").click();
  const customerLink = page.locator('a[href^="/customers/"]', { hasText: "Ana Prospecto" });
  await expect(customerLink).toBeVisible();
  const customerId = (await customerLink.getAttribute("href"))!.split("/").pop()!;
  await expect(page.getByTestId("crm-create-quote")).toHaveAttribute("href", new RegExp(`customerId=${customerId}&crmOpportunityId=`));

  // Un presupuesto creado desde la oportunidad queda vinculado y en su historial.
  const opportunityId = opportunityUrl.split("/").pop()!;
  const quote = await postJson<{ number: string }>(page, "/api/sales-quotes", {
    customerId,
    issueDate: new Date().toISOString(),
    crmOpportunityId: opportunityId,
    lines: [{ description: "Diseño web", quantity: 1, unitPrice: 1500, taxRate: 21 }],
  });
  await page.reload();
  await expect(page.locator("dl")).toContainText(quote.number);
  await expect(page.getByTestId("crm-activity-list").nth(1)).toContainText(`Presupuesto ${quote.number} creado`);

  // Ganada: sale del embudo abierto y cuenta en el mes.
  await page.getByTestId("crm-mark-won").click();
  await expect(page.getByText("Ganada", { exact: true }).first()).toBeVisible();
  await page.goto("/crm");
  await expect(page.getByTestId("crm-stage-4")).toContainText("Web corporativa");
  await expect(page.getByTestId("crm-summary")).toContainText("Ganadas este mes (1)");

  // Mover con «Mover a…» (teclado/móvil) otra oportunidad.
  const second = await postJson<{ id: string }>(page, "/api/crm/opportunities", { title: "Mantenimiento anual", contactName: "Luis Lead", amount: 600 });
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("crm-stage-0")).toContainText("Mantenimiento anual");
  await page.getByTestId(`crm-card-move-${second.id}`).selectOption({ label: "Mover a: Propuesta enviada" });
  await expect(page.getByTestId("crm-stage-2")).toContainText("Mantenimiento anual");
  await page.reload();
  await expect(page.getByTestId("crm-stage-2")).toContainText("Mantenimiento anual");

  // Agenda: la llamada vencida está en «Vencidas»; al marcarla pasa a hechas.
  await page.goto("/crm/activities");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Vencidas (1)")).toBeVisible();
  await page.getByRole("checkbox", { name: "Marcar «Llamar para cerrar» como hecha" }).check();
  await expect(page.getByText("Vencidas (1)")).toHaveCount(0);

  // Etapas: renombrar e intercambiar nombres (el servidor evita el choque de nombres únicos).
  await page.goto("/crm/settings");
  await page.waitForLoadState("networkidle");
  const editor = page.getByTestId("crm-stages-editor");
  await editor.getByLabel("Etapa 2").fill("Negociación");
  await editor.getByLabel("Etapa 4").fill("Cualificado");
  await page.getByTestId("crm-stages-save").click();
  await expect(page.getByText("Embudo guardado.")).toBeVisible();
  await page.goto("/crm");
  await expect(page.getByTestId("crm-stage-1")).toContainText("Negociación");
  await expect(page.getByTestId("crm-stage-3")).toContainText("Cualificado");

  // La ficha del cliente muestra sus oportunidades.
  await page.goto(`/customers/${customerId}`);
  await expect(page.getByTestId("customer-crm-panel")).toContainText("Web corporativa");
});
