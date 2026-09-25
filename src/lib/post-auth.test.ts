import { describe, expect, it } from "vitest";

import { decidePostAuthDestination } from "@/lib/post-auth";

const owner = { role: "OWNER" as const, onboardingSettled: false, companyReady: false };

describe("decidePostAuthDestination", () => {
  it("sends brand-new accounts (no workspace yet) to the setup wizard", () => {
    expect(decidePostAuthDestination({ membership: null })).toBe("/onboarding");
  });

  it("always honours a safe return path such as an invitation", () => {
    expect(decidePostAuthDestination({ nextPath: "/invitations/abc", membership: null })).toBe("/invitations/abc");
    expect(decidePostAuthDestination({ nextPath: "/invoices/new", membership: owner })).toBe("/invoices/new");
  });

  it("ignores unsafe or auth return paths", () => {
    expect(decidePostAuthDestination({ nextPath: "https://evil.example", membership: owner })).toBe("/onboarding");
    expect(decidePostAuthDestination({ nextPath: "//evil.example", membership: null })).toBe("/onboarding");
    expect(decidePostAuthDestination({ nextPath: "/auth/login", membership: { ...owner, companyReady: true } })).toBe("/dashboard");
  });

  it("redirects an owner whose company is not set up until they finish or postpone the wizard", () => {
    expect(decidePostAuthDestination({ membership: owner })).toBe("/onboarding");
    // Postponed ("Hacerlo más tarde") or completed: never again, so there is no loop.
    expect(decidePostAuthDestination({ membership: { ...owner, onboardingSettled: true } })).toBe("/dashboard");
    expect(decidePostAuthDestination({ membership: { ...owner, companyReady: true } })).toBe("/dashboard");
  });

  it("never redirects invited roles to the wizard", () => {
    for (const role of ["ADMIN", "MEMBER", "ACCOUNTANT", "VIEWER"] as const) {
      expect(decidePostAuthDestination({ membership: { role, onboardingSettled: false, companyReady: false } })).toBe("/dashboard");
    }
  });

  it("treats /dashboard as the default rather than an explicit destination", () => {
    expect(decidePostAuthDestination({ nextPath: "/dashboard", membership: owner })).toBe("/onboarding");
  });
});
