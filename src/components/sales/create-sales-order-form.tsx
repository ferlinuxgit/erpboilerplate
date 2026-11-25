"use client";

import { SalesDocumentForm, type SaleCatalogEntry, type SalesCustomerOption, type SalesDocumentFormValues } from "@/components/sales/sales-document-form";

export function CreateSalesOrderForm({
  catalog,
  currencyCode,
  customers,
  defaultTaxRate = 21,
  initialCustomerId,
  initialValues,
  orderId,
}: {
  catalog?: SaleCatalogEntry[];
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
      catalog={catalog}
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
