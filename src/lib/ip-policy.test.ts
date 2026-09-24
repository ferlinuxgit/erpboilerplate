import { describe, expect, it } from "vitest";

import { getClientIp, getInvalidIpRules, getTrustedProxyCount, isIpAllowed, parseIpAllowlist } from "@/lib/ip-policy";

describe("IP access policy", () => {
  it("accepts exact IPv4 addresses and CIDR ranges", () => {
    expect(isIpAllowed("203.0.113.24", "203.0.113.24, 10.20.0.0/16")).toBe(true);
    expect(isIpAllowed("10.20.44.8", "203.0.113.24, 10.20.0.0/16")).toBe(true);
    expect(isIpAllowed("10.21.44.8", "203.0.113.24, 10.20.0.0/16")).toBe(false);
  });

  it("treats an empty policy as unrestricted and rejects malformed rules", () => {
    expect(isIpAllowed("127.0.0.1", "")).toBe(true);
    expect(isIpAllowed("127.0.0.1", "not-an-ip")).toBe(false);
    expect(parseIpAllowlist("10.0.0.1\n192.168.0.0/24")).toEqual(["10.0.0.1", "192.168.0.0/24"]);
  });

  it("reports malformed rules before a policy can be saved", () => {
    expect(getInvalidIpRules("10.0.0.1, 192.168.0.0/24")).toEqual([]);
    expect(getInvalidIpRules("10.0.0.999, 192.168.0.0/45, invalid")).toEqual([
      "10.0.0.999",
      "192.168.0.0/45",
      "invalid",
    ]);
  });
});

describe("getClientIp", () => {
  const headers = (values: Record<string, string>) => new Headers(values);

  it("takes the Nth IP from the right of X-Forwarded-For, ignoring client-controlled entries", () => {
    const spoofed = headers({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" });
    expect(getClientIp(spoofed, 1)).toBe("203.0.113.9");
    expect(getClientIp(headers({ "x-forwarded-for": "6.6.6.6, 198.51.100.7, 10.0.0.2" }), 2)).toBe("198.51.100.7");
  });

  it("uses the leftmost entry when there are fewer hops than trusted proxies", () => {
    expect(getClientIp(headers({ "x-forwarded-for": "198.51.100.7" }), 3)).toBe("198.51.100.7");
  });

  it("falls back to x-real-ip and normalizes ports and IPv4-mapped addresses", () => {
    expect(getClientIp(headers({ "x-real-ip": "::ffff:192.0.2.4" }), 1)).toBe("192.0.2.4");
    expect(getClientIp(headers({ "x-forwarded-for": "192.0.2.5:4431" }), 1)).toBe("192.0.2.5");
    expect(getClientIp(headers({ "x-forwarded-for": "[2001:db8::1]:443" }), 1)).toBe("2001:db8::1");
  });

  it("returns null when forwarding headers are untrusted, missing or malformed", () => {
    expect(getClientIp(headers({ "x-forwarded-for": "203.0.113.9" }), 0)).toBeNull();
    expect(getClientIp(headers({}), 1)).toBeNull();
    expect(getClientIp(headers({ "x-forwarded-for": "<script>" }), 1)).toBeNull();
  });

  it("reads TRUSTED_PROXY_COUNT with a safe default of 1", () => {
    expect(getTrustedProxyCount(undefined)).toBe(1);
    expect(getTrustedProxyCount("2")).toBe(2);
    expect(getTrustedProxyCount("0")).toBe(0);
    expect(getTrustedProxyCount("-3")).toBe(1);
    expect(getTrustedProxyCount("abc")).toBe(1);
  });
});
