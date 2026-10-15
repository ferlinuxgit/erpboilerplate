/**
 * Si las cookies llevan el atributo `Secure` (solo viajan por HTTPS). En producción sí, salvo que
 * la app se sirva explícitamente por HTTP (`APP_URL=http://…`, p. ej. los e2e con `next start` en
 * 127.0.0.1 o una instalación en red local sin TLS): ahí el navegador no las devolvería.
 */
export function shouldUseSecureCookies() {
  if (process.env.NODE_ENV !== "production") return false;
  return !process.env.APP_URL?.trim().toLowerCase().startsWith("http://");
}
