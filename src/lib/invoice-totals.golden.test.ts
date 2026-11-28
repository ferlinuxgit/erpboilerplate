import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import golden from "@/lib/__fixtures__/invoice-totals-golden.json";
import { goldenCases } from "@/lib/__fixtures__/invoice-totals-cases";
import { applyGlobalDiscount, calculateInvoiceTotals, type InvoiceTotals } from "@/lib/invoice-totals";

/**
 * Regresión del motor de totales. `invoice-totals-golden.json` guarda la huella del resultado de
 * 400 facturas generadas con semilla fija, calculada con el motor ANTES de añadir suplidos,
 * descuento global y anticipos. Una factura que no usa nada de eso debe dar exactamente lo mismo,
 * céntimo a céntimo, en líneas, desglose por tipo y totales.
 */

/** El resultado tal y como era antes: mismas claves y mismo orden. */
function legacyShape(totals: InvoiceTotals) {
  return {
    lines: totals.lines.map((line) => ({
      subtotal: line.subtotal,
      taxAmount: line.taxAmount,
      retentionAmount: line.retentionAmount,
      lineTotal: line.lineTotal,
      taxes: line.taxes,
    })),
    taxBuckets: totals.taxBuckets,
    subtotal: totals.subtotal,
    taxAmount: totals.taxAmount,
    retentionAmount: totals.retentionAmount,
    totalAmount: totals.totalAmount,
  };
}

const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);

describe("motor de totales: facturas sin suplidos, descuento global ni anticipos", () => {
  const cases = goldenCases();

  it("cubre los mismos casos que la referencia", () => {
    expect(cases).toHaveLength((golden as string[]).length);
  });

  it("da exactamente el mismo resultado que antes de los cambios", () => {
    const different: number[] = [];
    cases.forEach((entry, index) => {
      const totals = calculateInvoiceTotals(entry.lines, { allowNegative: entry.allowNegative });
      if (fingerprint(legacyShape(totals)) !== (golden as string[])[index]) different.push(index);
      expect(totals.disbursementAmount).toBe(0);
      expect(totals.lines.every((line) => line.disbursementAmount === undefined)).toBe(true);
    });
    expect(different).toEqual([]);
  });

  it("tampoco cambia con los indicadores nuevos explícitamente apagados", () => {
    const different: number[] = [];
    cases.forEach((entry, index) => {
      const lines = entry.lines.map((line) => ({ ...line, isDisbursement: false, isGlobalDiscount: false, advanceInvoiceId: null }));
      const totals = calculateInvoiceTotals(applyGlobalDiscount(lines, { pct: 0, amount: 0 }), { allowNegative: entry.allowNegative });
      if (fingerprint(legacyShape(totals)) !== (golden as string[])[index]) different.push(index);
    });
    expect(different).toEqual([]);
  });
});
