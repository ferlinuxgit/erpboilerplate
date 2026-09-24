import { describe, expect, it } from "vitest";

import { loginPathWithNext, safeNextPath } from "@/lib/auth-client";
import { isSafeAttachmentUrl } from "@/lib/http";

describe("safeNextPath", () => {
  it("accepts internal relative paths with query and hash", () => {
    expect(safeNextPath("/invoices/123?tab=lines#totales")).toBe("/invoices/123?tab=lines#totales");
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
  });

  it.each([
    "https://evil.example.com",
    "//evil.example.com",
    "/\\evil.example.com",
    "\\\\evil.example.com",
    "javascript:alert(1)",
    "invoices",
    "/auth/login",
    "/api/auth/logout",
    "/ok\nnext",
    "",
    null,
    42,
  ])("rejects %s", (value) => {
    expect(safeNextPath(value)).toBeNull();
  });

  it("builds the login URL keeping only safe next paths", () => {
    expect(loginPathWithNext("/sales/orders?page=2", "session-expired")).toBe("/auth/login?next=%2Fsales%2Forders%3Fpage%3D2&reason=session-expired");
    expect(loginPathWithNext("//evil.example.com")).toBe("/auth/login");
    expect(loginPathWithNext(null, "session-expired")).toBe("/auth/login?reason=session-expired");
  });
});

describe("isSafeAttachmentUrl", () => {
  it("accepts http(s) and same-origin relative URLs", () => {
    expect(isSafeAttachmentUrl("https://cdn.example.com/f.pdf")).toBe(true);
    expect(isSafeAttachmentUrl("http://files.example.com/f.pdf")).toBe(true);
    expect(isSafeAttachmentUrl("/api/expenses/ocr/1/file")).toBe(true);
  });

  it.each(["javascript:alert(1)", "data:text/html,<script>", "//evil.example.com/x", "/\\evil", "ftp://x/y", "https://user:pw@x.com", "relative/path"])("rejects %s", (value) => {
    expect(isSafeAttachmentUrl(value)).toBe(false);
  });
});
