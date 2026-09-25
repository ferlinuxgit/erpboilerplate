"use client";

import { PurchaseOrderForm, type PurchaseItemOption, type PurchaseOrderInitialLine, type PurchaseSupplierOption } from "@/components/purchases/purchase-order-form";

export function EditPurchaseOrderForm({
  currencyCode,
  defaultNumber,
  defaultStatus,
  defaultSupplierId,
  initialLines,
  items,
  orderId,
  suppliers,
}: {
  orderId: string;
  currencyCode: string;
  defaultNumber: string;
  defaultStatus: string;
  defaultSupplierId: string;
  initialLines: PurchaseOrderInitialLine[];
  items: PurchaseItemOption[];
  suppliers: PurchaseSupplierOption[];
}) {
  return (
    <PurchaseOrderForm
      currencyCode={currencyCode}
      defaultNumber={defaultNumber}
      defaultStatus={defaultStatus}
      defaultSupplierId={defaultSupplierId}
      initialLines={initialLines}
      items={items}
      orderId={orderId}
      suppliers={suppliers}
    />
  );
}
