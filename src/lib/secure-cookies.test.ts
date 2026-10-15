import { afterEach, describe, expect, it, vi } from "vitest";

import { shouldUseSecureCookies } from "@/lib/secure-cookies";

afterEach(() => vi.unstubAllEnvs());

describe("shouldUseSecureCookies", () => {
  it("is off outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_URL", "https://erp.example.com");
    expect(shouldUseSecureCookies()).toBe(false);
  });

  it("is on in production over HTTPS or when APP_URL is not set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://erp.example.com");
    expect(shouldUseSecureCookies()).toBe(true);
    vi.stubEnv("APP_URL", "");
    expect(shouldUseSecureCookies()).toBe(true);
  });

  it("is off in production served over plain HTTP (e2e on 127.0.0.1, LAN installs)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "http://127.0.0.1:3000");
    expect(shouldUseSecureCookies()).toBe(false);
  });
});
