"use client";

import { PurchaseOrderForm, type PurchaseItemOption, type PurchaseSupplierOption } from "@/components/purchases/purchase-order-form";

export function CreatePurchaseOrderForm({
  currencyCode = "EUR",
  items = [],
  redirectHref,
  suppliers = [],
}: {
  currencyCode?: string;
  items?: PurchaseItemOption[];
  redirectHref?: string;
  suppliers?: PurchaseSupplierOption[];
} = {}) {
  return <PurchaseOrderForm currencyCode={currencyCode} items={items} redirectHref={redirectHref} suppliers={suppliers} />;
}
