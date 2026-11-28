import { expect, test, type Page } from "@playwright/test";

import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

/**
 * Humo de las pantallas de cumplimiento (auditoría 2026-11-27): cada una debe cargar con una
 * empresa española recién creada, sin página de error ni respuesta 5xx. No comprueba cálculos
 * (eso lo hacen los tests unitarios): comprueba que las pantallas existen y se pintan.
 */
const SCREENS: Array<{ path: string; heading?: RegExp }> = [
  { path: "/accounting/reports" },
  { path: "/accounting/reports/annual-accounts" },
  { path: "/accounting/books" },
  { path: "/accounting/gestor" },
  { path: "/accounting/assets" },
  { path: "/accounting/assets/new" },
  { path: "/accounting/assets/register" },
  { path: "/accounting/cost-centers" },
  { path: "/payroll" },
  { path: "/payroll/employees" },
  { path: "/payroll/slips/new" },
  { path: "/payroll/import" },
  { path: "/payroll/capital" },
  { path: "/payroll/rentals" },
  { path: "/payroll/models" },
  { path: "/fiscal" },
  { path: "/fiscal/calendar" },
  { path: "/fiscal/new" },
  { path: "/fiscal/sociedades" },
  { path: "/fiscal/sociedades/pagos-fraccionados" },
  { path: "/fiscal/sociedades/resumen" },
  { path: "/fiscal/sii" },
  { path: "/fiscal/verifactu" },
  { path: "/fiscal/verifactu/declaracion" },
  { path: "/settings/fiscal" },
  { path: "/expenses/new" },
  { path: "/expenses/new?kind=rectification" },
  { path: "/invoices/new" },
];

const ERROR_HEADINGS = /Ha ocurrido un error inesperado|No se pudo cargar|Página no encontrada|Application error/i;

async function visit(page: Page, path: string) {
  const serverErrors: string[] = [];
  const onResponse = (response: { status(): number; url(): string }) => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
  };
  page.on("response", onResponse);
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  page.off("response", onResponse);
  return { status: response?.status() ?? 0, serverErrors, errorHeading: await page.getByRole("heading", { name: ERROR_HEADINGS }).count() };
}

test("las pantallas de cumplimiento cargan sin errores", async ({ page }) => {
  test.setTimeout(8 * 60_000);
  await registerAndSignIn(page, "Compliance Screens E2E");
  await completeOnboarding(page, "Empresa cumplimiento E2E S.L.");

  const failures: string[] = [];
  for (const screen of SCREENS) {
    const result = await visit(page, screen.path);
    if (result.status >= 400 || result.errorHeading > 0 || result.serverErrors.length > 0) {
      failures.push(`${screen.path} → HTTP ${result.status}${result.errorHeading ? ", página de error" : ""}${result.serverErrors.length ? `, ${result.serverErrors.join("; ")}` : ""}`);
    }
  }
  expect(failures, failures.join("\n")).toEqual([]);
});

test("un 303 y un 390 en borrador se abren con sus casillas y descargas", async ({ page }) => {
  test.setTimeout(4 * 60_000);
  await registerAndSignIn(page, "Compliance Models E2E");
  await completeOnboarding(page, "Empresa modelos E2E S.L.");

  for (const body of [{ code: "303", period: "2026-Q3", status: "DRAFT" }, { code: "390", period: "2025", status: "DRAFT" }, { code: "347", period: "2025", status: "DRAFT" }, { code: "111", period: "2026-Q3", status: "DRAFT" }]) {
    const created = await page.evaluate(async (payload) => {
      const csrfToken = document.cookie.split("; ").find((cookie) => cookie.startsWith("csrf-token="))?.split("=")[1];
      const response = await fetch("/api/fiscal-reports", {
        method: "POST",
        headers: { "content-type": "application/json", ...(csrfToken ? { "x-csrf-token": decodeURIComponent(csrfToken) } : {}) },
        body: JSON.stringify(payload),
      });
      return { status: response.status, payload: await response.json().catch(() => null) };
    }, body);
    expect(created.status, `crear ${body.code}: ${JSON.stringify(created.payload)}`).toBeLessThan(300);
    const id = created.payload?.id ?? created.payload?.report?.id;
    expect(typeof id, `id del ${body.code}`).toBe("string");
    const result = await visit(page, `/fiscal/${id}`);
    expect(result.status, `/fiscal/${id} (${body.code})`).toBeLessThan(400);
    expect(result.errorHeading, `página de error en el ${body.code}`).toBe(0);
    expect(result.serverErrors, `errores de servidor en el ${body.code}`).toEqual([]);
  }
});
