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
