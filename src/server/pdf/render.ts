import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";

import { FiscalReportPdfTemplate } from "@/server/pdf/templates/fiscal-report-template";
import { InvoicePdfTemplate } from "@/server/pdf/templates/invoice-template";
import type { SpanishFiscalSummary } from "@/server/fiscal/spain";

export type InvoicePdfInput = {
  number: string;
  amount: string;
  company: {
    name: string;
    legalName: string | null;
    vatNumber: string | null;
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
};

export async function renderInvoicePdf(input: InvoicePdfInput) {
  return renderToBuffer(
    createElement(InvoicePdfTemplate, input) as never,
  );
}

export async function renderFiscalReportPdf(input: { companyName: string; summary: SpanishFiscalSummary }) {
  return renderToBuffer(createElement(FiscalReportPdfTemplate, input) as never);
}
