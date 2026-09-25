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
