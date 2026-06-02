import { describe, expect, it } from "vitest";

import { bearerToken, hasApiKeyBearerAuthorization } from "@/lib/api-auth-header";

describe("api auth header helpers", () => {
  it("extracts bearer tokens", () => {
    expect(bearerToken("Bearer ak_example")).toBe("ak_example");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });

  it("detects API key bearer authorization only", () => {
    expect(hasApiKeyBearerAuthorization("Bearer ak_example")).toBe(true);
    expect(hasApiKeyBearerAuthorization("Bearer session_token")).toBe(false);
    expect(hasApiKeyBearerAuthorization(null)).toBe(false);
  });
});
