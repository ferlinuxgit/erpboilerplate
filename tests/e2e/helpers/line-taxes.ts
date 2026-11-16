import { expect, type Page } from "@playwright/test";

/** Elige los impuestos de una línea de factura en su diálogo («IVA» y «Retención») y aplica. */
export async function setLineTaxes(page: Page, lineNumber: number, choice: { vat?: string; retention?: string }) {
  await page.getByTestId(`invoice-line-${lineNumber}-taxes`).click();
  const dialog = page.getByRole("dialog", { name: `Impuestos de la línea ${lineNumber}` });
  await expect(dialog).toBeVisible();
  if (choice.vat) await dialog.getByRole("group", { name: "IVA" }).getByRole("radio", { name: choice.vat, exact: true }).check();
  if (choice.retention) await dialog.getByRole("group", { name: "Retención (IRPF)" }).getByRole("radio", { name: choice.retention, exact: true }).check();
  await dialog.getByRole("button", { name: "Aplicar" }).click();
  await expect(dialog).toBeHidden();
}
