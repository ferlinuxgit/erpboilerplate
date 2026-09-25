import { describe, expect, it } from "vitest";

import { filterContextLinks, filterNavigationGroups, getContextGroup, isActiveRoute, navGroups, navigationLinks } from "@/components/layout/navigation-config";

describe("purchase navigation active state", () => {
  const purchaseLinks = {
    orders: "/purchases/orders",
    receipts: "/purchases/receipts",
    payments: "/purchases/payments",
    invoices: "/expenses",
  } as const;

  it.each([
    ["/purchases/orders", "orders"],
    ["/purchases/orders/new", "orders"],
    ["/purchases/orders/order-1", "orders"],
    ["/purchases/orders/order-1/edit", "orders"],
    ["/purchases/receipts", "receipts"],
    ["/purchases/receipts/receipt-1", "receipts"],
    ["/purchases/payments", "payments"],
    ["/expenses", "invoices"],
    ["/expenses/invoice-1", "invoices"],
  ] as const)("marks only the owning menu for %s", (pathname, activeKey) => {
    for (const [key, href] of Object.entries(purchaseLinks)) {
      expect(isActiveRoute(pathname, href), `${key} must be inactive for ${pathname}`).toBe(key === activeKey);
    }
  });
});

describe("navigation adapted to the business and the role", () => {
  const hrefs = (groups: ReturnType<typeof filterNavigationGroups>) => groups.flatMap((group) => group.links.map((link) => link.href));

  it("shows every module while the context is still loading", () => {
    expect(hrefs(filterNavigationGroups(navGroups, {}))).toEqual(navigationLinks.map((link) => link.href));
  });

  it("hides stock-only modules for pure service businesses", () => {
    const services = hrefs(filterNavigationGroups(navGroups, { businessType: "services", role: "OWNER" }));
    expect(services).not.toContain("/inventory");
    expect(services).not.toContain("/sales/delivery-notes");
    expect(services).not.toContain("/purchases/receipts");
    expect(services).toContain("/invoices");
    expect(hrefs(filterNavigationGroups(navGroups, { businessType: "products", role: "OWNER" }))).toContain("/inventory");
    expect(hrefs(filterNavigationGroups(navGroups, { businessType: "both", role: "OWNER" }))).toContain("/purchases/receipts");
  });

  it("hides context sub-pages that do not apply to service businesses", () => {
    const sales = getContextGroup("/invoices");
    expect(sales && filterContextLinks(sales, { businessType: "services" }).map((link) => link.href)).not.toContain("/sales/delivery-notes");
    expect(sales && filterContextLinks(sales, { businessType: "both" }).map((link) => link.href)).toContain("/sales/delivery-notes");
  });

  it("hides administration the role cannot open and drops empty groups", () => {
    const accountant = filterNavigationGroups(navGroups, { role: "ACCOUNTANT" });
    expect(hrefs(accountant)).toEqual(expect.arrayContaining(["/accounting", "/fiscal", "/invoices"]));
    expect(hrefs(accountant)).not.toContain("/settings/team");
    expect(hrefs(accountant)).not.toContain("/billing");
    expect(accountant.some((group) => group.label === "Administración" || group.label === "Avanzado")).toBe(false);
    // Only owners and admins see billing; admins see every administration page.
    expect(hrefs(filterNavigationGroups(navGroups, { role: "ADMIN" }))).toEqual(expect.arrayContaining(["/settings/team", "/settings/masters", "/billing"]));
    expect(hrefs(filterNavigationGroups(navGroups, { role: "MEMBER" }))).not.toContain("/settings/company");
  });

  it("groups API, audit and masters under a collapsible Avanzado section", () => {
    const advanced = navGroups.find((group) => group.label === "Avanzado");
    expect(advanced?.collapsible).toBe(true);
    expect(advanced?.links.map((link) => link.href)).toEqual(["/settings/masters", "/settings/api-keys", "/settings/audit"]);
  });

  it("uses unique two-digit codes and G 4 0 opens the administration section", () => {
    const codes = navigationLinks.map((link) => link.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => /^\d{2}$/.test(code))).toBe(true);
    expect(navigationLinks.find((link) => link.code === "40")?.href).toBe("/settings/company");
    expect(navigationLinks.find((link) => link.code === "31")?.href).toBe("/accounting");
  });

  it("names the tax module consistently as Fiscalidad and gives reports their own sub-navigation", () => {
    expect(navigationLinks.find((link) => link.href === "/fiscal")?.label).toBe("Fiscalidad");
    expect(getContextGroup("/fiscal/calendar")?.label).toBe("Fiscalidad");
    expect(getContextGroup("/reporting")?.links.length).toBeGreaterThan(1);
  });
});
