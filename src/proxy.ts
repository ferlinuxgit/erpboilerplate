/**
 * Capa de borde Next.js 16: el archivo `src/middleware.ts` quedó deprecado;
 * la convención vigente es exportar `proxy` desde `src/proxy.ts` (sigue apareciendo
 * como "Proxy (Middleware)" en el build y usa el runtime Node.js).
 * Aquí aplicamos rate limit (nunca en abierto), CSRF y cabeceras de contexto.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { hasApiKeyBearerAuthorization } from "@/lib/api-auth-header";
import { REQUEST_PATH_HEADER } from "@/lib/auth";
import { getClientIp } from "@/lib/ip-policy";
import { getRateLimiter, rateLimitKey, resolveRateLimitRule, tooManyRequestsResponse } from "@/lib/rate-limit";

/** Endpoints previos a la autenticación: no hay sesión que proteger con CSRF. */
const CSRF_EXEMPT_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/verify-email",
  "/api/auth/verify-two-factor",
  "/api/billing/webhook",
]);

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

    const hasApiKeyAuthorization = hasApiKeyBearerAuthorization(request.headers.get("authorization"));
    const safeMethod = request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS";
    if (!safeMethod && !CSRF_EXEMPT_PATHS.has(pathname) && !hasApiKeyAuthorization) {
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
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
