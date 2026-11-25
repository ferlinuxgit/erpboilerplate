import { NextResponse } from "next/server";

import { OAUTH_SCOPES, publicOrigin } from "@/server/oauth/core";

/** CORS abierto: los endpoints OAuth/MCP los llaman clientes de cualquier origen (inspectores MCP en el navegador incluidos). */
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

export function corsJson(body: unknown, init: ResponseInit = {}) {
  return NextResponse.json(body, { ...init, headers: { ...corsHeaders, "Cache-Control": "no-store", ...(init.headers ?? {}) } });
}

export function corsPreflight() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

/** Metadatos del servidor de autorización (RFC 8414). */
export function authorizationServerMetadata(request: Request) {
  const origin = publicOrigin(request);
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...OAUTH_SCOPES],
    service_documentation: `${origin}/settings/ai`,
  };
}

/** Metadatos del recurso protegido (RFC 9728): el servidor MCP. */
export function protectedResourceMetadata(request: Request) {
  const origin = publicOrigin(request);
  return {
    resource: `${origin}/api/mcp`,
    resource_name: "Norpie",
    authorization_servers: [origin],
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ["header"],
    resource_documentation: `${origin}/settings/ai`,
  };
}

/** 401 con el puntero a los metadatos para que el cliente inicie OAuth solo. */
export function unauthorizedForMcp(request: Request, message = "Conecta tu cuenta del ERP para continuar.") {
  const origin = publicOrigin(request);
  return corsJson(
    { jsonrpc: "2.0", error: { code: -32001, message }, id: null },
    { status: 401, headers: { "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp", scope="erp:read erp:write"` } },
  );
}

/** Lee el cuerpo de /token y /revoke: application/x-www-form-urlencoded (estándar) o JSON. */
export async function readOAuthParams(request: Request): Promise<URLSearchParams> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return new URLSearchParams(Object.entries(body).filter(([, value]) => typeof value === "string") as Array<[string, string]>);
  }
  return new URLSearchParams(await request.text());
}
