"use client";

import { SalesDocumentForm, type SalesCustomerOption } from "@/components/sales/sales-document-form";

export function CreateSalesOrderForm({
  currencyCode,
  customers,
  defaultTaxRate = 0,
  initialCustomerId,
}: {
  currencyCode?: string;
  customers: SalesCustomerOption[];
  defaultTaxRate?: number;
  initialCustomerId?: string;
}) {
  return (
    <SalesDocumentForm
      currencyCode={currencyCode}
      customers={customers}
      defaultTaxRate={defaultTaxRate}
      initialCustomerId={initialCustomerId}
      kind="order"
    />
  );
}
