import { getCsrfHeader } from "@/lib/csrf-client";

type AuthEmailPayload = {
  email: string;
  password: string;
  name?: string;
  /** Ruta de retorno solicitada; el servidor la valida y decide el destino final. */
  next?: string | null;
};

type AuthClientResult = {
  data: unknown | null;
  error: { message?: string; status?: number; code?: string } | null;
};

/** Código de error del login cuando la cuenta existe pero el correo no está verificado. */
export const EMAIL_NOT_VERIFIED_CODE = "EMAIL_NOT_VERIFIED";

export const SESSION_EXPIRED_REASON = "session-expired";

/**
 * Devuelve `value` solo si es una ruta relativa interna segura para redirigir
 * tras el login (evita open redirects: `//evil.com`, `/\evil.com`, `https://…`).
 * Excluye `/auth/*` para no generar bucles. Devuelve `null` si no es válida.
 */
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > 2048) return null;
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return null;
  // Barras invertidas y caracteres de control se normalizan de forma distinta según el navegador.
  if (/[\\\u0000-\u001f\u007f]/.test(candidate)) return null;

  let parsed: URL;
  try {
    parsed = new URL(candidate, "http://erp.invalid");
  } catch {
    return null;
  }
  if (parsed.origin !== "http://erp.invalid") return null;
  if (parsed.pathname === "/auth" || parsed.pathname.startsWith("/auth/")) return null;
  if (parsed.pathname.startsWith("/api/")) return null;

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function authPathWithNext(base: string, nextPath: string | null | undefined, reason?: string) {
  const params = new URLSearchParams();
  const safeNext = safeNextPath(nextPath);
  if (safeNext && safeNext !== "/dashboard") params.set("next", safeNext);
  if (reason) params.set("reason", reason);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/** URL de login que conserva la ruta de retorno (si es segura). */
export function loginPathWithNext(nextPath: string | null | undefined, reason?: string) {
  return authPathWithNext("/auth/login", nextPath, reason);
}

/** URL de registro que conserva la ruta de retorno (p. ej. una invitación). */
export function registerPathWithNext(nextPath: string | null | undefined) {
  return authPathWithNext("/auth/register", nextPath);
}

/** Destino devuelto por el servidor tras autenticar (`redirectTo`), revalidado en cliente. */
export function redirectTargetFrom(data: unknown, fallback = "/dashboard") {
  const candidate = typeof data === "object" && data !== null && "redirectTo" in data ? (data as { redirectTo?: unknown }).redirectTo : null;
  return safeNextPath(candidate) ?? fallback;
}

async function authRequest(path: string, payload?: unknown): Promise<AuthClientResult> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getCsrfHeader(),
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
  } catch {
    return { data: null, error: { message: "No se pudo conectar con el servidor. Revisa tu conexión." } };
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      data: null,
      error: {
        message: data?.error ?? data?.message ?? "No se pudo completar la autenticación.",
        status: response.status,
        code: typeof data?.code === "string" ? data.code : undefined,
      },
    };
  }

  return { data, error: null };
}

export const authClient = {
  signIn: {
    email: (payload: AuthEmailPayload) => authRequest("/api/auth/login", payload),
  },
  signUp: {
    email: (payload: AuthEmailPayload & { name: string }) => authRequest("/api/auth/register", payload),
  },
  verifyTwoFactor: (payload: { challengeId: string; code: string; next?: string | null }) => authRequest("/api/auth/verify-two-factor", payload),
  resendVerification: (payload: { email: string; next?: string | null }) => authRequest("/api/auth/resend-verification", payload),
  requestPasswordReset: (payload: { email: string }) => authRequest("/api/auth/forgot-password", payload),
  resetPassword: (payload: { token: string; password: string }) => authRequest("/api/auth/reset-password", payload),
  signOut: () => authRequest("/api/auth/logout"),
};
