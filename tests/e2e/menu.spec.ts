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

// PNG de 2×2 píxeles para probar la subida de fotos.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==", "base64");

test("Carta digital: secciones desde categorías, ficha con alérgenos y foto, agotados, carta pública con filtros, inglés y QR por mesa", async ({ browser, page }) => {
  test.setTimeout(180_000);
  await registerAndSignIn(page, "Carta E2E");
  await completeOnboarding(page, "Bar La Carta E2E S.L.");

  await api(page, "PUT", "/api/modules", { moduleId: "pos", enabled: true });
  await api(page, "PUT", "/api/modules", { moduleId: "hospitality", enabled: true });
  const taxes = await api<Array<{ id: string; rate: string; kind: string; operation: string }>>(page, "GET", "/api/taxes");
  const vat10 = taxes.find((entry) => Number(entry.rate) === 10 && entry.kind === "VAT" && entry.operation === "ADD")!;
  const starters = await postJson<{ id: string }>(page, "/api/item-categories", { code: "ENT", name: "Entrantes" });
  const drinks = await postJson<{ id: string }>(page, "/api/item-categories", { code: "BEB", name: "Bebidas" });
  await postJson(page, "/api/items", { name: "Croquetas", sku: "CROQ", salePrice: 7, isService: true, categoryId: starters.id, defaultTaxId: vat10.id });
  await postJson(page, "/api/items", { name: "Caña", sku: "CANA", salePrice: 2, isService: true, categoryId: drinks.id, defaultTaxId: vat10.id });
  const register = await postJson<{ id: string }>(page, "/api/pos/registers", { name: "Sala", seriesCode: "C", seriesPrefix: "C", simplifiedLimit: 400, mode: "TABLES" });
  const area = await postJson<{ id: string }>(page, "/api/pos/hospitality/areas", { name: "Terraza" });
  await postJson(page, "/api/pos/hospitality/tables", { areaId: area.id, prefix: "Mesa", from: 1, to: 2, seats: 4 });
  const floor = await api<{ areas: Array<{ tables: Array<{ id: string; name: string }> }> }>(page, "GET", `/api/pos/hospitality/floor?registerId=${register.id}`);
  const table1 = floor.areas[0].tables.find((table) => table.name === "Mesa 1")!;

  // Arranque rápido: una sección por categoría con sus artículos.
  await page.goto("/pos/menu");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("menu-import").click();
  await expect(page.getByText("2 secciones y 2 platos añadidos.")).toBeVisible();
  await expect(page.getByTestId("menu-section-Entrantes")).toBeVisible();

  // Ficha de las croquetas: alérgenos, recomendado, inglés y foto.
  await page.getByTestId("menu-dish-Croquetas").getByTestId("menu-dish-edit").click();
  const dialog = page.getByTestId("menu-dish-dialog");
  await dialog.getByLabel("Descripción", { exact: true }).fill("Caseras, de jamón ibérico");
  await dialog.getByLabel("En inglés", { exact: true }).fill("Ham croquettes");
  await dialog.getByTestId("menu-allergen-GLUTEN").click();
  await dialog.getByTestId("menu-allergen-MILK").click();
  // Sésamo: dos toques = puede contener trazas.
  await dialog.getByTestId("menu-allergen-SESAME").click();
  await dialog.getByTestId("menu-allergen-SESAME").click();
  await expect(dialog.getByTestId("menu-allergen-SESAME")).toHaveAttribute("data-state", "traces");
  // Marcarla vegana con lácteos avisa de la incoherencia.
  await dialog.getByTestId("menu-tag-VEGAN").click();
  await expect(dialog.getByTestId("menu-dish-conflicts")).toContainText("vegano pero lleva lácteos");
  await dialog.getByTestId("menu-tag-VEGAN").click();
  await expect(dialog.getByTestId("menu-dish-conflicts")).toHaveCount(0);
  // Apta para embarazadas con lácteos: pide confirmar que están pasteurizados.
  await dialog.getByTestId("menu-tag-PREGNANCY_SAFE").click();
  await expect(dialog.getByTestId("menu-dish-conflicts")).toContainText("pasteurizados");
  await dialog.getByTestId("menu-tag-PASTEURIZED").click();
  await expect(dialog.getByTestId("menu-dish-conflicts")).toHaveCount(0);
  await dialog.getByTestId("menu-tag-RECOMMENDED").click();
  await dialog.locator('input[type="file"]').setInputFiles({ name: "croquetas.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("Foto guardada.")).toBeVisible();
  await dialog.getByTestId("menu-dish-save").click();
  await expect(page.getByText("Ficha guardada.")).toBeVisible();
  await expect(page.getByTestId("menu-dish-Croquetas").locator("img")).toBeVisible();
  // La caña sigue sin revisar: se avisa en la gestión.
  await expect(page.getByTestId("menu-allergen-alert")).toContainText("1 plato de la carta sin revisar alérgenos");
  await expect(page.getByTestId("menu-dish-Caña").getByTestId("menu-dish-unreviewed")).toBeVisible();

  // Menú del día con precio cerrado (sin platos todavía: se muestra igual con su precio).
  await page.getByTestId("menu-section-new").click();
  const sectionDialog = page.getByTestId("menu-section-dialog");
  await sectionDialog.getByLabel("Nombre").fill("Menú del día");
  await sectionDialog.getByLabel("Precio cerrado (opcional)").fill("14,50");
  await sectionDialog.getByTestId("menu-section-save").click();
  await expect(page.getByText("Sección creada.")).toBeVisible();

  // Se acaba la cerveza: agotada hoy.
  await page.getByTestId("menu-dish-Caña").getByTestId("menu-dish-sold-out").click();
  await expect(page.getByText("Caña: agotado hoy.")).toBeVisible();

  // Publicar.
  const slug = `carta-e2e-${Date.now().toString(36)}`;
  await page.getByTestId("menu-enabled").click();
  await page.getByTestId("menu-slug").fill(slug);
  await page.getByTestId("menu-settings-save").click();
  await expect(page.getByText("Carta publicada.")).toBeVisible();

  // El cliente escanea el QR de la Mesa 1 (sin sesión).
  const guest = await browser.newContext({ locale: "es-ES" });
  const customer = await guest.newPage();
  await customer.goto(`/carta/${slug}?mesa=${table1.id}`);
  const menu = customer.getByTestId("public-menu");
  await expect(menu.getByTestId("public-menu-table")).toHaveText("Mesa 1");
  await expect(menu.getByTestId("public-menu-dish-Croquetas")).toContainText(/7,70/);
  await expect(menu.getByTestId("public-menu-dish-Croquetas")).toContainText("Gluten");
  await expect(menu.getByTestId("public-menu-dish-Croquetas")).toContainText("Sésamo · trazas");
  await expect(menu.getByTestId("public-menu-dish-Caña")).toContainText("Pregunta por sus alérgenos");
  await expect(menu.getByTestId("public-menu-dish-Caña").getByTestId("public-menu-sold-out")).toHaveText("Agotado");
  await expect(menu).toContainText(/14,50/);
  const photoLoaded = await menu.getByTestId("public-menu-dish-Croquetas").locator("img").evaluate((image: HTMLImageElement) => image.decode().then(() => image.naturalWidth > 0));
  expect(photoLoaded).toBe(true);

  // Alergia al sésamo: las croquetas siguen, avisando de las trazas.
  await customer.getByTestId("public-menu-filters").click();
  await customer.getByTestId("public-menu-without-SESAME").click();
  await expect(menu.getByTestId("public-menu-dish-Croquetas")).toContainText("Puede contener trazas de: Sésamo");
  // Celiaco: se ocultan; sin ocultar, se ven marcadas en rojo.
  await customer.getByTestId("public-menu-without-GLUTEN").click();
  await expect(menu.getByTestId("public-menu-dish-Croquetas")).toHaveCount(0);
  await expect(menu.getByTestId("public-menu-dish-Caña")).toBeVisible();
  await customer.getByTestId("public-menu-hide").click();
  await expect(menu.getByTestId("public-menu-dish-Croquetas").getByTestId("public-menu-warning")).toHaveText("Contiene: Gluten");
  // Se recuerda en el móvil.
  await customer.reload();
  await expect(customer.getByTestId("public-menu-filters")).toContainText("(2)");
  await customer.getByTestId("public-menu-filters").click();
  await customer.getByRole("button", { name: "Quitar filtros" }).click();
  // Embarazada: solo lo marcado como apto (las croquetas sí, la caña no).
  await customer.getByTestId("public-menu-pregnant").click();
  await expect(menu.getByTestId("public-menu-dish-Croquetas")).toContainText("Apto embarazadas");
  await expect(menu.getByTestId("public-menu-dish-Croquetas")).toContainText("Pasteurizado");
  await expect(menu.getByTestId("public-menu-dish-Caña")).toHaveCount(0);
  await customer.getByTestId("public-menu-pregnant").click();
  await customer.getByTestId("public-menu-search").fill("jamon");
  await expect(menu.getByTestId("public-menu-dish-Croquetas")).toBeVisible();
  await expect(menu.getByTestId("public-menu-dish-Caña")).toHaveCount(0);

  // En inglés (los filtros se conservan al cambiar de idioma).
  await customer.getByTestId("public-menu-search").fill("");
  await customer.getByRole("link", { name: "en", exact: true }).click();
  await expect(customer.getByTestId("public-menu-dish-Ham croquettes")).toBeVisible();
  await expect(customer.getByTestId("public-menu")).toContainText("Sold out");
  await guest.close();

  // Tabla de alérgenos imprimible.
  await page.goto("/pos/menu/alergenos");
  await expect(page.getByTestId("allergen-matrix").getByRole("rowheader", { name: /Croquetas/ })).toBeVisible();
  await expect(page.getByTestId("allergen-matrix").getByRole("img", { name: "Sésamo (trazas)" })).toBeVisible();

  // Hoja de QR: general + una por mesa.
  await page.goto("/pos/menu/qr");
  await expect(page.getByTestId("menu-qr-sheet").locator("li")).toHaveCount(3);
  await expect(page.getByTestId("menu-qr-Mesa 2")).toBeVisible();

  // Sin el módulo, la carta deja de verse.
  await api(page, "PUT", "/api/modules", { moduleId: "hospitality", enabled: false });
  const anonymous = await browser.newContext({ locale: "es-ES" });
  const visitor = await anonymous.newPage();
  await visitor.goto(`/carta/${slug}`);
  await expect(visitor.getByRole("heading", { name: "Carta no disponible" })).toBeVisible();
  await anonymous.close();
});
