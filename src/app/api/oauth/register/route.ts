import { OAuthError, registerClient } from "@/server/oauth/core";
import { corsJson, corsPreflight } from "@/server/oauth/http";
import { httpErrorResponse } from "@/lib/http";

/** RFC 7591: registro dinámico de clientes (Claude, ChatGPT…). Clientes públicos con PKCE. */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return corsJson({ error: "invalid_client_metadata", error_description: "Cuerpo JSON requerido." }, { status: 400 });
    try {
      const { clientId, client } = registerClient(body);
      return corsJson({
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: client.name,
        redirect_uris: client.redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: "erp:read erp:write",
      }, { status: 201 });
    } catch (error) {
      if (error instanceof OAuthError) return corsJson({ error: error.error, error_description: error.message }, { status: error.status });
      throw error;
    }
  } catch (error) {
    return httpErrorResponse(error);
  }
}

export function OPTIONS() {
  return corsPreflight();
}
