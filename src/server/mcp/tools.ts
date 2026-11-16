/**
 * Herramientas MCP del ERP.
 *
 * - `search` / `fetch`: el contrato que ChatGPT (conectores y deep research) espera.
 * - Herramientas de uso diario con esquema propio (facturas, clientes, panel, impuestos…).
 * - `erp_catalogo` + `erp_describir_accion` + `erp_ejecutar_accion`: cualquier acción de la app
 *   (las ~400 del catálogo), con la misma validación, permisos y auditoría que la interfaz.
 *
 * Todas se ejecutan llamando a la propia API con el token del usuario: no hay atajos que salten
 * permisos, módulos desactivados, cierres de periodo ni la política de seguridad.
 */
import { z } from "zod";

import { customerFormSchema } from "@/server/customers/schemas";
import { createInvoiceSchema } from "@/server/invoices/schemas";
import { createSupplierSchema } from "@/server/schemas/forms";
import { catalogAreas, findAction, isBlockedPath, searchActions } from "@/server/mcp/catalog";

export type McpCallContext = {
  /** Cabecera Authorization original (Bearer del usuario). */
  authorization: string;
  /** IP del cliente original (rate limit y política de IPs). */
  clientIp: string | null;
  /** Origen interno para llamar a la API. */
  internalOrigin: string;
  /** Origen público (para enlaces a la aplicación). */
  publicOrigin: string;
  /** Nivel de la conexión: las herramientas de escritura no se ofrecen en solo lectura. */
  scope: "read" | "write";
};

type JsonSchema = Record<string, unknown>;

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  readOnly: boolean;
  destructive?: boolean;
  handler: (args: Record<string, unknown>, context: McpCallContext) => Promise<ToolResult>;
};

const MAX_TEXT = 60_000;

function toJsonSchema(schema: z.ZodType): JsonSchema {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as JsonSchema;
  delete json.$schema;
  return json;
}

