import { expect, test } from "@playwright/test";

import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

test("catálogo de impuestos y tratamientos de IVA: solo lo que se usa aparece al facturar", async ({ page }) => {
  test.setTimeout(120_000);
  await registerAndSignIn(page, "Tax Catalog");
  await completeOnboarding(page, "Empresa catálogo S.L.");

  // Catálogo: los habituales vienen en uso; el IRPF 7 % está disponible pero sin usar.
  await page.goto("/settings/fiscal#impuestos");
  const catalog = page.getByTestId("tax-catalog");
  await expect(catalog.getByRole("checkbox", { name: /IVA general 21%.*\(lo uso\)/ })).toBeChecked();
  const irpf7 = catalog.getByRole("checkbox", { name: /Retención IRPF 7%/ });
  await expect(irpf7).not.toBeChecked();

  // En la factura todavía no se ofrece.
  await page.goto("/invoices/new");
  await page.getByTestId("invoice-line-1-taxes").click();
  const lineDialog = page.getByRole("dialog", { name: "Impuestos de la línea 1" });
  await expect(lineDialog.getByRole("radio", { name: "Retención IRPF 15%", exact: true })).toBeVisible();
  await expect(lineDialog.getByRole("radio", { name: "Retención IRPF 7%", exact: true })).toHaveCount(0);
  await lineDialog.getByRole("button", { name: "Cancelar" }).click();

  // Se activa con un clic y ya aparece al facturar.
  await page.goto("/settings/fiscal#impuestos");
  await irpf7.check();
  await expect(irpf7).toBeChecked();
  await expect(page.getByText("«Retención IRPF 7%» activado: ya aparece al facturar.")).toBeVisible();

  // Tratamientos de IVA: se deja de usar la exportación.
  const treatments = page.getByTestId("vat-treatments");
  const exportTreatment = treatments.getByRole("checkbox", { name: /Exportación/ });
  await expect(exportTreatment).toBeChecked();
  await exportTreatment.uncheck();
  await expect(exportTreatment).not.toBeChecked();
  await expect(page.getByText("«Exportación (fuera de la UE)» desactivado.")).toBeVisible();

  await page.goto("/invoices/new");
  await page.getByTestId("invoice-line-1-taxes").click();
  await expect(page.getByRole("dialog", { name: "Impuestos de la línea 1" }).getByRole("radio", { name: "Retención IRPF 7%", exact: true })).toBeVisible();
  await page.getByRole("dialog", { name: "Impuestos de la línea 1" }).getByRole("button", { name: "Cancelar" }).click();
  await page.getByTestId("invoice-vat-treatment-picker").click();
  const treatmentDialog = page.getByRole("dialog", { name: "Tratamiento de IVA" });
  await expect(treatmentDialog.getByRole("radio", { name: /Nacional/ })).toBeChecked();
  await expect(treatmentDialog.getByRole("radio", { name: /Exportación/ })).toHaveCount(0);
});
