import { describe, expect, it } from "vitest";

import { getInvalidIpRules, isIpAllowed, parseIpAllowlist } from "@/lib/ip-policy";

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
