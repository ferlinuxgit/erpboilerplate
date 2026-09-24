import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";

/**
 * Rate limiting que nunca falla en abierto.
 *
 * - Con Upstash configurado (`UPSTASH_REDIS_REST_URL`/`TOKEN`) se usa una
 *   ventana deslizante compartida entre instancias.
 * - Sin Upstash, o si Upstash falla/expira, se usa un limitador en memoria
 *   (ventana deslizante aproximada, por instancia). En producción se avisa una
 *   única vez de que el límite no es global.
 */

export type RateLimitRule = {
  /** Identificador del bucket; forma parte de la clave. */
  id: string;
  limit: number;
  windowMs: number;
};

export type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  /** Epoch (ms) a partir del cual vuelve a haber cupo. */
  resetAt: number;
  retryAfterSeconds: number;
};

export interface RateLimiter {
  limit(rule: RateLimitRule, key: string): Promise<RateLimitResult>;
  reset(rule: RateLimitRule, key: string): Promise<void>;
}

const MINUTE = 60_000;

export const RATE_LIMIT_RULES = {
  api: { id: "api", limit: 300, windowMs: MINUTE },
  login: { id: "auth-login", limit: 10, windowMs: MINUTE },
  loginEmail: { id: "auth-login-email", limit: 5, windowMs: 15 * MINUTE },
  register: { id: "auth-register", limit: 10, windowMs: MINUTE },
  verifyTwoFactor: { id: "auth-2fa", limit: 10, windowMs: MINUTE },
  verifyEmail: { id: "auth-verify-email", limit: 10, windowMs: MINUTE },
  invitationAccept: { id: "invitation-accept", limit: 10, windowMs: MINUTE },
} satisfies Record<string, RateLimitRule>;

const RATE_LIMIT_EXEMPT_PATHS = new Set(["/api/billing/webhook", "/api/health", "/api/readyz"]);

/** Bucket aplicable a una petición `/api/*`, o `null` si está exenta. */
export function resolveRateLimitRule(pathname: string, method: string): RateLimitRule | null {
  if (RATE_LIMIT_EXEMPT_PATHS.has(pathname)) return null;
  if (method === "POST") {
    if (pathname === "/api/auth/login") return RATE_LIMIT_RULES.login;
    if (pathname === "/api/auth/register") return RATE_LIMIT_RULES.register;
    if (pathname === "/api/auth/verify-two-factor") return RATE_LIMIT_RULES.verifyTwoFactor;
    if (pathname === "/api/auth/verify-email") return RATE_LIMIT_RULES.verifyEmail;
    if (/^\/api\/invitations\/[^/]+\/accept$/.test(pathname)) return RATE_LIMIT_RULES.invitationAccept;
  }
  return RATE_LIMIT_RULES.api;
}

function result(rule: RateLimitRule, success: boolean, remaining: number, resetAt: number, now: number): RateLimitResult {
  return {
    success,
    limit: rule.limit,
    remaining: Math.max(0, remaining),
    resetAt,
    retryAfterSeconds: success ? 0 : Math.max(1, Math.ceil((resetAt - now) / 1000)),
  };
}

type WindowState = { window: number; current: number; previous: number };

/**
 * Ventana deslizante aproximada (contador de ventana actual + ventana previa
 * ponderada). Memoria O(1) por clave; se purgan claves caducadas al crecer.
 */
