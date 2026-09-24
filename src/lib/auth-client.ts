import { getCsrfHeader } from "@/lib/csrf-client";

type AuthEmailPayload = {
  email: string;
  password: string;
  name?: string;
};

type AuthClientResult = {
  data: unknown | null;
  error: { message?: string; status?: number } | null;
};

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

/** URL de login que conserva la ruta de retorno (si es segura). */
export function loginPathWithNext(nextPath: string | null | undefined, reason?: string) {
  const params = new URLSearchParams();
  const safeNext = safeNextPath(nextPath);
  if (safeNext && safeNext !== "/dashboard") params.set("next", safeNext);
  if (reason) params.set("reason", reason);
  const query = params.toString();
  return query ? `/auth/login?${query}` : "/auth/login";
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
    email: (payload: Required<AuthEmailPayload>) => authRequest("/api/auth/register", payload),
  },
  verifyTwoFactor: (payload: { challengeId: string; code: string }) => authRequest("/api/auth/verify-two-factor", payload),
  signOut: () => authRequest("/api/auth/logout"),
};
