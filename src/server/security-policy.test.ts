import { describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: dbMocks }));

import { can } from "@/lib/rbac";
import {
  describePolicyChanges,
  getSecurityPolicyState,
  updateTenantSecurityPolicy,
  type SecurityPolicyStore,
  type TenantSecurityPolicyRecord,
} from "./security-policy";

const baseRecord: TenantSecurityPolicyRecord = {
  id: "policy-1",
  tenantId: "tenant-1",
  sessionTimeoutMinutes: 30,
  requireTwoFactor: false,
  apiKeyRotationDays: null,
  allowedDomains: null,
  allowedIpNotes: null,
  createdAt: new Date("2026-05-09T08:00:00.000Z"),
  updatedAt: new Date("2026-05-09T08:00:00.000Z"),
};

function makeStore(existing: TenantSecurityPolicyRecord | null): SecurityPolicyStore {
  return {
    findByTenantId: vi.fn().mockResolvedValue(existing),
    create: vi.fn(async (tenantId, values) => ({
      ...baseRecord,
      ...values,
      id: "policy-created",
      tenantId,
      createdAt: new Date("2026-05-09T08:05:00.000Z"),
      updatedAt: new Date("2026-05-09T08:05:00.000Z"),
    })),
    update: vi.fn(async (id, values) => ({
      ...baseRecord,
      ...values,
      id,
      updatedAt: new Date("2026-05-09T08:10:00.000Z"),
    })),
  };
}

describe("security policy RBAC", () => {
  it("lets tenant admins manage security settings and blocks members", () => {
    expect(can("ADMIN", "settings.manage")).toBe(true);
    expect(can("MEMBER", "settings.manage")).toBe(false);
  });

  it("rejects member updates before persistence or audit logging", async () => {
    const store = makeStore(baseRecord);
    const audit = vi.fn();

    const result = await updateTenantSecurityPolicy({
      actorUserId: "member-1",
      role: "MEMBER",
      tenantId: "tenant-1",
      payload: { requireTwoFactor: true },
      store,
      audit,
    });

    expect(result.status).toBe(403);
    expect(store.findByTenantId).not.toHaveBeenCalled();
    expect(store.update).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("security policy state and auditing", () => {
  it("distinguishes enabled, disabled and not-configured controls", () => {
    const state = getSecurityPolicyState({
      ...baseRecord,
      requireTwoFactor: null,
      apiKeyRotationDays: 90,
      allowedDomains: "example.com, app.example.com",
    });
    const sessionTimeout = state.controls.find((control) => control.key === "sessionTimeoutMinutes");
    const twoFactor = state.controls.find((control) => control.key === "requireTwoFactor");
    const apiRotation = state.controls.find((control) => control.key === "apiKeyRotationDays");

    expect(sessionTimeout?.status).toBe("enabled");
    expect(sessionTimeout?.summary).toContain("30 minutes");
    expect(twoFactor?.status).toBe("not_configured");
    expect(apiRotation?.status).toBe("enabled");
    expect(state.controls.find((control) => control.key === "allowedDomains")?.status).toBe("enabled");

    const disabledState = getSecurityPolicyState({ ...baseRecord, sessionTimeoutMinutes: null, requireTwoFactor: false });
    expect(disabledState.controls.find((control) => control.key === "sessionTimeoutMinutes")?.status).toBe("not_configured");
    expect(disabledState.controls.find((control) => control.key === "requireTwoFactor")?.status).toBe("disabled");
  });

  it("describes changed fields only", () => {
    const changes = describePolicyChanges(baseRecord, {
      ...baseRecord,
      requireTwoFactor: true,
      apiKeyRotationDays: 120,
    });

    expect(changes).toEqual([
      { field: "requireTwoFactor", before: false, after: true },
      { field: "apiKeyRotationDays", before: null, after: 120 },
    ]);
  });

  it("persists admin changes and writes one audit entry with field diffs", async () => {
    const store = makeStore(baseRecord);
    const audit = vi.fn();

    const result = await updateTenantSecurityPolicy({
      actorUserId: "admin-1",
      role: "ADMIN",
      tenantId: "tenant-1",
      companyId: "company-1",
      payload: {
        sessionTimeoutMinutes: 45,
        requireTwoFactor: true,
        apiKeyRotationDays: 90,
        allowedDomains: "example.com",
        allowedIpNotes: "Office VPN only",
      },
      store,
      audit,
    });

    expect(result.status).toBe(200);
    expect(store.update).toHaveBeenCalledWith("policy-1", {
      sessionTimeoutMinutes: 45,
      requireTwoFactor: true,
      apiKeyRotationDays: 90,
      allowedDomains: "example.com",
      allowedIpNotes: "Office VPN only",
    });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        companyId: "company-1",
        actorUserId: "admin-1",
        action: "security_policy.updated",
        entityName: "tenant_security_policy",
        entityId: "policy-1",
        payload: expect.objectContaining({
          changes: expect.arrayContaining([
            { field: "sessionTimeoutMinutes", before: 30, after: 45 },
            { field: "requireTwoFactor", before: false, after: true },
          ]),
        }),
      }),
    );
  });
});
