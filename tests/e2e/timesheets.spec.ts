import { expect, test, type Page } from "@playwright/test";

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

test("Registro de jornada: fichar desde la app y la tablet con PIN, corregir con motivo y exportar", async ({ page }) => {
  test.setTimeout(180_000);
  await registerAndSignIn(page, "Jornada E2E");
  await completeOnboarding(page, "Taberna Jornada E2E S.L.");
  for (const moduleId of ["pos", "hospitality", "timesheets"]) await api(page, "PUT", "/api/modules", { moduleId, enabled: true });
  const staff = await api<Array<{ userId: string; name: string }>>(page, "GET", "/api/pos/hospitality/staff");
  const me = staff[0];
  await api(page, "PUT", `/api/pos/hospitality/staff/${me.userId}`, { pin: "4321" });

  // Fichar desde la app: entrada, pausa, vuelta y salida (solo se ofrece lo que toca).
  await page.goto("/jornada");
  await page.waitForLoadState("networkidle");
  const clock = page.getByTestId("timesheet-my-clock");
  await expect(clock.getByTestId("timesheet-state")).toHaveText("Fuera");
  await expect(clock.getByTestId("timesheet-action-OUT")).toHaveCount(0);
  await clock.getByTestId("timesheet-action-IN").click();
  await expect(clock.getByTestId("timesheet-state")).toHaveText("Trabajando");
  await clock.getByTestId("timesheet-action-BREAK_START").click();
  await expect(clock.getByTestId("timesheet-state")).toHaveText("En pausa");
  await expect(clock.getByTestId("timesheet-action-OUT")).toHaveCount(0);
  await clock.getByTestId("timesheet-action-BREAK_END").click();
  await expect(clock.getByTestId("timesheet-state")).toHaveText("Trabajando");
  await clock.getByTestId("timesheet-action-OUT").click();
  await expect(clock.getByTestId("timesheet-state")).toHaveText("Fuera");
  // No se puede fichar la salida dos veces.
  await expect(api(page, "POST", "/api/timesheets/clock", { kind: "OUT" })).rejects.toThrow(/No hay ninguna entrada abierta/);

  // En la tablet del local con su PIN.
  await page.goto("/fichar");
  await page.waitForLoadState("networkidle");
  for (const digit of ["4", "3", "2", "1"]) await page.getByRole("button", { name: digit, exact: true }).click();
  await page.getByTestId("timesheet-kiosk-ok").click();
  await expect(page.getByTestId("timesheet-kiosk-actions")).toContainText(me.name);
  await page.getByTestId("timesheet-kiosk-IN").click();
  await expect(page.getByTestId("timesheet-kiosk-done")).toContainText("Entrada");
  // PIN incorrecto.
  for (const digit of ["9", "9", "9", "9"]) await page.getByRole("button", { name: digit, exact: true }).click();
  await page.getByTestId("timesheet-kiosk-ok").click();
  await expect(page.getByTestId("timesheet-kiosk-error")).toContainText("PIN incorrecto");

  // El responsable ve el equipo, corrige y anula con motivo (nada se borra).
  await page.goto("/jornada");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId(`timesheet-now-${me.name}`)).toContainText("Trabajando");
  const worker = page.getByTestId(`timesheet-worker-${me.name}`);
  await worker.getByRole("button", { name: me.name }).click();
  const today = worker.locator('[data-testid^="timesheet-day-"]').first();
  await expect(today).toContainText("tablet");
  await today.getByRole("button", { name: /^Anular Entrada/ }).last().click();
  await page.getByLabel("Motivo").fill("Fichó dos veces por error");
  await page.getByRole("button", { name: "Anular marca" }).click();
  await expect(page.getByText("Marca anulada.")).toBeVisible();
  // La anulada se conserva a la vista, con su motivo.
  await expect(page.getByTestId(`timesheet-worker-${me.name}`)).toContainText("Fichó dos veces por error");

  await page.getByTestId(`timesheet-worker-${me.name}`).getByTestId("timesheet-correct").click();
  const correction = page.getByTestId("timesheet-correction-dialog");
  await correction.getByRole("radio", { name: "Entrada" }).click();
  await correction.getByLabel("Hora").fill("00:00");
  await correction.getByLabel("Motivo").fill("Entró antes y no fichó");
  await correction.getByTestId("timesheet-correction-save").click();
  await expect(page.getByText("Corrección registrada.")).toBeVisible();

  // Exportación para el gestor o la Inspección.
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit" }).format(new Date());
  const csv = await page.evaluate(async (url) => (await fetch(url)).text(), `/api/timesheets/export?month=${month}`);
  expect(csv).toContain("Trabajador;Fecha;Marcas");
  expect(csv).toContain(me.name);
  expect(csv).toContain("(corrección)");

  // Sin el módulo, no hay registro de jornada.
  await api(page, "PUT", "/api/modules", { moduleId: "timesheets", enabled: false });
  await page.goto("/jornada");
  await expect(page).toHaveURL(/\/modules\/timesheets/);
});
