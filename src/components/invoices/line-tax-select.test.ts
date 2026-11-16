import { describe, expect, it } from "vitest";

import { lineTaxSelects, taxIdsFromSelects, type LineTaxSelectOption } from "@/components/invoices/line-tax-select";

const taxes: LineTaxSelectOption[] = [
  { id: "iva21", name: "IVA", rate: 21, kind: "VAT", operation: "ADD" },
  { id: "iva10", name: "IVA reducido 10%", rate: 10, kind: "VAT", operation: "ADD" },
  { id: "re52", name: "Recargo de equivalencia 5,2%", rate: 5.2, kind: "SURCHARGE", operation: "ADD" },
  { id: "irpf15", name: "IRPF", rate: 15, kind: "WITHHOLDING", operation: "SUBTRACT" },
  { id: "alq19", name: "Retención alquiler 19%", rate: 19, kind: "WITHHOLDING", operation: "SUBTRACT" },
];

describe("selectores de impuestos de la línea", () => {
  it("ofrece IVA (con recargo combinado) y retenciones por separado, sin repetir el porcentaje", () => {
    const { added, withheld, hasWithholding } = lineTaxSelects(taxes, ["iva21", "irpf15"]);
    expect(added.choices.map((choice) => choice.label)).toEqual(["Sin IVA", "IVA 21 %", "IVA 21 % + recargo 5,2 %", "IVA reducido 10%"]);
    expect(added.value).toBe("iva21");
    expect(withheld.choices.map((choice) => choice.label)).toEqual(["Sin retención", "IRPF 15 %", "Retención alquiler 19%"]);
    expect(withheld.value).toBe("irpf15");
    expect(hasWithholding).toBe(true);
  });

  it("reconoce IVA + recargo guardados y convierte la elección en la lista de impuestos", () => {
    const { added, withheld } = lineTaxSelects(taxes, ["re52", "iva21"]);
    expect(added.value).toBe("iva21,re52");
    expect(withheld.value).toBe("");
    expect(taxIdsFromSelects("iva21,re52", "irpf15")).toEqual(["iva21", "re52", "irpf15"]);
    expect(taxIdsFromSelects("", "")).toEqual([]);
  });

  it("conserva combinaciones guardadas que no están entre las opciones (archivados o dobles)", () => {
    const withArchived = [...taxes, { id: "old", name: "IVA antiguo", rate: 18, kind: "VAT", operation: "ADD" as const, isActive: false }];
    const { added } = lineTaxSelects(withArchived, ["old"]);
    expect(added.choices.at(-1)).toEqual({ value: "old", label: "IVA antiguo 18 % (archivado)" });
    expect(lineTaxSelects(withArchived, []).added.choices.some((choice) => choice.value === "old")).toBe(false);
    const twoVat = lineTaxSelects(taxes, ["iva10", "iva21"]).added;
    expect(twoVat.value).toBe("iva10,iva21");
    expect(twoVat.choices.at(-1)?.label).toBe("IVA 21 % + IVA reducido 10%");
  });
});
