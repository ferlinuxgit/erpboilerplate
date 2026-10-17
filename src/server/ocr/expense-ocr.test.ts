import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { parseExpenseOcrText } from "@/server/ocr/expense-ocr";

describe("expense OCR parser", () => {
  it("extracts common Spanish invoice fields and balances totals", () => {
    const draft = parseExpenseOcrText(`
      Proveedor: Electricidad Ejemplo SL
      CIF: B12345674
      Factura: F-2026-001
      Fecha factura: 03/06/2026
      Vencimiento: 20/06/2026
      Base imponible: 100,00
      IVA 21%: 21,00
      Retencion 15%: 15,00
      Total factura: 106,00
    `);

    expect(draft).toMatchObject({
      supplierName: "Electricidad Ejemplo SL",
      supplierTaxId: "B12345674",
      supplierDocumentNumber: "F-2026-001",
      subtotalAmount: 100,
      taxAmount: 21,
      retentionAmount: 15,
      totalAmount: 106,
      confidence: "high",
    });
    expect(draft.lines[0]).toMatchObject({ unitPrice: 100, taxRate: 21, retentionRate: 15 });
  });

  it("extracts supplier tax id independently from the supplier name", () => {
    const draft = parseExpenseOcrText(`
      Factura: 2026/77
      CIF: B12345674
      Fecha factura: 03/06/2026
      Total factura: 121,00
      Base imponible: 100,00
      IVA 21%: 21,00
    `);

    expect(draft.supplierTaxId).toBe("B12345674");
    expect(draft.warnings).not.toContain("No se pudo identificar el proveedor con confianza.");
  });

  it("rejects impossible calendar dates instead of rolling them into another month", () => {
    const draft = parseExpenseOcrText(`
      Proveedor: Electricidad Ejemplo SL
      CIF: B12345674
      Factura: F-INVALID-DATE
      Fecha factura: 31/02/2026
      Base imponible: 100,00
      IVA 21%: 21,00
      Total factura: 121,00
    `);
    expect(draft.issueDate).toBeUndefined();
  });

  it("never reports high confidence when the expense account cannot be deduced", () => {
    const draft = parseExpenseOcrText(`
      Proveedor: Comercial Pérez SL
      CIF: B12345674
      Factura: F-2026-010
      Fecha factura: 03/06/2026
      Base imponible: 100,00
      IVA 21%: 21,00
      Total factura: 121,00
    `);
    expect(draft.confidence).toBe("medium");
    expect(draft.lines[0].suggestedExpenseAccountCode).toBeUndefined();
    expect(draft.warnings.join(" ")).toMatch(/cuenta de gasto/);
  });

  it("reads a realistic layout: FACTURA heading, plain Fecha label, Subtotal before Total and the customer's own NIF", () => {
    const draft = parseExpenseOcrText(`
      Suministros Levante SL
      CIF: B12345674
      FACTURA
      Fecha: 03/06/2026
      Nº factura: A-2026/118
      Cliente: Mi Empresa SL
      NIF cliente: B87654315
      Cooperativa 12 unidades
      Subtotal: 100,00
      IVA 21%: 21,00
      Total IVA: 21,00
      Total: 121,00
    `, { ownTaxIds: ["ESB87654315"] });

    expect(draft).toMatchObject({
      supplierTaxId: "B12345674",
      supplierDocumentNumber: "A-2026/118",
      issueDate: "2026-06-03T12:00:00.000Z",
      subtotalAmount: 100,
      taxAmount: 21,
      totalAmount: 121,
    });
    expect(draft.warnings.join(" ")).not.toMatch(/no cuadran/);
  });

  it("never takes the company's own NIF as the supplier's", () => {
    const draft = parseExpenseOcrText(`
      Cliente: Mi Empresa SL
      NIF: B87654315
      Factura: F-1
      Fecha: 03/06/2026
      Total: 121,00
    `, { ownTaxIds: ["B87654315"] });
    expect(draft.supplierTaxId).toBeUndefined();
  });

  it("does not take the next word as invoice number nor the due date as issue date", () => {
    const draft = parseExpenseOcrText(`
      FACTURA SIMPLIFICADA
      Due date: 20/06/2026
      Base imponible: 50,00
      IVA 21%
      10,50
      Total: 60,50
    `);
    expect(draft.supplierDocumentNumber).toBeUndefined();
    expect(draft.issueDate).toBeUndefined();
    expect(draft.dueDate).toBe("2026-06-20T12:00:00.000Z");
    expect(draft.taxAmount).not.toBe(21);
    expect(draft.warnings.join(" ")).toMatch(/fecha de factura/);
  });

  it("reads an EU supplier invoice with reverse charge: no Spanish VAT charged, payable is the base", () => {
    // Texto tal como lo extrae pdf.js de una factura de Anthropic Ireland.
    const draft = parseExpenseOcrText(`Page 1 of 1
 Invoice
 Invoice number   9BF0758D   6747155
 Date of issue   September 24, 2026
Date due   September 24, 2026
 Anthropic Ireland, Limited
 6th Floor, South Bank House
Dublin 4
Ireland
IE VAT IE4276970QH
 Bill to
 Fernando Nuñez Cavas
30310 Cartagena Murcia
ES NIF 23052472D
 Reverse charge applies - Customer to account for tax under Article 196 of Directive 2006/112/EC.
 Description   Qty   Unit price   Tax   Amount
 Max plan - 20x
1   €180.00   0%   €180.00
 Unused time on Max plan - 5x after 24 Sep 2026
1   0%     €86.67
 Subtotal   €93.33
Total   €93.33
 Amount due   €93.33`, { ownTaxIds: ["23052472D"] });

    expect(draft).toMatchObject({
      supplierName: "Anthropic Ireland, Limited",
      supplierTaxId: "IE4276970QH",
      supplierCountryCode: "IE",
      vatTreatment: "INTRA_EU",
      issueDate: "2026-09-24T12:00:00.000Z",
      dueDate: "2026-09-24T12:00:00.000Z",
      subtotalAmount: 93.33,
      totalAmount: 93.33,
    });
    expect(draft.lines[0]).toMatchObject({ unitPrice: 93.33, taxRate: 21 });
    expect(draft.warnings.join(" ")).toMatch(/inversión del sujeto pasivo/);
    expect(draft.confidence).not.toBe("high");
  });

  it("marks reverse charge from the wording even without a foreign VAT number", () => {
    const draft = parseExpenseOcrText(`
      Proveedor: Construcciones Ejemplo SL
      CIF: B12345674
      Factura: F-77
      Fecha factura: 03/06/2026
      Operación con inversión del sujeto pasivo (art. 84.Uno.2º LIVA)
      Base imponible: 1000,00
      Total factura: 1000,00
    `);
    expect(draft.supplierCountryCode).toBe("ES");
    expect(draft.vatTreatment).toBe("REVERSE_CHARGE");
  });

  it("does not propose a VAT treatment for ordinary Spanish invoices", () => {
    const draft = parseExpenseOcrText(`
      Proveedor: Electricidad Ejemplo SL
      CIF: B12345674
      Factura: F-2026-001
      Fecha factura: 03/06/2026
      Base imponible: 100,00
      IVA 21%: 21,00
      Total factura: 121,00
    `);
    expect(draft.vatTreatment).toBeUndefined();
    expect(draft.lines[0].taxRate).toBe(21);
  });

  it("never reports high confidence when the VAT rate was assumed", () => {
    const draft = parseExpenseOcrText(`
      Proveedor: Gasolinera Repsol Norte SL
      CIF: B12345674
      Factura: T-889
      Fecha factura: 03/06/2026
      Base imponible: 50,00
      IVA: 10,50
      Total factura: 60,50
      Gasolina 95
    `);
    expect(draft.lines[0].suggestedExpenseAccountCode).toBe("628");
    expect(draft.confidence).toBe("medium");
    expect(draft.warnings.join(" ")).toMatch(/tipo de IVA/);
  });
});
