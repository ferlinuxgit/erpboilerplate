import { createHash, randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";

import { registerViaApi } from "./helpers/authenticated-session";

const REDIRECT_URI = "https://client.example.test/oauth/callback";

// Ligero a propósito: una sola pantalla (el consentimiento) y el resto por HTTP. La lógica de
// OAuth y MCP está cubierta por los unitarios (src/server/oauth, src/server/mcp).
test("Claude/ChatGPT: descubrimiento OAuth, consentimiento, token PKCE y MCP con los permisos del usuario", async ({ page, playwright, baseURL }) => {
  test.setTimeout(120_000);
  await registerViaApi(page, "AI Connector");

  // Descubrimiento: lo primero que hace el cliente tras recibir un 401 del MCP.
  const anonymous = await playwright.request.newContext({ baseURL });
  const unauthorized = await anonymous.post("/api/mcp", { data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  expect(unauthorized.status()).toBe(401);
  expect(unauthorized.headers()["www-authenticate"]).toContain("/.well-known/oauth-protected-resource/api/mcp");
  const metadata = await (await anonymous.get("/.well-known/oauth-authorization-server")).json();
  expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);

  // Registro dinámico del cliente.
  const registration = await anonymous.post(new URL(metadata.registration_endpoint).pathname, { data: { client_name: "Claude", redirect_uris: [REDIRECT_URI] } });
  expect(registration.status()).toBe(201);
  const { client_id: clientId } = await registration.json();

  // Consentimiento: el usuario elige "Solo consultar" y permite.
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorizeUrl = `/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT_URI, code_challenge: challenge, code_challenge_method: "S256", state: "s1", scope: "erp:read erp:write" })}`;
  await page.route("https://client.example.test/**", (route) => route.fulfill({ status: 200, body: "ok" }));
  await page.goto(authorizeUrl);
  await expect(page.getByRole("heading", { name: "Conectar Claude con tu ERP" })).toBeVisible();
  await page.getByLabel("Solo consultar").check();
  const callback = page.waitForURL(/client\.example\.test\/oauth\/callback/);
  await page.getByRole("button", { name: "Permitir" }).click();
  await callback;
  const returned = new URL(page.url());
  expect(returned.searchParams.get("state")).toBe("s1");
  const code = returned.searchParams.get("code")!;
  expect(code).toBeTruthy();

  // Canje del código con PKCE (formulario, como los clientes reales).
  const tokenResponse = await anonymous.post("/api/oauth/token", {
    form: { grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, client_id: clientId, code_verifier: verifier },
  });
  expect(tokenResponse.status(), await tokenResponse.text()).toBe(200);
  const tokens = await tokenResponse.json();
  expect(tokens.scope).toBe("erp:read");

  // MCP con el token: solo herramientas de lectura y una consulta real.
  const client = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${tokens.access_token}` } });
  const rpc = async (method: string, params: Record<string, unknown> = {}) => (await (await client.post("/api/mcp", { data: { jsonrpc: "2.0", id: 1, method, params } })).json()).result;
  const tools = (await rpc("tools/list")).tools.map((tool: { name: string }) => tool.name);
  expect(tools).toEqual(expect.arrayContaining(["search", "fetch", "erp_contexto"]));
  expect(tools).not.toContain("erp_crear_factura");
  const contextResult = await rpc("tools/call", { name: "erp_contexto", arguments: {} });
  expect(contextResult.isError).toBeFalsy();
  expect(contextResult.structuredContent.accessLevel).toBe("solo consultar");

  // Solo lectura también en la API directa.
  expect((await client.post("/api/customers", { data: { name: "X" } })).status()).toBe(403);

  // La conexión aparece en la lista del usuario y, al desconectarla, el token deja de valer.
  const grants = await (await page.request.get("/api/oauth/grants")).json();
  const grant = grants.find((entry: { clientName: string }) => entry.clientName === "Claude");
  expect(grant?.scope).toBe("read");
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === "csrf-token")?.value ?? "";
  const revoked = await page.request.delete(`/api/oauth/grants?id=${encodeURIComponent(grant.id)}`, { headers: { "x-csrf-token": decodeURIComponent(csrf) } });
  expect(revoked.ok(), await revoked.text()).toBeTruthy();
  expect((await client.post("/api/mcp", { data: { jsonrpc: "2.0", id: 2, method: "tools/list" } })).status()).toBe(401);

  await client.dispose();
  await anonymous.dispose();
});
