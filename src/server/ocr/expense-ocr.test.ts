import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { parseExpenseOcrText } from "@/server/ocr/expense-ocr";

describe("expense OCR parser", () => {
  it("extracts common Spanish invoice fields and balances totals", () => {
    const draft = parseExpenseOcrText(`
      Proveedor: Electricidad Ejemplo SL
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
      supplierDocumentNumber: "F-2026-001",
      subtotalAmount: 100,
      taxAmount: 21,
      retentionAmount: 15,
      totalAmount: 106,
      confidence: "high",
    });
    expect(draft.lines[0]).toMatchObject({ unitPrice: 100, taxRate: 21, retentionRate: 15 });
  });
});
