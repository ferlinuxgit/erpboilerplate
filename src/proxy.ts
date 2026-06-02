/**
 * Capa de borde Next.js 16: el archivo `src/middleware.ts` quedó deprecado;
 * la convención vigente es exportar `proxy` desde `src/proxy.ts` (sigue apareciendo
 * como "Proxy (Middleware)" en el build). Aquí aplicamos rate limit y CSRF opcional.
 */
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { hasApiKeyBearerAuthorization } from "@/lib/api-auth-header";

const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null;

const ratelimit = redis ? new Ratelimit({ redis, limiter: Ratelimit.fixedWindow(100, "1 m") }) : null;

export async function proxy(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    const csrfExcludedPath =
      request.nextUrl.pathname.startsWith("/api/auth/") || request.nextUrl.pathname === "/api/billing/webhook";
    const hasApiKeyAuthorization = hasApiKeyBearerAuthorization(request.headers.get("authorization"));

    if (request.method !== "GET" && !csrfExcludedPath && !hasApiKeyAuthorization) {
      const csrfToken = request.headers.get("x-csrf-token");
      const csrfCookie = request.cookies.get("csrf-token")?.value;
      if (!csrfToken || !csrfCookie || csrfToken !== csrfCookie) {
        const response = NextResponse.json({ message: "Token CSRF invalido." }, { status: 403 });
        response.headers.set("x-request-id", requestId);
        return response;
      }
    }

    if (ratelimit) {
      const ip = request.headers.get("x-forwarded-for") ?? "anonymous";
      const userAgent = request.headers.get("user-agent") ?? "unknown";
      const authCookie = request.cookies.get("better-auth.session_token")?.value ?? "anon";
      const key = `api:${ip}:${userAgent}:${authCookie}`;
      const { success } = await ratelimit.limit(`api:${key}`);
      if (!success) {
        const response = NextResponse.json({ message: "Demasiadas peticiones." }, { status: 429 });
        response.headers.set("x-request-id", requestId);
        return response;
      }
    }
  }

  const response = NextResponse.next();
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
