import { describe, expect, it } from "vitest";

import { LEGAL_MENTION_PRESETS, appendLegalMention, hasUntaxedBase, legalMentionLines, untaxedBaseLegalNote } from "@/server/invoices/legal-mentions";

const vat = (rate: number, baseAmount: number) => ({ kind: "VAT", operation: "ADD", rate, baseAmount, amount: Math.round(baseAmount * rate) / 100 });

describe("menciones legales", () => {
  it("las plantillas incluyen los regímenes especiales y la facturación por el destinatario", () => {
    const texts = LEGAL_MENTION_PRESETS.map((preset) => preset.text);
    expect(texts).toContain("Régimen especial de los bienes usados.");
    expect(texts).toContain("Régimen especial de las agencias de viajes.");
    expect(texts).toContain("Facturación por el destinatario.");
    expect(new Set(LEGAL_MENTION_PRESETS.map((preset) => preset.id)).size).toBe(LEGAL_MENTION_PRESETS.length);
  });

  it("añade menciones sin repetirlas y las separa por renglones", () => {
    const once = appendLegalMention("", "Régimen especial de los bienes usados.");
    expect(once).toBe("Régimen especial de los bienes usados.");
    expect(appendLegalMention(once, "Régimen especial de los bienes usados.")).toBe(once);
    const twice = appendLegalMention(once, "Facturación por el destinatario.");
    expect(legalMentionLines(twice)).toEqual(["Régimen especial de los bienes usados.", "Facturación por el destinatario."]);
    expect(legalMentionLines(" \n ")).toEqual([]);
  });

  it("detecta bases sin IVA: líneas sin impuesto o al 0 %", () => {
    expect(hasUntaxedBase({ subtotal: 100, taxBuckets: [vat(21, 100)] })).toBe(false);
    expect(hasUntaxedBase({ subtotal: 150, taxBuckets: [vat(21, 100)] })).toBe(true);
    expect(hasUntaxedBase({ subtotal: 150, taxBuckets: [vat(21, 100), vat(0, 50)] })).toBe(true);
    expect(hasUntaxedBase({ subtotal: 100, taxBuckets: [vat(21, 100), { kind: "WITHHOLDING", operation: "SUBTRACT", rate: 15, baseAmount: 100, amount: 15 }] })).toBe(false);
  });

  it("imprime la causa de exención de las bases sin IVA de una factura nacional", () => {
    const totals = { subtotal: 150, taxBuckets: [vat(21, 100)] };
    const base = { vatTreatment: "DOMESTIC", commonVatTerritory: true, exemptionCode: null, legalMentions: null, totals };
    expect(untaxedBaseLegalNote(base)).toMatch(/art\. 20 de la Ley 37\/1992/);
    expect(untaxedBaseLegalNote({ ...base, exemptionCode: "E6" })).toBe("Incluye operaciones exentas de IVA.");
    // Si el usuario ya escribió su mención, manda la suya.
    expect(untaxedBaseLegalNote({ ...base, legalMentions: "Operación exenta (art. 20.Uno.9.º)." })).toBeNull();
    // Canarias (tipo cero), otros tratamientos y facturas con todo gravado: nada.
    expect(untaxedBaseLegalNote({ ...base, commonVatTerritory: false })).toBeNull();
    expect(untaxedBaseLegalNote({ ...base, vatTreatment: "EXEMPT" })).toBeNull();
    expect(untaxedBaseLegalNote({ ...base, totals: { subtotal: 100, taxBuckets: [vat(21, 100)] } })).toBeNull();
  });
});
