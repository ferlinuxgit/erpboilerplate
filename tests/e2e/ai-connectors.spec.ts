import { createHash, randomBytes } from "node:crypto";

import { expect, request as playwrightRequest, test } from "@playwright/test";

import { registerAndSignIn } from "./helpers/authenticated-session";

const REDIRECT_URI = "https://client.example.test/oauth/callback";

test("Claude/ChatGPT connect in one click: OAuth discovery, consent, PKCE token and MCP tools with the user's permissions", async ({ page, baseURL }) => {
  // Recorrido completo (OAuth + MCP + Ajustes): en modo dev compila muchas rutas por primera vez.
  test.setTimeout(480_000);
  await registerAndSignIn(page, "AI Connector");

  // Descubrimiento (lo primero que hace el cliente tras recibir un 401 del MCP).
  const anonymous = await playwrightRequest.newContext({ baseURL });
  const unauthorized = await anonymous.post("/api/mcp", { data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  expect(unauthorized.status()).toBe(401);
  expect(unauthorized.headers()["www-authenticate"]).toContain("/.well-known/oauth-protected-resource/api/mcp");
  const resource = await (await anonymous.get("/.well-known/oauth-protected-resource/api/mcp")).json();
  expect(resource.resource).toMatch(/\/api\/mcp$/);
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
  const code = returned.searchParams.get("code");
  expect(code).toBeTruthy();

  // Canje del código con PKCE (formulario, como los clientes reales).
  const tokenResponse = await anonymous.post("/api/oauth/token", {
    form: { grant_type: "authorization_code", code: code!, redirect_uri: REDIRECT_URI, client_id: clientId, code_verifier: verifier },
  });
  expect(tokenResponse.status(), await tokenResponse.text()).toBe(200);
  const tokens = await tokenResponse.json();
  expect(tokens.scope).toBe("erp:read");

  // MCP con el token: initialize, herramientas de solo lectura y una consulta real.
  const client = await playwrightRequest.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${tokens.access_token}` } });
  const rpc = async (method: string, params: Record<string, unknown> = {}) => (await (await client.post("/api/mcp", { data: { jsonrpc: "2.0", id: 1, method, params } })).json()).result;
  expect((await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } })).serverInfo.name).toBe("erp");
  const tools = (await rpc("tools/list")).tools.map((tool: { name: string }) => tool.name);
  expect(tools).toEqual(expect.arrayContaining(["search", "fetch", "erp_contexto", "erp_listar_facturas", "erp_catalogo"]));
  expect(tools).not.toContain("erp_crear_factura");
  const contextResult = await rpc("tools/call", { name: "erp_contexto", arguments: {} });
  expect(contextResult.isError).toBeFalsy();
  expect(contextResult.structuredContent.accessLevel).toBe("solo consultar");
  const invoices = await rpc("tools/call", { name: "erp_listar_facturas", arguments: {} });
  expect(invoices.isError).toBeFalsy();

  // Solo lectura: ni el MCP ni la API directa permiten escribir.
  const write = await rpc("tools/call", { name: "erp_ejecutar_accion", arguments: { metodo: "POST", ruta: "/api/customers", cuerpo: { name: "X" } } });
  expect(write.isError).toBe(true);
  expect((await client.post("/api/customers", { data: { name: "X" } })).status()).toBe(403);

  // La conexión aparece en Ajustes y se puede desconectar.
  await page.goto("/settings/ai");
  await expect(page.getByRole("heading", { name: "Conectar con IA", level: 1 })).toBeVisible();
  const connections = page.getByTestId("ai-connections");
  // La lista se carga en el cliente (la primera vez el servidor de desarrollo compila la ruta).
  await expect(connections.getByText("Claude", { exact: true })).toBeVisible({ timeout: 30_000 });
  // En `next dev` la primera visita compila rutas y dispara un Fast Refresh que recarga la página:
  // se recarga una vez antes de interactuar para no pulsar durante esa recarga.
  await page.reload();
  await expect(connections.getByText("Claude", { exact: true })).toBeVisible({ timeout: 30_000 });
  await connections.getByRole("button", { name: "Desconectar" }).click();
  await expect(connections.getByText("Ninguna aplicación conectada todavía.")).toBeVisible({ timeout: 30_000 });
  expect((await client.post("/api/mcp", { data: { jsonrpc: "2.0", id: 2, method: "tools/list" } })).status()).toBe(401);

  await client.dispose();
  await anonymous.dispose();
});
