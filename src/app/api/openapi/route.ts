import { buildOpenApi } from "@/server/mcp/catalog";
import { publicOrigin } from "@/server/oauth/core";
import { corsJson, corsPreflight } from "@/server/oauth/http";

/** Especificación OpenAPI 3.1 de toda la API (pública: describe rutas, no datos). */
export function GET(request: Request) {
  return corsJson(buildOpenApi(publicOrigin(request)));
}

export function OPTIONS() {
  return corsPreflight();
}
