import { describe, expect, it } from "vitest";

import { isActiveRoute } from "@/components/layout/navigation-config";

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
