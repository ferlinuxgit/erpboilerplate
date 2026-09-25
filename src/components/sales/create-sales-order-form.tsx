"use client";

import { SalesDocumentForm, type SalesCustomerOption, type SalesDocumentFormValues } from "@/components/sales/sales-document-form";

export function CreateSalesOrderForm({
  currencyCode,
  customers,
  defaultTaxRate = 21,
  initialCustomerId,
  initialValues,
  orderId,
}: {
  currencyCode?: string;
  customers: SalesCustomerOption[];
  defaultTaxRate?: number;
  initialCustomerId?: string;
  initialValues?: SalesDocumentFormValues;
  /** Edición de un pedido existente (sin albaranes ni factura). */
  orderId?: string;
}) {
  return (
    <SalesDocumentForm
      currencyCode={currencyCode}
      customers={customers}
      defaultTaxRate={defaultTaxRate}
      documentId={orderId}
      initialCustomerId={initialCustomerId}
      initialValues={initialValues}
      kind="order"
    />
  );
}
