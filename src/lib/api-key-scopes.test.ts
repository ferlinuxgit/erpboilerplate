import { describe, expect, it } from "vitest";

import { vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/current-user", () => ({ getUserSession: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ ensureUserTenant: vi.fn() }));

import { normalizeApiKeyScopes, parseStoredApiKeyScopes } from "@/lib/api-key-scopes";
import { hasApiActorPermission, type AuthenticatedApiActor } from "@/lib/integration-auth";

const context: AuthenticatedApiActor["context"] = {
  tenant: { id: "tenant-1", name: "Tenant", slug: "tenant" },
  company: { id: "company-1", name: "Company", countryCode: "ES", baseCurrencyCode: "EUR" },
  fiscalYear: { id: "year-1", code: "2026" },
  membership: { id: "member-1", role: "ADMIN" },
};

describe("API key scopes", () => {
  it("keeps only supported unique permissions", () => {
    expect(normalizeApiKeyScopes(["invoice.read", "invoice.read", "unknown", 12])).toEqual(["invoice.read"]);
    expect(parseStoredApiKeyScopes("not-json")).toEqual([]);
  });

  it("does not inherit the synthetic ADMIN role when using an API key", () => {
    const actor: AuthenticatedApiActor = { context, actorUserId: "api-key:key-1", kind: "apiKey", scopes: ["invoice.read"] };
    expect(hasApiActorPermission(actor, "invoice.read")).toBe(true);
    expect(hasApiActorPermission(actor, "invoice.write")).toBe(false);
    expect(hasApiActorPermission(actor, "customer.read")).toBe(false);
  });
});
