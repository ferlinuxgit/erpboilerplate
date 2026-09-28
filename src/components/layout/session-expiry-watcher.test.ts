import { describe, expect, it } from "vitest";

import { isSessionExpiredResponse } from "./session-expiry-watcher";

const origin = "https://erp.example.test";

describe("isSessionExpiredResponse", () => {
  it("treats a 401 from the app API as an expired session", () => {
    expect(isSessionExpiredResponse("/api/invoice-payments", 401, origin)).toBe(true);
    expect(isSessionExpiredResponse(`${origin}/api/customers?q=a`, 401, origin)).toBe(true);
  });

  it("ignores login errors, other statuses and other origins", () => {
    expect(isSessionExpiredResponse("/api/auth/login", 401, origin)).toBe(false);
    expect(isSessionExpiredResponse("/api/customers", 403, origin)).toBe(false);
    expect(isSessionExpiredResponse("https://other.example/api/x", 401, origin)).toBe(false);
  });
});
