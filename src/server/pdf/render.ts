import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";

import { FiscalReportPdfTemplate } from "@/server/pdf/templates/fiscal-report-template";
import { InvoicePdfTemplate } from "@/server/pdf/templates/invoice-template";
import type { SpanishFiscalSummary } from "@/server/fiscal/spain";

export type InvoicePdfInput = {
  number: string;
  issueDate: string;
  dueDate: string | null;
  amount: string;
  company: {
    name: string;
    legalName: string | null;
    vatNumber: string | null;
    fiscalAddress: string | null;
    fiscalAddressLine2: string | null;
    postalCode: string | null;
    city: string | null;
    province: string | null;
    countryCode: string | null;
    email: string | null;
    phone: string | null;
    website: string | null;
    logoDataUrl: string | null;
    invoiceFooter: string | null;
  };
  customer: {
    name: string;
    taxId: string | null;
    address: string | null;
    addressLine2: string | null;
    postalCode: string | null;
    city: string | null;
    province: string | null;
    countryCode: string | null;
  };
  lines: Array<{
    description: string;
    quantity: string;
    unitPrice: string;
    taxRate: string;
    lineTotal: string;
  }>;
  totals: {
    subtotal: string;
    taxAmount: string;
    retentionAmount: string;
    hasRetention: boolean;
    totalAmount: string;
  };
};

export async function renderInvoicePdf(input: InvoicePdfInput) {
  return renderToBuffer(
    createElement(InvoicePdfTemplate, input) as never,
  );
}

export async function renderFiscalReportPdf(input: { companyName: string; summary: SpanishFiscalSummary }) {
  return renderToBuffer(createElement(FiscalReportPdfTemplate, input) as never);
}
