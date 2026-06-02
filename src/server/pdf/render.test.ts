import { describe, expect, it } from "vitest";

import { renderInvoicePdf, type InvoicePdfInput } from "@/server/pdf/render";

describe("renderInvoicePdf", () => {
  it("renders an invoice PDF buffer with lines and totals", async () => {
    const input: InvoicePdfInput = {
      number: "FAC-TEST-1",
      issueDate: "02/06/2026",
      dueDate: "17/06/2026",
      amount: "121,00 €",
      company: {
        name: "ERP Test",
        legalName: "ERP Test SL",
        vatNumber: "B12345674",
      },
      customer: {
        name: "Cliente Test SL",
        taxId: "B12345674",
        address: "Calle Test 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        countryCode: "ES",
      },
      lines: [
        {
          description: "Servicio test",
          quantity: "1",
          unitPrice: "100,00 €",
          taxRate: "21%",
          lineTotal: "121,00 €",
        },
      ],
      totals: {
        subtotal: "100,00 €",
        taxAmount: "21,00 €",
        retentionAmount: "0,00 €",
        hasRetention: false,
        totalAmount: "121,00 €",
      },
    };

    const pdf = await renderInvoicePdf(input);

    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
});
