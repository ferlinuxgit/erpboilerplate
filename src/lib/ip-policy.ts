function ipv4ToNumber(value: string): number | null {
  const parts = value.trim().split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
}

export function parseIpAllowlist(value: string | null | undefined): string[] {
  return (value ?? "").split(/[\s,;]+/).map((entry) => entry.trim()).filter(Boolean);
}

export function getInvalidIpRules(value: string | null | undefined): string[] {
  return parseIpAllowlist(value).filter((rule) => {
    const parts = rule.split("/");
    if (parts.length > 2 || ipv4ToNumber(parts[0]) === null) return true;
    if (parts.length === 1) return false;
    const prefix = Number(parts[1]);
    return !Number.isInteger(prefix) || prefix < 0 || prefix > 32;
  });
}

export function isIpAllowed(ip: string, allowlist: string | null | undefined): boolean {
  const rules = parseIpAllowlist(allowlist);
  if (rules.length === 0) return true;
  const address = ipv4ToNumber(ip.replace(/^::ffff:/, ""));
  if (address === null) return false;
  return rules.some((rule) => {
    const [networkText, prefixText] = rule.split("/");
    const network = ipv4ToNumber(networkText);
    if (network === null) return false;
    if (prefixText === undefined) return address === network;
    const prefix = Number(prefixText);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (address & mask) === (network & mask);
  });
}

type HeaderReader = { get(name: string): string | null };

const DEFAULT_TRUSTED_PROXY_COUNT = 1;

export function getTrustedProxyCount(value = process.env.TRUSTED_PROXY_COUNT): number {
  if (value === undefined || value.trim() === "") return DEFAULT_TRUSTED_PROXY_COUNT;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_TRUSTED_PROXY_COUNT;
}

function normalizeIp(value: string | null | undefined): string | null {
  let candidate = value?.trim();
  if (!candidate) return null;
  // "[2001:db8::1]:443" → "2001:db8::1"; "203.0.113.5:8080" → "203.0.113.5".
  const bracketed = candidate.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) candidate = bracketed[1];
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  candidate = candidate.replace(/^::ffff:(?=\d{1,3}(?:\.\d{1,3}){3}$)/i, "");
  if (candidate.length > 45 || !/^[0-9a-f.:]+$/i.test(candidate)) return null;
  return candidate;
}

/**
 * IP real del cliente detrás de `TRUSTED_PROXY_COUNT` proxies de confianza.
 *
 * Cada proxy de confianza añade a `X-Forwarded-For` la IP que ve, así que la
 * IP del cliente es la N-ésima empezando por la DERECHA. Lo que haya más a la
 * izquierda lo controla el cliente y no se usa nunca. Si no hay XFF se usa
 * `x-real-ip` (fijado por el proxy). Con `TRUSTED_PROXY_COUNT=0` no se confía en
 * ninguna cabecera y se devuelve `null` (IP desconocida).
 */
export function getClientIp(headers: HeaderReader, trustedProxyCount = getTrustedProxyCount()): string | null {
  if (trustedProxyCount <= 0) return null;

  const forwarded = headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (forwarded && forwarded.length > 0) {
    const index = Math.max(0, forwarded.length - trustedProxyCount);
    return normalizeIp(forwarded[index]);
  }

  return normalizeIp(headers.get("x-real-ip"));
}