function objectSchema(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

const str = (description: string): JsonSchema => ({ type: "string", description });
const int = (description: string): JsonSchema => ({ type: "integer", description });
const periodSchema: JsonSchema = { type: "string", enum: ["month", "quarter", "year"], description: "Periodo: month (mes en curso, por defecto), quarter o year." };

function textResult(data: unknown, isError = false): ToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return {
    content: [{ type: "text", text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n… (respuesta recortada: usa filtros o paginación)` : text }],
    ...(data && typeof data === "object" && !Array.isArray(data) ? { structuredContent: data as Record<string, unknown> } : data !== undefined && typeof data !== "string" ? { structuredContent: { items: data } } : {}),
    ...(isError ? { isError: true } : {}),
  };
}

export type ApiCallResult = { status: number; ok: boolean; data: unknown };

/** Llama a la API del ERP como el usuario (mismo token): permisos, módulos y auditoría intactos. */
export async function callApi(context: McpCallContext, method: string, path: string, options: { query?: Record<string, unknown>; body?: unknown } = {}): Promise<ApiCallResult> {
  const url = new URL(path, context.internalOrigin);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  const headers: Record<string, string> = { authorization: context.authorization, accept: "application/json", "user-agent": "erp-mcp" };
  if (context.clientIp) headers["x-forwarded-for"] = context.clientIp;
  const hasBody = options.body !== undefined && method !== "GET" && method !== "DELETE";
  if (hasBody) headers["content-type"] = "application/json";
  const response = await fetch(url, { method, headers, body: hasBody ? JSON.stringify(options.body) : undefined, redirect: "manual" });
  const type = response.headers.get("content-type") ?? "";
  let data: unknown;
  if (type.includes("application/json")) {
    data = await response.json().catch(() => null);
  } else if (type.startsWith("text/")) {
    data = await response.text();
  } else {
    const bytes = (await response.arrayBuffer()).byteLength;
    data = { binary: true, contentType: type || "application/octet-stream", bytes, url: `${context.publicOrigin}${url.pathname}${url.search}`, note: "Archivo binario (PDF, Excel…): ábrelo desde la aplicación con la URL indicada." };
  }
  return { status: response.status, ok: response.ok, data };
}

function apiResult(result: ApiCallResult): ToolResult {
  if (result.ok) return textResult(result.data ?? { ok: true });
  const message = result.data && typeof result.data === "object" && "message" in result.data ? String((result.data as { message: unknown }).message) : `Error ${result.status}`;
  return textResult({ status: result.status, error: message, detail: result.data }, true);
}

function stringArg(args: Record<string, unknown>, key: string) {
  const value = args[key];
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

function getTool(name: string, title: string, description: string, path: string, query: Record<string, [string, JsonSchema]> = {}): ToolDefinition {
  return {
    name,
    title,
    description,
    readOnly: true,
    inputSchema: objectSchema(Object.fromEntries(Object.entries(query).map(([key, [, schema]]) => [key, schema]))),
    handler: async (args, context) => {
      const mapped = Object.fromEntries(Object.entries(query).map(([key, [apiName]]) => [apiName, args[key]]));
      return apiResult(await callApi(context, "GET", path, { query: mapped }));
    },
  };
}

/** Pantalla de la app ↔ recurso de la API (resultados de `search` y enlaces de `fetch`). */
const RESOURCE_ROUTES: Array<[app: string, api: string]> = [
  ["/invoices/", "/api/invoices/"],
  ["/customers/", "/api/customers/"],
  ["/suppliers/", "/api/suppliers/"],
  ["/expenses/", "/api/expenses/"],
  ["/inventory/items/", "/api/items/"],
  ["/sales/quotes/", "/api/sales-quotes/"],
  ["/sales/orders/", "/api/sales-orders/"],
  ["/sales/delivery-notes/", "/api/delivery-notes/"],
  ["/purchases/orders/", "/api/purchases/"],
  ["/treasury/bank-transactions/", "/api/bank-transactions/"],
  ["/accounting/entries/", "/api/journal-entries/"],
  ["/crm/opportunities/", "/api/crm/opportunities/"],
];

function swapPrefix(path: string, from: 0 | 1) {
  for (const route of RESOURCE_ROUTES) {
    const prefix = route[from];
    const rest = path.slice(prefix.length);
    if (path.startsWith(prefix) && rest && !rest.includes("/")) return `${route[from === 0 ? 1 : 0]}${rest}`;
  }
  return null;
}

export function appPathToApiPath(href: string) {
  return swapPrefix(href, 0);
}

export function apiPathToAppPath(path: string) {
  return swapPrefix(path, 1);
}

const searchTool: ToolDefinition = {
  name: "search",
  title: "Buscar en el ERP",
  description: "Busca facturas, clientes, proveedores, gastos, artículos, presupuestos, pedidos, albaranes, compras, movimientos bancarios y asientos por texto (número, nombre, NIF, importe…). Devuelve resultados con `id` para usar en `fetch`.",
  readOnly: true,
  inputSchema: objectSchema({ query: str("Texto a buscar (mínimo 2 caracteres).") }, ["query"]),
  handler: async (args, context) => {
    const result = await callApi(context, "GET", "/api/search", { query: { q: stringArg(args, "query") } });
    if (!result.ok) return apiResult(result);
    const rows = ((result.data as { results?: Array<{ href: string; label: string; description: string; type: string }> })?.results ?? []);
    const results = rows.map((row) => ({
      id: appPathToApiPath(row.href) ?? row.href,
      title: `${row.type}: ${row.label}`,
      text: row.description,
      url: `${context.publicOrigin}${row.href}`,
    }));
    return textResult({ results });
  },
};

const fetchTool: ToolDefinition = {
  name: "fetch",
  title: "Ver un registro",
  description: "Devuelve el detalle completo de un resultado de `search` (su `id` es la ruta de la API, p. ej. /api/invoices/…), o de cualquier ruta GET de la API.",
  readOnly: true,
  inputSchema: objectSchema({ id: str("`id` devuelto por search (ruta /api/…).") }, ["id"]),
  handler: async (args, context) => {
    const id = stringArg(args, "id");
    const path = id.startsWith("/api/") ? id : appPathToApiPath(id);
    if (!path || isBlockedPath(path) || !findAction("GET", path.split("?")[0])) return textResult(`No se puede abrir "${id}": no es un recurso de la API.`, true);
    const result = await callApi(context, "GET", path);
    if (!result.ok) return apiResult(result);
    const data = result.data as Record<string, unknown> | null;
    const title = String(data?.number ?? data?.name ?? data?.title ?? data?.description ?? path);
    const appPath = apiPathToAppPath(path);
    return textResult({
      id: path,
      title,
      text: JSON.stringify(result.data, null, 2).slice(0, MAX_TEXT),
      url: `${context.publicOrigin}${appPath ?? path}`,
      metadata: { source: "erp" },
    });
  },
};

const contextTool: ToolDefinition = {
  name: "erp_contexto",
  title: "Empresa, usuario y permisos",
  description: "Empresa y ejercicio de esta conexión, usuario, rol, módulos activos, país/territorio fiscal y nivel de acceso (solo lectura o gestión). Úsala primero si no sabes qué puede hacer el usuario.",
  readOnly: true,
  inputSchema: objectSchema({}),
  handler: async (_args, context) => {
    const result = await callApi(context, "GET", "/api/context/active");
    if (!result.ok) return apiResult(result);
    return textResult({ ...(result.data as Record<string, unknown>), accessLevel: context.scope === "write" ? "consultar y gestionar" : "solo consultar", areas: catalogAreas() });
  },
};

const catalogTool: ToolDefinition = {
  name: "erp_catalogo",
  title: "Catálogo de acciones",
  description: "Lista las acciones de la API del ERP (≈400: ventas, compras, gastos, tesorería, contabilidad, fiscalidad, inventario, TPV, CRM, configuración…) filtrando por texto, área o método. Después usa erp_describir_accion para ver los datos que pide y erp_ejecutar_accion para hacerla.",
  readOnly: true,
  inputSchema: objectSchema({
    buscar: str("Palabras clave (p. ej. 'factura rectificativa', 'remesa sepa', 'conciliar')."),
    area: str("Área (primer segmento de la ruta: invoices, expenses, treasury, accounting, pos…)."),
    metodo: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], description: "Filtrar por método HTTP." },
  }),
  handler: async (args) => {
    const { total, actions } = searchActions({ text: stringArg(args, "buscar"), area: stringArg(args, "area") || undefined, method: stringArg(args, "metodo") || undefined });
    return textResult({
      total,
      shown: actions.length,
      actions: actions.map((action) => ({ method: action.method, path: action.path, summary: action.summary.slice(0, 200), permission: action.permissions[0] ?? null, hasBody: Boolean(action.body) })),
    });
  },
};

const describeTool: ToolDefinition = {
  name: "erp_describir_accion",
  title: "Detalle de una acción",
  description: "Descripción completa de una acción de la API: parámetros de ruta y de consulta, permiso y el esquema (zod) del cuerpo que espera.",
  readOnly: true,
  inputSchema: objectSchema({
    metodo: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
    ruta: str("Ruta del catálogo (/api/invoices/{id}) o concreta (/api/invoices/123)."),
  }, ["metodo", "ruta"]),
  handler: async (args) => {
    const action = findAction(stringArg(args, "metodo"), stringArg(args, "ruta"));
    if (!action || isBlockedPath(action.path)) return textResult("Acción no encontrada en el catálogo. Búscala con erp_catalogo.", true);
    return textResult(action);
  },
};

const executeTool: ToolDefinition = {
  name: "erp_ejecutar_accion",
  title: "Ejecutar cualquier acción",
  description: "Ejecuta cualquier acción de la API del ERP como el usuario (con sus permisos). Rellena los parámetros de la ruta ({id}) en `ruta`; los de consulta en `consulta` y el cuerpo JSON en `cuerpo` según erp_describir_accion. Para crear, modificar o borrar datos confirma antes con el usuario.",
  readOnly: false,
  destructive: true,
  inputSchema: objectSchema({
    metodo: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
    ruta: str("Ruta concreta, p. ej. /api/invoices/123/issue."),
    consulta: { type: "object", description: "Parámetros de consulta (?clave=valor).", additionalProperties: true },
    cuerpo: { type: "object", description: "Cuerpo JSON de la petición.", additionalProperties: true },
  }, ["metodo", "ruta"]),
  handler: async (args, context) => {
    const method = stringArg(args, "metodo").toUpperCase();
    const path = stringArg(args, "ruta").split("?")[0];
    if (!path.startsWith("/api/") || isBlockedPath(path)) return textResult("Esa ruta no está disponible para integraciones (sesión, credenciales u OAuth).", true);
    const action = findAction(method, path);
    if (!action) return textResult(`No existe ${method} ${path}. Búscala con erp_catalogo.`, true);
    if (method !== "GET" && context.scope === "read") return textResult("Esta conexión es de solo lectura. Para crear o modificar datos, vuelve a conectar con «Consultar y gestionar».", true);
    if (action.multipart) return textResult("Esta acción recibe archivos (multipart): hazla desde la aplicación.", true);
    const query = args.consulta && typeof args.consulta === "object" ? (args.consulta as Record<string, unknown>) : undefined;
    return apiResult(await callApi(context, method, path, { query, body: args.cuerpo }));
  },
};

function writeTool(name: string, title: string, description: string, path: string, schema: z.ZodType): ToolDefinition {
  return {
    name,
    title,
    description,
    readOnly: false,
    inputSchema: toJsonSchema(schema),
    handler: async (args, context) => apiResult(await callApi(context, "POST", path, { body: args })),
  };
}

const issueInvoiceTool: ToolDefinition = {
  name: "erp_emitir_factura",
  title: "Emitir factura",
  description: "Emite un borrador de factura: número definitivo, asiento contable y registro VERI*FACTU si aplica. Es irreversible (después solo se corrige con rectificativa): confirma con el usuario.",
  readOnly: false,
  destructive: true,
  inputSchema: objectSchema({ id: str("Id de la factura en borrador.") }, ["id"]),
  handler: async (args, context) => apiResult(await callApi(context, "POST", `/api/invoices/${encodeURIComponent(stringArg(args, "id"))}/issue`, { body: {} })),
};

const TOOLS: ToolDefinition[] = [
  searchTool,
  fetchTool,
  contextTool,
  getTool("erp_panel", "Panel financiero", "Situación del negocio: ventas y gastos del periodo frente al anterior, impuesto estimado del trimestre, pendiente de cobro y de pago, saldos bancarios, evolución mensual y próximos plazos fiscales.", "/api/reporting/dashboard", { periodo: ["period", periodSchema] }),
  getTool("erp_indicadores", "Indicadores", "Indicadores del periodo (ventas, gastos, márgenes, cobros) comparados con el periodo anterior.", "/api/reporting/kpis", { periodo: ["period", periodSchema] }),
  getTool("erp_obligaciones_fiscales", "Qué hay que presentar", "Modelos fiscales que la empresa debe presentar ahora (303, 111, 130, 420…), plazo, estado e importe si ya está calculado.", "/api/fiscal/obligations"),
  getTool("erp_calculo_fiscal", "Cálculo de un modelo fiscal", "Calcula un modelo fiscal al vuelo con sus casillas (España: 303, 390, 347, 111, 115, 349, 130; Canarias: 420, 425, 450) o, en otros países, el resumen de impuestos del periodo.", "/api/fiscal/summary", {
    modelo: ["code", str("Código del modelo (303, 111, 130, 420…). En países sin modelos, omítelo.")],
    periodo: ["period", str("Periodo: 2026-Q1 (trimestre), 2026-04 (mes) o 2026 (anual).")],
  }),
  getTool("erp_estados_financieros", "Estados financieros", "Balance de situación, pérdidas y ganancias y sumas y saldos del ejercicio (o de un rango de fechas).", "/api/accounting/statements", {
    ejercicio: ["fiscalYearId", str("Id del ejercicio (por defecto, el activo).")],
    desde: ["from", str("Fecha inicial AAAA-MM-DD (opcional).")],
    hasta: ["to", str("Fecha final AAAA-MM-DD (opcional).")],
  }),
  getTool("erp_listar_facturas", "Facturas emitidas", "Facturas emitidas, con búsqueda y paginación (número, cliente, estado de cobro, importes).", "/api/invoices", {
    buscar: ["q", str("Texto: número, cliente, NIF…")],
    pendientes: ["pending", { type: "string", enum: ["1"], description: "\"1\" para solo las pendientes de cobro." }],
    pagina: ["page", int("Página (desde 1).")],
    por_pagina: ["pageSize", int("Resultados por página.")],
  }),
  getTool("erp_listar_gastos", "Gastos y facturas recibidas", "Facturas de proveedor y gastos, con búsqueda y paginación.", "/api/expenses", {
    buscar: ["q", str("Texto: proveedor, número, concepto…")],
    pagina: ["page", int("Página (desde 1).")],
    por_pagina: ["pageSize", int("Resultados por página.")],
  }),
  getTool("erp_listar_clientes", "Clientes", "Clientes de la empresa con sus datos fiscales y condiciones.", "/api/customers"),
  getTool("erp_listar_proveedores", "Proveedores", "Proveedores de la empresa con sus datos fiscales.", "/api/suppliers"),
  getTool("erp_listar_articulos", "Artículos", "Productos y servicios del catálogo, con precio, impuestos y stock.", "/api/items"),
  getTool("erp_movimientos_bancarios", "Movimientos bancarios", "Movimientos de las cuentas bancarias y su estado de conciliación.", "/api/bank-transactions"),
  writeTool("erp_crear_cliente", "Crear cliente", "Da de alta un cliente (nombre, NIF, dirección, país, condiciones de facturación). Confirma los datos con el usuario.", "/api/customers", customerFormSchema),
  writeTool("erp_crear_proveedor", "Crear proveedor", "Da de alta un proveedor. Confirma los datos con el usuario.", "/api/suppliers", createSupplierSchema),
  writeTool("erp_crear_factura", "Crear factura", "Crea una factura con sus líneas. Usa mode \"draft\" para dejarla en borrador (recomendado: revisarla y después erp_emitir_factura); sin mode se emite directamente. Los impuestos y el tratamiento de IVA se proponen solos según el cliente. Confirma con el usuario antes de emitir.", "/api/invoices", createInvoiceSchema),
  issueInvoiceTool,
  catalogTool,
  describeTool,
  executeTool,
];

export function listTools(scope: "read" | "write") {
  return TOOLS.filter((tool) => scope === "write" || tool.readOnly).map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: { title: tool.title, readOnlyHint: tool.readOnly, destructiveHint: Boolean(tool.destructive), idempotentHint: tool.readOnly, openWorldHint: false },
  }));
}

export async function callTool(name: string, args: Record<string, unknown>, context: McpCallContext): Promise<ToolResult> {
  const tool = TOOLS.find((entry) => entry.name === name);
  if (!tool) return textResult(`Herramienta desconocida: ${name}.`, true);
  if (!tool.readOnly && context.scope === "read") return textResult("Esta conexión es de solo lectura. Para crear o modificar datos, vuelve a conectar con «Consultar y gestionar».", true);
  try {
    return await tool.handler(args ?? {}, context);
  } catch (error) {
    return textResult(`No se pudo completar ${name}: ${error instanceof Error ? error.message : "error inesperado"}.`, true);
  }
}

export const toolNames = TOOLS.map((tool) => tool.name);
