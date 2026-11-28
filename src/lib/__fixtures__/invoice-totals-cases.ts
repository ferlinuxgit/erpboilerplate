import type { InvoiceCalculationLine, InvoiceCalculationTax } from "@/lib/invoice-totals";

/**
 * Casos deterministas para la prueba de regresión del motor de totales
 * (`invoice-totals.golden.test.ts`). El generador es un LCG con semilla fija: produce siempre las
 * mismas facturas, así que el fichero de resultados congelado antes de añadir suplidos, descuento
 * global y anticipos sigue valiendo como referencia.
 */

function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const VAT_RATES = [21, 10, 4, 5, 0, 7, 3];
const SURCHARGE: Record<number, number> = { 21: 5.2, 10: 1.4, 4: 0.5, 5: 0.62 };
const RETENTIONS = [15, 7, 19, 1];

export type GoldenCase = { lines: InvoiceCalculationLine[]; allowNegative: boolean };

export function goldenCases(count = 400): GoldenCase[] {
  const random = lcg(20261127);
  const pick = <T,>(values: T[]) => values[Math.floor(random() * values.length)]!;
  const cases: GoldenCase[] = [];
  for (let index = 0; index < count; index += 1) {
    const allowNegative = random() < 0.25;
    const lineCount = 1 + Math.floor(random() * 6);
    const lines: InvoiceCalculationLine[] = [];
    for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
      const quantity = (Math.round(random() * 20000) / 1000) * (allowNegative && random() < 0.5 ? -1 : 1);
      const unitPrice = (Math.round(random() * 500000) / 100) * (random() < 0.05 ? -1 : 1);
      const discountPct = random() < 0.3 ? Math.round(random() * 50000) / 1000 : random() < 0.1 ? undefined : 0;
      const description = random() < 0.04 ? "  " : `Concepto ${index}-${lineIndex}`;
      const mode = random();
      if (mode < 0.35) {
        // Línea antigua: tipo de IVA y retención en la propia línea.
        lines.push({ description, quantity, unitPrice, discountPct, taxRate: pick(VAT_RATES), retentionRate: random() < 0.3 ? pick(RETENTIONS) : 0 });
        continue;
      }
      const vat = pick(VAT_RATES);
      const taxes: InvoiceCalculationTax[] = [];
      if (random() < 0.92) taxes.push({ id: `vat-${vat}`, name: `IVA ${vat}%`, rate: vat, kind: "VAT", operation: "ADD" });
      if (SURCHARGE[vat] !== undefined && random() < 0.2) taxes.push({ id: `re-${vat}`, name: "Recargo", rate: SURCHARGE[vat]!, kind: "SURCHARGE", operation: "ADD" });
      if (random() < 0.25) {
        const retention = pick(RETENTIONS);
        taxes.push({ id: `irpf-${retention}`, name: `IRPF ${retention}%`, rate: retention, kind: "WITHHOLDING", operation: "SUBTRACT" });
      }
      lines.push({ description, quantity, unitPrice, discountPct, taxes });
    }
    cases.push({ lines, allowNegative });
  }
  return cases;
}
