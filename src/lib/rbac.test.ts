import { describe, expect, it } from "vitest";

import { APP_ROLES, assignableRoles, can, canManageMemberWithRole, isAppRole, roleDescriptions, type AppRole, type PermissionKey } from "@/lib/rbac";
import { roleLabels } from "@/lib/status-labels";

const reads: PermissionKey[] = [
  "customer.read",
  "supplier.read",
  "invoice.read",
  "purchase.read",
  "expense.read",
  "treasury.read",
  "stock.read",
  "series.read",
  "accounting.read",
  "fiscal.read",
  "reporting.read",
];
const dailyWrites: PermissionKey[] = [
  "customer.create",
  "supplier.create",
  "invoice.create",
  "invoice.write",
  "purchase.create",
  "purchase.write",
  "expense.write",
  "treasury.write",
  "stock.write",
];
const bookkeepingWrites: PermissionKey[] = ["accounting.write", "fiscal.write"];
const administration: PermissionKey[] = ["series.write", "team.read", "team.write", "billing.read", "apiKey.read", "apiKey.write", "settings.manage"];

function granted(role: AppRole, permissions: PermissionKey[]) {
  return permissions.filter((permission) => can(role, permission));
}

describe("RBAC permission matrix", () => {
  it("lets every role read every business module", () => {
    for (const role of APP_ROLES) expect(granted(role, reads), role).toEqual(reads);
  });

  it("gives owners everything and keeps billing changes owner-only", () => {
    expect(granted("OWNER", [...dailyWrites, ...bookkeepingWrites, ...administration, "billing.write"])).toHaveLength(dailyWrites.length + bookkeepingWrites.length + administration.length + 1);
    expect(can("ADMIN", "billing.write")).toBe(false);
    expect(granted("ADMIN", [...dailyWrites, ...bookkeepingWrites, ...administration])).toHaveLength(dailyWrites.length + bookkeepingWrites.length + administration.length);
  });

  it("lets members run the day-to-day but not the books, taxes or settings", () => {
    expect(granted("MEMBER", dailyWrites)).toEqual(dailyWrites);
    expect(granted("MEMBER", [...bookkeepingWrites, ...administration, "billing.write"])).toEqual([]);
  });

  it("lets the accountant (gestor) write accounting and tax only, without team, settings or billing", () => {
    expect(granted("ACCOUNTANT", bookkeepingWrites)).toEqual(bookkeepingWrites);
    expect(granted("ACCOUNTANT", [...dailyWrites, ...administration, "billing.write"])).toEqual([]);
  });

  it("keeps viewers strictly read-only", () => {
    expect(granted("VIEWER", [...dailyWrites, ...bookkeepingWrites, ...administration, "billing.write"])).toEqual([]);
  });

  it("describes and labels every role in Spanish", () => {
    for (const role of APP_ROLES) {
      expect(roleDescriptions[role].length, role).toBeGreaterThan(20);
      expect(roleLabels[role], role).toBeTruthy();
    }
    expect(roleLabels.ACCOUNTANT).toBe("Gestor/asesor");
    expect(roleLabels.VIEWER).toBe("Solo lectura");
  });

  it("validates role values coming from requests", () => {
    expect(isAppRole("ACCOUNTANT")).toBe(true);
    expect(isAppRole("VIEWER")).toBe(true);
    expect(isAppRole("SUPERADMIN")).toBe(false);
    expect(isAppRole(undefined)).toBe(false);
  });
});

describe("team management rules", () => {
  it("only lets owners assign the owner role", () => {
    expect(assignableRoles("OWNER")).toEqual([...APP_ROLES]);
    expect(assignableRoles("ADMIN")).toEqual(["ADMIN", "MEMBER", "ACCOUNTANT", "VIEWER"]);
    expect(assignableRoles("MEMBER")).toEqual([]);
    expect(assignableRoles("ACCOUNTANT")).toEqual([]);
    expect(assignableRoles("VIEWER")).toEqual([]);
  });

  it("lets admins manage everyone except owners and other admins", () => {
    expect(canManageMemberWithRole("OWNER", "OWNER")).toBe(true);
    expect(canManageMemberWithRole("ADMIN", "ADMIN")).toBe(false);
    expect(canManageMemberWithRole("ADMIN", "OWNER")).toBe(false);
    for (const target of ["MEMBER", "ACCOUNTANT", "VIEWER"] as const) expect(canManageMemberWithRole("ADMIN", target)).toBe(true);
    expect(canManageMemberWithRole("ACCOUNTANT", "VIEWER")).toBe(false);
  });
});
