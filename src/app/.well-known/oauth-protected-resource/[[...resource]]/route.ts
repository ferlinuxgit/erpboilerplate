import { corsJson, corsPreflight, protectedResourceMetadata } from "@/server/oauth/http";

/** RFC 9728: metadatos del recurso protegido (el servidor MCP en /api/mcp). */
export function GET(request: Request) {
  return corsJson(protectedResourceMetadata(request));
}

export function OPTIONS() {
  return corsPreflight();
}
