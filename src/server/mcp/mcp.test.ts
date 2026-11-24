import { describe, expect, it, vi } from "vitest";

import { buildCatalog } from "../../../scripts/generate-api-catalog.mjs";
import catalogFile from "@/server/mcp/api-catalog.generated.json";
import { buildOpenApi, findAction, isBlockedPath, MCP_TOOL_COUNT, searchActions } from "@/server/mcp/catalog";
import { handleMcpMessage } from "@/server/mcp/protocol";
import { apiPathToAppPath, appPathToApiPath, callTool, listTools, toolNames, type McpCallContext } from "@/server/mcp/tools";

const context = (scope: "read" | "write" = "write"): McpCallContext => ({
  authorization: "Bearer token",
  clientIp: "203.0.113.5",
  internalOrigin: "http://127.0.0.1:3000",
  publicOrigin: "https://erp.example.com",
  scope,
});

describe("catálogo de la API", () => {
  it("está al día con src/app/api (npm run api:catalog)", () => {
    expect(JSON.stringify(buildCatalog())).toBe(JSON.stringify(catalogFile));
  });

  it("cubre toda la API con permisos y cuerpos y resuelve rutas concretas", () => {
    expect(catalogFile.length).toBeGreaterThan(390);
    expect(findAction("POST", "/api/invoices/abc-123/issue")?.path).toBe("/api/invoices/{id}/issue");
    expect(findAction("GET", "/api/invoices")?.permissions).toContain("invoice.read");
    expect(findAction("POST", "/api/invoices")?.body).toContain("createInvoiceSchema");
    expect(findAction("DELETE", "/api/nada")).toBeNull();
  });

  it("no expone a la IA sesión, credenciales ni OAuth", () => {
    expect(isBlockedPath("/api/auth/login")).toBe(true);
    expect(isBlockedPath("/api/api-keys")).toBe(true);
    expect(isBlockedPath("/api/oauth/token")).toBe(true);
    expect(isBlockedPath("/api/invoices")).toBe(false);
    expect(searchActions({ text: "login" }).actions.some((action) => action.path.startsWith("/api/auth"))).toBe(false);
    expect(searchActions({ text: "remesa sepa" }).actions.some((action) => action.path.startsWith("/api/sepa"))).toBe(true);
  });

  it("genera OpenAPI 3.1 con OAuth y una operación por acción", () => {
    const spec = buildOpenApi("https://erp.example.com") as { openapi: string; paths: Record<string, Record<string, { operationId: string }>>; components: { securitySchemes: { oauth: { flows: { authorizationCode: { tokenUrl: string } } } } } };
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.paths["/api/invoices/{id}/issue"].post.operationId).toBe("post_invoices_id_issue");
    expect(spec.components.securitySchemes.oauth.flows.authorizationCode.tokenUrl).toBe("https://erp.example.com/api/oauth/token");
    expect(spec.paths["/api/auth/login"]).toBeUndefined();
  });
});

describe("herramientas MCP", () => {
  it("incluye search/fetch (ChatGPT), las de uso diario y la ejecución genérica", () => {
    expect(toolNames).toHaveLength(MCP_TOOL_COUNT);
    expect(toolNames).toEqual(expect.arrayContaining(["search", "fetch", "erp_contexto", "erp_panel", "erp_crear_factura", "erp_catalogo", "erp_describir_accion", "erp_ejecutar_accion"]));
    const createInvoice = listTools("write").find((tool) => tool.name === "erp_crear_factura");
    expect(createInvoice?.inputSchema).toMatchObject({ type: "object", properties: { lines: { type: "array" }, issueDate: { type: "string" } } });
    expect(createInvoice?.annotations.readOnlyHint).toBe(false);
  });

  it("una conexión de solo lectura no ve ni ejecuta herramientas de escritura", async () => {
    const readTools = listTools("read").map((tool) => tool.name);
    expect(readTools).toContain("erp_listar_facturas");
    expect(readTools).not.toContain("erp_crear_factura");
    expect(readTools).not.toContain("erp_ejecutar_accion");
    const result = await callTool("erp_crear_cliente", { name: "X" }, context("read"));
    expect(result.isError).toBe(true);
  });

  it("traduce pantallas de la app y recursos de la API", () => {
    expect(appPathToApiPath("/invoices/abc")).toBe("/api/invoices/abc");
    expect(appPathToApiPath("/inventory/items/9")).toBe("/api/items/9");
    expect(apiPathToAppPath("/api/sales-quotes/7")).toBe("/sales/quotes/7");
    expect(appPathToApiPath("/invoices/abc/edit")).toBeNull();
  });

  it("ejecuta llamando a la API con el token y la IP del usuario", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "inv-1", number: "F-1" }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await callTool("erp_ejecutar_accion", { metodo: "POST", ruta: "/api/invoices/inv-1/issue", cuerpo: {} }, context());
    expect(result.isError).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe("http://127.0.0.1:3000/api/invoices/inv-1/issue");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token");
    expect((init.headers as Record<string, string>)["x-forwarded-for"]).toBe("203.0.113.5");
    fetchMock.mockRestore();
  });

  it("rechaza rutas bloqueadas o inexistentes sin llamar a la API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect((await callTool("erp_ejecutar_accion", { metodo: "POST", ruta: "/api/api-keys" }, context())).isError).toBe(true);
    expect((await callTool("erp_ejecutar_accion", { metodo: "GET", ruta: "/api/no-existe" }, context())).isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("search devuelve ids de la API y URLs públicas", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ results: [{ href: "/invoices/abc", label: "F-1", description: "Cliente SL", type: "Facturas", score: 1 }] }), { headers: { "content-type": "application/json" } }));
    const result = await callTool("search", { query: "F-1" }, context("read"));
    expect(result.structuredContent).toEqual({ results: [{ id: "/api/invoices/abc", title: "Facturas: F-1", text: "Cliente SL", url: "https://erp.example.com/invoices/abc" }] });
    fetchMock.mockRestore();
  });
});

describe("protocolo MCP", () => {
  it("initialize negocia la versión y anuncia herramientas", async () => {
    const response = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, context());
    expect(response?.result).toMatchObject({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "norpie" } });
    const unknownVersion = await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }, context());
    expect((unknownVersion?.result as { protocolVersion: string }).protocolVersion).toBe("2025-06-18");
  });

  it("notificaciones sin respuesta, métodos desconocidos con error y tools/list", async () => {
    expect(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, context())).toBeNull();
    expect((await handleMcpMessage({ jsonrpc: "2.0", id: 3, method: "sampling/createMessage" }, context()))?.error?.code).toBe(-32601);
    const list = await handleMcpMessage({ jsonrpc: "2.0", id: 4, method: "tools/list" }, context("read"));
    expect((list?.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)).toContain("search");
    expect((await handleMcpMessage({ foo: 1 }, context()))?.error?.code).toBe(-32600);
  });
});
