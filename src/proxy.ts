/**
 * Capa de borde Next.js 16: el archivo `src/middleware.ts` quedó deprecado;
 * la convención vigente es exportar `proxy` desde `src/proxy.ts` (sigue apareciendo
 * como "Proxy (Middleware)" en el build y usa el runtime Node.js).
 * Aquí aplicamos rate limit (nunca en abierto), CSRF y cabeceras de contexto.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { bearerToken, hasApiKeyBearerAuthorization } from "@/lib/api-auth-header";
import { REQUEST_PATH_HEADER, verifyAuthToken } from "@/lib/auth";
import { getClientIp } from "@/lib/ip-policy";
import { getRateLimiter, rateLimitKey, resolveRateLimitRule, tooManyRequestsResponse } from "@/lib/rate-limit";
import { shouldUseSecureCookies } from "@/lib/secure-cookies";

/** Endpoints previos a la autenticación: no hay sesión que proteger con CSRF. */
const CSRF_EXEMPT_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/verify-email",
  "/api/auth/verify-two-factor",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/resend-verification",
  // Acceso al portal del asesor (antes de tener sesión).
  "/api/advisor/login",
  "/api/billing/webhook",
  // Server-to-server cron trigger: authenticated by the CRON_SECRET header, never by cookies.
  "/api/recurring/run",
]);

/** OAuth sin sesión del navegador: los llaman los servidores de Claude / ChatGPT. */
const OAUTH_PUBLIC_PATHS = new Set(["/api/oauth/register", "/api/oauth/token", "/api/oauth/revoke", "/api/mcp"]);

function withRequestId(response: NextResponse, requestId: string) {
  response.headers.set("x-request-id", requestId);
  return response;
}

export async function proxy(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    const rule = resolveRateLimitRule(pathname, request.method);
    if (rule) {
      const limitResult = await getRateLimiter().limit(rule, rateLimitKey(getClientIp(request.headers)));
      if (!limitResult.success) return withRequestId(tooManyRequestsResponse(limitResult), requestId);
    }

    const authorization = request.headers.get("authorization");
    const hasApiKeyAuthorization = hasApiKeyBearerAuthorization(authorization);
    const safeMethod = request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS";
    // Token Bearer (API key, conector de IA o token personal): el navegador nunca lo envía solo,
    // así que no hay CSRF posible. Un conector de solo lectura no puede modificar nada (salvo
    // hablar con el propio servidor MCP, cuyas acciones vuelven a pasar por aquí).
    const bearer = bearerToken(authorization);
    const grant = bearer && !hasApiKeyAuthorization ? verifyAuthToken(bearer)?.grant ?? null : null;
    if (grant?.scope === "read" && !safeMethod && pathname !== "/api/mcp" && !pathname.startsWith("/api/oauth/")) {
      return withRequestId(NextResponse.json({ message: "Esta conexión es de solo lectura: no puede crear, modificar ni borrar datos." }, { status: 403 }), requestId);
    }
    // /api/public/*: formularios públicos sin sesión (reservas), no hay credenciales que proteger con CSRF.
    if (!safeMethod && !CSRF_EXEMPT_PATHS.has(pathname) && !pathname.startsWith("/api/public/") && !hasApiKeyAuthorization && !grant && !OAUTH_PUBLIC_PATHS.has(pathname)) {
      const csrfToken = request.headers.get("x-csrf-token");
      const csrfCookie = request.cookies.get("csrf-token")?.value;
      if (!csrfToken || !csrfCookie || csrfToken !== csrfCookie) {
        return withRequestId(NextResponse.json({ message: "Token CSRF inválido. Recarga la página e inténtalo de nuevo." }, { status: 403 }), requestId);
      }
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_PATH_HEADER, `${pathname}${request.nextUrl.search}`);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  if (!request.cookies.get("csrf-token")) {
    response.cookies.set("csrf-token", crypto.randomUUID(), {
      httpOnly: false,
      sameSite: "lax",
      secure: shouldUseSecureCookies(),
      path: "/",
    });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
