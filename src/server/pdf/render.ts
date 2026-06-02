import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";

import { FiscalReportPdfTemplate } from "@/server/pdf/templates/fiscal-report-template";
import { InvoicePdfTemplate } from "@/server/pdf/templates/invoice-template";
import type { SpanishFiscalSummary } from "@/server/fiscal/spain";

export async function renderInvoicePdf(input: { number: string; customerName: string; amount: string }) {
  return renderToBuffer(
    createElement(InvoicePdfTemplate, { number: input.number, customerName: input.customerName, amount: input.amount }) as never,
  );
}

export async function renderFiscalReportPdf(input: { companyName: string; summary: SpanishFiscalSummary }) {
  return renderToBuffer(createElement(FiscalReportPdfTemplate, input) as never);
}
