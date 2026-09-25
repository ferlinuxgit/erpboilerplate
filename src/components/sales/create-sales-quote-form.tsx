"use client";

import { SalesDocumentForm, type SalesCustomerOption, type SalesDocumentFormValues, type SalesDocumentLineValues } from "@/components/sales/sales-document-form";

export type QuoteLine = SalesDocumentLineValues;
export type SalesQuoteFormValues = SalesDocumentFormValues & { validUntil: string };

export function CreateSalesQuoteForm({
  currencyCode,
  customers,
  defaultTaxRate = 21,
  initialCustomerId,
  initialValues,
  quoteId,
}: {
  currencyCode?: string;
  customers: SalesCustomerOption[];
  initialCustomerId?: string;
  initialValues?: SalesQuoteFormValues;
  quoteId?: string;
  defaultTaxRate?: number;
}) {
  return (
    <SalesDocumentForm
      currencyCode={currencyCode}
      customers={customers}
      defaultTaxRate={defaultTaxRate}
      documentId={quoteId}
      initialCustomerId={initialCustomerId}
      initialValues={initialValues}
      kind="quote"
    />
  );
}
