import { logger } from "@/lib/logger";
import { exchangeAuthorizationCode, OAuthError, refreshAccessToken } from "@/server/oauth/core";
import { corsJson, corsPreflight, readOAuthParams } from "@/server/oauth/http";

/** Endpoint de token: authorization_code (con PKCE) y refresh_token (con rotación). */
export async function POST(request: Request) {
  const params = await readOAuthParams(request);
  try {
    const grantType = params.get("grant_type");
    if (grantType === "authorization_code") {
      return corsJson(await exchangeAuthorizationCode({
        code: params.get("code"),
        redirectUri: params.get("redirect_uri"),
        clientId: params.get("client_id"),
        codeVerifier: params.get("code_verifier"),
      }));
    }
    if (grantType === "refresh_token") {
      return corsJson(await refreshAccessToken({ refreshToken: params.get("refresh_token"), clientId: params.get("client_id") }));
    }
    return corsJson({ error: "unsupported_grant_type", error_description: "Usa authorization_code o refresh_token." }, { status: 400 });
  } catch (error) {
    if (error instanceof OAuthError) return corsJson({ error: error.error, error_description: error.message }, { status: error.status });
    logger.error({ err: error }, "oauth.token");
    return corsJson({ error: "server_error", error_description: "No se pudo emitir el token." }, { status: 500 });
  }
}

export function OPTIONS() {
  return corsPreflight();
}
