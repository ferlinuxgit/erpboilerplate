/**
 * Verificación anti-bots (Cloudflare Turnstile) en el alta y la recuperación de contraseña.
 * Opcional: solo se exige con TURNSTILE_SECRET_KEY y TURNSTILE_SITE_KEY configuradas.
 */

export function captchaSiteKey() {
  return process.env.TURNSTILE_SITE_KEY?.trim() || null;
}

function captchaSecret() {
  return process.env.TURNSTILE_SECRET_KEY?.trim() || null;
}

export function isCaptchaEnabled() {
  return Boolean(captchaSecret() && captchaSiteKey());
}

/** true si no hay captcha configurado o si Cloudflare valida el token. */
export async function verifyCaptcha(token: unknown, remoteIp?: string | null) {
  const secret = captchaSecret();
  if (!secret || !captchaSiteKey()) return true;
  if (typeof token !== "string" || !token.trim() || token.length > 4096) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(5_000) });
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch {
    return false;
  }
}

export const CAPTCHA_FAILED_MESSAGE = "Completa la verificación de seguridad e inténtalo de nuevo.";
