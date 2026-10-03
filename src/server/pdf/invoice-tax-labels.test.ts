import { describe, expect, it } from "vitest";

import { formatRate, lineTaxColumns, taxTotalLabel, taxTotalRows } from "@/server/pdf/invoice-tax-labels";

const vat = { name: "IVA", kind: "VAT", rate: 21, operation: "ADD" as const };
const irpf = { name: "Retencion IRPF 15%", kind: "WITHHOLDING", rate: 15, operation: "SUBTRACT" as const };

describe("impuestos en el PDF de la factura", () => {
  it("formatea el tipo en es-ES", () => {
    expect(formatRate(21)).toBe("21 %");
    expect(formatRate(5.2)).toBe("5,2 %");
  });

  it("etiqueta cada impuesto por su tipo, no por el nombre que le puso el usuario", () => {
    expect(taxTotalLabel(vat)).toBe("IVA 21 %");
    expect(taxTotalLabel(irpf)).toBe("Retención IRPF 15 %");
    expect(taxTotalLabel({ name: "Retencion alquiler 19%", kind: "WITHHOLDING", rate: 19, operation: "SUBTRACT" })).toBe("Retención alquiler 19 %");
    expect(taxTotalLabel({ name: "Recargo", kind: "SURCHARGE", rate: 5.2, operation: "ADD" })).toBe("Recargo de equivalencia 5,2 %");
  });

  it("columnas de la línea: IVA (con recargo) e IRPF", () => {
    expect(lineTaxColumns([vat, irpf])).toEqual({ vat: "21 %", withholding: "15 %", hasWithholding: true });
    expect(lineTaxColumns([vat, { name: "RE", kind: "SURCHARGE", rate: 5.2, operation: "ADD" }])).toMatchObject({ vat: "21 %\nRE 5,2 %", withholding: "—" });
    expect(lineTaxColumns([])).toEqual({ vat: "—", withholding: "—", hasWithholding: false });
  });

  it("totales: IVA y recargos primero, retenciones al final, con su base", () => {
    const money = (value: number) => `${value.toFixed(2)} €`;
    expect(taxTotalRows([
      { ...irpf, baseAmount: 550, amount: 82.5 },
      { ...vat, baseAmount: 550, amount: 115.5 },
    ], money)).toEqual([
      { label: "IVA 21 %", base: "550.00 €", amount: "115.50 €", operation: "ADD" },
      { label: "Retención IRPF 15 %", base: "550.00 €", amount: "82.50 €", operation: "SUBTRACT" },
    ]);
  });
});
