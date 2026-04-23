import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";

import { InvoicePdfTemplate } from "@/server/pdf/templates/invoice-template";

export async function renderInvoicePdf(input: { number: string; customerName: string; amount: string }) {
  return renderToBuffer(
    createElement(InvoicePdfTemplate, { number: input.number, customerName: input.customerName, amount: input.amount }) as never,
  );
}
