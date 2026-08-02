import { Font } from "@react-pdf/renderer";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { renderInvoicePdf, type InvoicePdfInput } from "@/server/pdf/render";

const tinyPngLogo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

async function pdfText(pdf: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({
    data: new Uint8Array(pdf),
    standardFontDataUrl: `${resolve("node_modules/pdfjs-dist/standard_fonts")}/`,
  }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
  }
  return pages.join(" ");
}

describe("renderInvoicePdf", () => {
  function createInput(overrides: Partial<InvoicePdfInput> = {}): InvoicePdfInput {
    return {
      number: "FAC-TEST-1",
      issueDate: "02/06/2026",
      dueDate: "17/06/2026",
      amount: "121,00 €",
      payment: {
        name: "Transferencia a cuenta bancaria",
        typeLabel: "Transferencia bancaria",
        bankAccountNumber: "ES12 3456 7890 1234 5678 9012",
      },
      company: {
        name: "ERP Test",
        legalName: "ERP Test SL",
        vatNumber: "B12345674",
        fiscalAddress: "Calle Emisor 1",
        fiscalAddressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        countryCode: "ES",
        email: "admin@example.com",
        phone: "+34910000000",
        website: "https://example.com",
        logoDataUrl: null,
        invoiceFooter: "Inscrita en el Registro Mercantil de Madrid.",
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
          taxRate: "IVA general",
          lineTotal: "121,00 €",
        },
      ],
      totals: {
        subtotal: "100,00 €",
        taxAmount: "21,00 €",
        retentionAmount: "0,00 €",
        hasRetention: false,
        totalAmount: "121,00 €",
        breakdown: [
          {
            name: "IVA general",
            rate: "21%",
            base: "100,00 €",
            amount: "21,00 €",
            operation: "ADD",
          },
        ],
      },
      ...overrides,
    };
  }

  it("keeps complete words instead of inserting hyphenated line breaks", () => {
    const hyphenationCallback = Font.getHyphenationCallback();

    expect(hyphenationCallback).not.toBeNull();
    expect(hyphenationCallback?.("extraordinariamente")).toEqual(["extraordinariamente"]);
  });

  it("renders an invoice PDF buffer with lines and totals", async () => {
    const input = createInput();

    const pdf = await renderInvoicePdf(input);

    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("renders an invoice PDF buffer with the company logo", async () => {
    const pdf = await renderInvoicePdf(createInput({ company: { ...createInput().company, logoDataUrl: tinyPngLogo } }));

    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("renders every payment method configured on the invoice", async () => {
    const input = createInput({
      payment: null,
      payments: [
        { name: "Transferencia principal", typeLabel: "Transferencia bancaria", bankAccountNumber: "ES12 3456 7890 1234 5678 9012" },
        { name: "Pago con tarjeta", typeLabel: "Tarjeta", bankAccountNumber: null },
      ],
    });

    const text = await pdfText(await renderInvoicePdf(input));

    expect(text).toContain("Transferencia principal");
    expect(text).toContain("Pago con tarjeta");
  });

  it("respects the configured visibility of contact, payment and fiscal blocks", async () => {
    const input = createInput({
      display: {
        showLogo: false,
        showEmail: false,
        showPhone: false,
        showWebsite: false,
        showCustomerNumber: false,
        showPaymentMethod: false,
        showTaxBreakdown: false,
      },
      customer: { ...createInput().customer, number: "CLI-0001" },
    });

    const text = await pdfText(await renderInvoicePdf(input));

    expect(text).not.toContain("admin@example.com");
    expect(text).not.toContain("+34910000000");
    expect(text).not.toContain("https://example.com");
    expect(text).not.toContain("CLI-0001");
    expect(text).not.toContain("Transferencia a cuenta bancaria");
    expect(text).not.toContain("Desglose de impuestos");
  });
});
