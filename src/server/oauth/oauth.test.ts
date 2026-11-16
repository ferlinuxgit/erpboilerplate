import { describe, expect, it, vi } from "vitest";

// Base de datos simulada: membership siempre válida, inserciones de sesión registradas.
const state = vi.hoisted(() => ({ inserted: [] as Array<Record<string, unknown>>, sessions: [] as Array<{ id: string }> }));
vi.mock("@/lib/db", () => {
  const chain = (rows: unknown[]) => {
    const query: Record<string, unknown> = {};
    for (const method of ["from", "innerJoin", "leftJoin", "where", "orderBy"]) query[method] = () => query;
    query.limit = async () => rows;
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve);
    return query;
  };
  return {
    db: {
      select: () => chain([{ id: "membership-1" }]),
      insert: () => ({ values: async (values: Record<string, unknown>) => { state.inserted.push(values); } }),
      delete: () => ({ where: () => ({ returning: async () => state.sessions }) }),
    },
  };
});

import { verifyAuthToken } from "@/lib/auth";
import {
  exchangeAuthorizationCode,
  isAllowedRedirectUri,
  issueAuthorizationCode,
  OAuthError,
  pkceChallenge,
  readClient,
  registerClient,
  validateAuthorizationRequest,
} from "@/server/oauth/core";

const verifier = "a".repeat(64);
const user = { id: "user-1", name: "Ana", email: "ana@example.com" };

function authorizeParams(clientId: string, overrides: Record<string, string> = {}) {
  return new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: "S256",
    state: "xyz",
    scope: "erp:read erp:write",
    ...overrides,
  });
}

describe("OAuth 2.1", () => {
  it("registra clientes sin guardar nada y valida sus URLs de retorno", () => {
    const { clientId } = registerClient({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] });
    expect(readClient(clientId)).toEqual({ name: "Claude", redirectUris: ["https://claude.ai/api/mcp/auth_callback"] });
    expect(readClient(`${clientId}x`)).toBeNull();
    expect(() => registerClient({ redirect_uris: ["http://evil.example.com/cb"] })).toThrow(OAuthError);
    expect(isAllowedRedirectUri("http://localhost:33418/callback")).toBe(true);
    expect(isAllowedRedirectUri("https://chatgpt.com/connector_platform_oauth_redirect")).toBe(true);
    expect(isAllowedRedirectUri("javascript:alert(1)")).toBe(false);
  });

  it("exige PKCE S256 y la URL de retorno registrada", () => {
    const { clientId } = registerClient({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] });
    expect(validateAuthorizationRequest(authorizeParams(clientId)).request.scope).toBe("write");
    expect(() => validateAuthorizationRequest(authorizeParams(clientId, { redirect_uri: "https://attacker.example/cb" }))).toThrow(/URL de retorno/);
    expect(() => validateAuthorizationRequest(authorizeParams(clientId, { code_challenge_method: "plain" }))).toThrow(/PKCE/);
  });

  it("canjea el código una sola vez y emite una sesión fijada a la empresa y al nivel de acceso", async () => {
    const { clientId } = registerClient({ client_name: "ChatGPT", redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"] });
    const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";
    const code = await issueAuthorizationCode({ clientId, redirectUri, codeChallenge: pkceChallenge(verifier), scope: "read", user, tenantId: "tenant-1", companyId: "company-1" });

    await expect(exchangeAuthorizationCode({ code, redirectUri, clientId, codeVerifier: "b".repeat(64) })).rejects.toThrow(/PKCE/);
    const tokens = await exchangeAuthorizationCode({ code, redirectUri, clientId, codeVerifier: verifier });
    expect(tokens).toMatchObject({ token_type: "Bearer", scope: "erp:read" });
    const session = verifyAuthToken(tokens.access_token);
    expect(session?.user.id).toBe("user-1");
    expect(session?.grant).toMatchObject({ tenantId: "tenant-1", companyId: "company-1", scope: "read", clientName: "ChatGPT" });
    expect(String(state.inserted.at(-1)?.userAgent)).toMatch(/^oauth:[0-9a-f-]{36}:read:company-1:ChatGPT$/);
    // Un solo uso.
    await expect(exchangeAuthorizationCode({ code, redirectUri, clientId, codeVerifier: verifier })).rejects.toThrow(/ya se ha usado/);
  });

  it("un código no sirve a otra aplicación", async () => {
    const first = registerClient({ client_name: "A", redirect_uris: ["https://a.example/cb"] });
    const second = registerClient({ client_name: "B", redirect_uris: ["https://a.example/cb"] });
    const code = await issueAuthorizationCode({ clientId: first.clientId, redirectUri: "https://a.example/cb", codeChallenge: pkceChallenge(verifier), scope: "write", user, tenantId: "t", companyId: "c" });
    await expect(exchangeAuthorizationCode({ code, redirectUri: "https://a.example/cb", clientId: second.clientId, codeVerifier: verifier })).rejects.toThrow(/no pertenece/);
  });
});
