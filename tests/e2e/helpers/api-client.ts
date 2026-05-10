import { expect, type Page } from "@playwright/test";

export async function postJson<T>(page: Page, path: string, body: Record<string, unknown>): Promise<T> {
  const response = await page.evaluate(
    async ({ path, body }) => {
      const csrfToken = document.cookie
        .split("; ")
        .find((cookie) => cookie.startsWith("csrf-token="))
        ?.split("=")[1];

      const response = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": decodeURIComponent(csrfToken) } : {}),
        },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        payload: text ? JSON.parse(text) : null,
      };
    },
    { path, body },
  );

  expect(response.ok, `POST ${path} failed with status ${response.status}: ${JSON.stringify(response.payload)}`).toBeTruthy();
  return response.payload as T;
}