export function createMemoryRateLimiter(options: { now?: () => number; maxKeys?: number } = {}): RateLimiter {
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? 50_000;
  const store = new Map<string, WindowState & { windowMs: number }>();

  function sweep(at: number) {
    for (const [key, state] of store) {
      if (Math.floor(at / state.windowMs) - state.window >= 2) store.delete(key);
    }
    // Si sigue lleno, descartamos las claves más antiguas (orden de inserción).
    const overflow = store.size - maxKeys + 1;
    if (overflow > 0) {
      let removed = 0;
      for (const key of store.keys()) {
        if (removed >= overflow) break;
        store.delete(key);
        removed += 1;
      }
    }
  }

  return {
    async limit(rule, key) {
      const at = now();
      const storeKey = `${rule.id}:${key}`;
      const window = Math.floor(at / rule.windowMs);
      let state = store.get(storeKey);
      if (!state || state.windowMs !== rule.windowMs) {
        if (store.size >= maxKeys) sweep(at);
        state = { window, current: 0, previous: 0, windowMs: rule.windowMs };
        store.set(storeKey, state);
      } else if (state.window !== window) {
        state.previous = state.window === window - 1 ? state.current : 0;
        state.current = 0;
        state.window = window;
      }

      const windowStart = window * rule.windowMs;
      const elapsedRatio = (at - windowStart) / rule.windowMs;
      const weightedPrevious = state.previous * (1 - elapsedRatio);
      const estimated = weightedPrevious + state.current;

      if (estimated + 1 > rule.limit) {
        // Momento en que la ventana previa ponderada deja hueco para 1 petición más.
        let resetAt: number;
        if (state.current + 1 <= rule.limit && state.previous > 0) {
          const ratioNeeded = 1 - (rule.limit - 1 - state.current) / state.previous;
          resetAt = windowStart + Math.ceil(Math.max(ratioNeeded, elapsedRatio) * rule.windowMs);
        } else {
          // La ventana actual está llena: en la siguiente pasa a ser la "previa".
          const ratioNeeded = state.current > 0 ? Math.max(0, 1 - (rule.limit - 1) / state.current) : 0;
          resetAt = windowStart + rule.windowMs + Math.ceil(ratioNeeded * rule.windowMs);
        }
        return result(rule, false, 0, Math.max(resetAt, at + 1), at);
      }

      state.current += 1;
      return result(rule, true, Math.floor(rule.limit - estimated - 1), windowStart + rule.windowMs, at);
    },
    async reset(rule, key) {
      store.delete(`${rule.id}:${key}`);
    },
  };
}

function createUpstashRateLimiter(redis: Redis, fallback: RateLimiter): RateLimiter {
  const limiters = new Map<string, Ratelimit>();
  const limiterFor = (rule: RateLimitRule) => {
    const cacheKey = `${rule.id}:${rule.limit}:${rule.windowMs}`;
    let limiter = limiters.get(cacheKey);
    if (!limiter) {
      limiter = new Ratelimit({
        redis,
        prefix: `erp-rl:${rule.id}`,
        limiter: Ratelimit.slidingWindow(rule.limit, `${Math.max(1, Math.round(rule.windowMs / 1000))} s`),
        timeout: 2_000,
      });
      limiters.set(cacheKey, limiter);
    }
    return limiter;
  };

  return {
    async limit(rule, key) {
      try {
        const response = await limiterFor(rule).limit(key);
        // Con timeout Upstash responde success=true: no lo damos por bueno.
        if (response.reason === "timeout") throw new Error("Upstash rate limit timeout");
        const at = Date.now();
        return result(rule, response.success, response.remaining, response.reset, at);
      } catch (error) {
        logger.warn({ err: error, bucket: rule.id }, "rate_limit.upstash_failed_using_memory");
        return fallback.limit(rule, key);
      }
    },
    async reset(rule, key) {
      await fallback.reset(rule, key);
      try {
        await limiterFor(rule).resetUsedTokens(key);
      } catch (error) {
        logger.warn({ err: error, bucket: rule.id }, "rate_limit.upstash_reset_failed");
      }
    },
  };
}

let sharedLimiter: RateLimiter | null = null;
let warnedInMemory = false;

export function getRateLimiter(): RateLimiter {
  if (sharedLimiter) return sharedLimiter;
  const memory = createMemoryRateLimiter();
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    sharedLimiter = createUpstashRateLimiter(new Redis({ url, token }), memory);
  } else {
    if (process.env.NODE_ENV === "production" && !warnedInMemory) {
      warnedInMemory = true;
      logger.warn("rate_limit.in_memory: Upstash no está configurado; el rate limit es por instancia.");
    }
    sharedLimiter = memory;
  }
  return sharedLimiter;
}

export function rateLimitKey(ip: string | null, suffix?: string) {
  const base = ip ?? "unknown";
  return suffix ? `${base}:${suffix}` : base;
}

export function tooManyRequestsResponse(limitResult: RateLimitResult) {
  const seconds = limitResult.retryAfterSeconds;
  return NextResponse.json(
    {
      message: `Demasiados intentos. Espera ${seconds} ${seconds === 1 ? "segundo" : "segundos"} y vuelve a intentarlo.`,
      retryAfter: seconds,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(seconds),
        "X-RateLimit-Limit": String(limitResult.limit),
        "X-RateLimit-Remaining": String(limitResult.remaining),
      },
    },
  );
}
