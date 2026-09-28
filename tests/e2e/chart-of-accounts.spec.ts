import { expect, test } from "@playwright/test";

import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

/**
 * Plan contable jerárquico: árbol (treegrid) con niveles, teclado, búsqueda con el atajo del
 * punto y por nombre, ficha con sumas y vista Esquema con los 9 grupos del PGC.
 */
test("plan contable: árbol por niveles, teclado, búsqueda, ficha y esquema", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  const runId = `${testInfo.workerIndex}-${Date.now()}`;
  await registerAndSignIn(page, `Chart E2E ${runId}`);
  await completeOnboarding(page, `Empresa plan ${runId} S.L.`);

  // Subcuenta de cliente creada desde «Crear subcuenta aquí» (cuenta padre 430).
  await page.goto("/accounting/accounts/new?parent=430");
  await expect(page.getByLabel("Cuenta padre")).toHaveValue(/^430 · /);
  await page.getByLabel("Código").fill("43000077");
  await page.getByLabel("Nombre").fill("Cliente Árbol E2E");
  await page.getByLabel("Tipo").selectOption("ASSET");
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page).toHaveURL(/\/accounting\/accounts\?(.*&)?sel=43000077/);

  await page.goto("/accounting/accounts");
  const tree = page.getByRole("treegrid", { name: "Plan contable" });
  await expect(tree).toBeVisible();

  // Nivel 1: los 9 grupos del PGC, plegados.
  await page.getByRole("button", { name: "Desplegar hasta el nivel 1" }).click();
  await expect(page.getByRole("button", { name: "Desplegar hasta el nivel 1" })).toHaveAttribute("aria-pressed", "true");
  await expect(tree.locator("[role='row'][aria-level='1']")).toHaveCount(9);
  await expect(tree).toHaveAttribute("aria-rowcount", "10");
  const firstGroup = tree.locator("[role='row'][data-code='1']");
  await expect(firstGroup).toContainText("Financiación básica");
  await expect(firstGroup).toHaveAttribute("aria-expanded", "false");

  // Teclado: → despliega el grupo (carga perezosa de sus subgrupos) y ↓ baja al primer hijo.
  await firstGroup.click();
  await page.keyboard.press("ArrowRight");
  await expect(firstGroup).toHaveAttribute("aria-expanded", "true");
  const capital = tree.locator("[role='row'][data-code='10']");
  await expect(capital).toBeVisible();
  await expect(capital).toHaveAttribute("aria-level", "2");
  await page.keyboard.press("ArrowDown");
  await expect(capital).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(firstGroup).toBeFocused();

  // Nivel 3: se despliegan grupos, subgrupos y cuentas de 3 dígitos.
  await page.getByRole("button", { name: "Desplegar hasta el nivel 3" }).click();
  await expect(tree.locator("[role='row'][data-code='100']")).toBeVisible();
  await expect.poll(async () => Number(await tree.getAttribute("aria-rowcount"))).toBeGreaterThan(300);

  // Búsqueda con el atajo del punto: 43.77 → 43000077, con su rama desplegada y seleccionada.
  const search = page.getByLabel("Buscar en el plan contable");
  await search.fill("43.77");
  const match = tree.locator("[role='row'][data-code='43000077']");
  await expect(match).toHaveAttribute("aria-selected", "true");
  await expect(tree.locator("[role='row'][data-code='4300']")).toHaveAttribute("aria-expanded", "true");
  await expect(match.locator("mark")).toHaveCount(1);

  // Ficha: ruta, sumas del periodo y acciones.
  const detail = page.getByTestId("account-detail");
  await expect(detail.getByRole("heading", { name: /43000077 · Cliente Árbol E2E/ })).toBeVisible();
  await expect(detail.getByRole("navigation", { name: "Ruta de la cuenta" })).toContainText("4300");
  for (const label of ["Saldo inicial", "Debe", "Haber", "Saldo"]) await expect(detail.getByText(label, { exact: true })).toBeVisible();
  await expect(detail.getByRole("link", { name: "Ver mayor" })).toBeVisible();

  // Búsqueda por nombre: resalta la coincidencia.
  await search.fill("Cliente Árbol");
  await expect(match).toHaveAttribute("aria-selected", "true");
  await expect(match.locator("mark")).toContainText("Cliente Árbol");

  // «/» vuelve a la búsqueda desde el árbol.
  await match.click();
  await page.keyboard.press("/");
  await expect(search).toBeFocused();

  // Esquema: 9 tarjetas de grupo y el resultado 7 − 6; un subgrupo abre el árbol en él.
  await search.fill("");
  await page.getByRole("button", { name: "Esquema" }).click();
  await expect(page.getByTestId("chart-scheme-group")).toHaveCount(9);
  await expect(page.getByTestId("chart-scheme-result")).toContainText("Resultado = 7 − 6");
  await page.getByRole("button", { name: /^43 clientes/i }).click();
  await expect(tree.locator("[role='row'][data-code='43']")).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/sel=43(&|$)/);
});
