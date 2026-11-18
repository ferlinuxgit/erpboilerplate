import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

test("cuenta y datos: exportación completa, baja del espacio en solo lectura y anularla", async ({ page }) => {
  test.setTimeout(120_000);
  await registerAndSignIn(page, "Account Data");
  await completeOnboarding(page, "Empresa exportación S.L.");

  await page.goto("/settings/data");
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("tenant-export").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^exportacion-\d{4}-\d{2}-\d{2}\.zip$/);
  const files = unzipSync(new Uint8Array(await readFile((await download.path())!)));
  expect(Object.keys(files)).toEqual(expect.arrayContaining(["LEEME.txt", "manifiesto.json", "datos/company.jsonl", "datos/invoice.jsonl"]));
  expect(strFromU8(files["datos/company.jsonl"])).toContain("Empresa exportación S.L.");

  // Baja: el espacio queda en solo lectura (402 al crear) y se puede anular.
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByTestId("tenant-close").click();
  await expect(page.getByText("Baja solicitada", { exact: true })).toBeVisible();
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === "csrf-token")?.value ?? "";
  const blocked = await page.request.post("/api/customers", { headers: { "x-csrf-token": decodeURIComponent(csrf) }, data: { name: "Cliente nuevo" } });
  expect(blocked.status()).toBe(402);
  await page.getByRole("button", { name: "Anular la baja" }).click();
  await expect(page.getByTestId("tenant-close")).toBeVisible();
});
