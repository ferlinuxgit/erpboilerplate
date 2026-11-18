/**
 * Catálogo de toda la API del ERP (generado por `npm run api:catalog` desde src/app/api): lo
 * usan el servidor MCP (descubrir y ejecutar cualquier acción) y /api/openapi.
 */
import catalogData from "@/server/mcp/api-catalog.generated.json";

export type ApiAction = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  area: string;
  summary: string;
  permissions: string[];
  query?: string[];
  body?: string;
  multipart?: boolean;
};

export const apiCatalog = catalogData as ApiAction[];

/** Nº de herramientas MCP (para pantallas que no deben cargar el módulo de herramientas; un test lo vigila). */
export const MCP_TOOL_COUNT = 21;

/**
 * Rutas que una IA no debe usar: sesión e identidad (login, contraseñas, OAuth, el propio MCP),
 * credenciales (API keys) y webhooks/formularios públicos sin sesión.
 */
const BLOCKED_PREFIXES = ["/api/auth", "/api/oauth", "/api/mcp", "/api/api-keys", "/api/public", "/api/billing", "/api/platform", "/api/recurring/run", "/api/advisor/login", "/api/health", "/api/readyz", "/api/openapi"];

export function isBlockedPath(path: string) {
  return BLOCKED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Acciones utilizables por integraciones (sin las bloqueadas). */
export function integrationActions() {
  return apiCatalog.filter((action) => !isBlockedPath(action.path));
}

function pathPattern(path: string) {
  const source = path
    .split("/")
    .map((segment) => (/^\{\w+\*\}$/.test(segment) ? ".+" : /^\{\w+\}$/.test(segment) ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${source}$`);
}

const patterns = new Map<string, RegExp>();

/** Acción del catálogo para una ruta concreta (`/api/invoices/abc` → `/api/invoices/{id}`). */
export function findAction(method: string, concretePath: string): ApiAction | null {
  const upper = method.toUpperCase();
  const candidates = apiCatalog.filter((action) => action.method === upper);
  const exact = candidates.find((action) => action.path === concretePath);
  if (exact) return exact;
  // Rutas con parámetros: la más específica (menos segmentos variables) gana.
  const matches = candidates.filter((action) => {
    if (!patterns.has(action.path)) patterns.set(action.path, pathPattern(action.path));
    return patterns.get(action.path)!.test(concretePath);
  });
  return matches.sort((left, right) => (left.path.match(/\{/g)?.length ?? 0) - (right.path.match(/\{/g)?.length ?? 0))[0] ?? null;
}

function normalize(text: string) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Busca acciones por texto (ruta, descripción, permiso), área o método. */
export function searchActions(options: { text?: string; area?: string; method?: string; limit?: number }) {
  const words = normalize(options.text ?? "").split(/\s+/).filter(Boolean);
  const method = options.method?.toUpperCase();
  const scored = integrationActions()
    .filter((action) => (!options.area || action.area === options.area) && (!method || action.method === method))
    .map((action) => {
      const haystack = normalize(`${action.method} ${action.path} ${action.summary} ${action.permissions.join(" ")}`);
      const score = words.reduce((total, word) => total + (haystack.includes(word) ? (action.path.includes(word) ? 3 : 1) : 0), 0);
      return { action, score };
    })
    .filter((entry) => words.length === 0 || entry.score > 0)
    .sort((left, right) => right.score - left.score || left.action.path.localeCompare(right.action.path));
  return { total: scored.length, actions: scored.slice(0, options.limit ?? 60).map((entry) => entry.action) };
}

export function catalogAreas() {
  const counts = new Map<string, number>();
  for (const action of integrationActions()) counts.set(action.area, (counts.get(action.area) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => left[0].localeCompare(right[0])).map(([area, count]) => ({ area, count }));
}

/** Especificación OpenAPI 3.1 de la API (para GPTs, Postman, generadores de clientes…). */
export function buildOpenApi(origin: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const action of integrationActions()) {
    const openApiPath = action.path.replace(/\{(\w+)\*\}/g, "{$1}");
    const parameters = [
      ...[...openApiPath.matchAll(/\{(\w+)\}/g)].map((match) => ({ name: match[1], in: "path", required: true, schema: { type: "string" } })),
      ...(action.query ?? []).map((name) => ({ name, in: "query", required: false, schema: { type: "string" } })),
    ];
    const description = [
      action.summary,
      action.permissions.length ? `Permiso: ${action.permissions.join(", ")}.` : "",
      action.body ? `Cuerpo (validación zod):\n\n\`\`\`ts\n${action.body}\n\`\`\`` : "",
    ].filter(Boolean).join("\n\n");
    paths[openApiPath] ??= {};
    paths[openApiPath][action.method.toLowerCase()] = {
      operationId: `${action.method.toLowerCase()}_${openApiPath.replace(/^\/api\//, "").replace(/[{}]/g, "").replace(/[^a-zA-Z0-9]+/g, "_")}`,
      summary: (action.summary || `${action.method} ${openApiPath}`).slice(0, 120),
      description,
      tags: [action.area],
      ...(parameters.length ? { parameters } : {}),
      ...(action.method !== "GET" && action.method !== "DELETE"
        ? { requestBody: { required: Boolean(action.body), content: { [action.multipart ? "multipart/form-data" : "application/json"]: { schema: { type: "object" } } } } }
        : {}),
      responses: { "200": { description: "OK" }, "400": { description: "Datos no válidos" }, "401": { description: "Sin autenticar" }, "403": { description: "Sin permiso" }, "404": { description: "No encontrado" } },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "ERP API",
      version: "1.0.0",
      description: "Toda la API del ERP. Autenticación: OAuth 2.1 (conectores de IA), token personal o API key con `Authorization: Bearer`. Las acciones respetan los permisos del rol del usuario y la empresa autorizada.",
    },
    servers: [{ url: origin }],
    components: {
      securitySchemes: {
        oauth: {
          type: "oauth2",
          flows: { authorizationCode: { authorizationUrl: `${origin}/oauth/authorize`, tokenUrl: `${origin}/api/oauth/token`, refreshUrl: `${origin}/api/oauth/token`, scopes: { "erp:read": "Consultar", "erp:write": "Consultar y gestionar" } } },
        },
        bearer: { type: "http", scheme: "bearer" },
      },
    },
    security: [{ oauth: ["erp:read"] }, { bearer: [] }],
    paths,
  };
}
