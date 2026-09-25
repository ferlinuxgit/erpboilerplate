import { describe, expect, it } from "vitest";

import type { RecurringTemplateLineTax } from "@/db/schema";
import {
  reconcileTemplateLineTaxes,
  resolveRecurringLineTaxes,
  summarizeLineTaxes,
  templateTaxesForTotals,
  templateTaxesFromInvoiceLine,
} from "@/server/recurring/taxes";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";

const vat21: RecurringTemplateLineTax = { taxId: "iva21", name: "IVA 21 %", rate: 21, kind: "VAT", operation: "ADD" };
const re52: RecurringTemplateLineTax = { taxId: "re52", name: "Recargo 5,2 %", rate: 5.2, kind: "SURCHARGE", operation: "ADD" };
const irpf15: RecurringTemplateLineTax = { taxId: "irpf15", name: "IRPF 15 %", rate: 15, kind: "WITHHOLDING", operation: "SUBTRACT" };
const companyTaxes = [
  { id: "iva21", name: "IVA 21 %", rate: "21.000", kind: "VAT", operation: "ADD", isDefault: true, isActive: true },
  { id: "iva10", name: "IVA 10 %", rate: "10.000", kind: "VAT", operation: "ADD", isDefault: false, isActive: true },
  { id: "re52", name: "Recargo 5,2 %", rate: "5.200", kind: "SURCHARGE", operation: "ADD", isDefault: false, isActive: true },
  { id: "re14", name: "Recargo 1,4 %", rate: "1.400", kind: "SURCHARGE", operation: "ADD", isDefault: false, isActive: true },
  { id: "irpf15", name: "IRPF 15 %", rate: "15.000", kind: "WITHHOLDING", operation: "SUBTRACT", isDefault: false, isActive: true },
];

describe("impuestos de facturas recurrentes", () => {
  it("copia los impuestos de la línea de la factura de origen y resume IVA y retención", () => {
    const taxes = templateTaxesFromInvoiceLine([
      { id: "iva21", name: "IVA 21 %", rate: 21, kind: "VAT", operation: "ADD" },
      { id: "re52", name: "Recargo 5,2 %", rate: 5.2, kind: "SURCHARGE", operation: "ADD" },
      { id: "irpf15", name: "IRPF 15 %", rate: 15, kind: "WITHHOLDING", operation: "SUBTRACT" },
    ]);
    expect(taxes).toEqual([vat21, re52, irpf15]);
    expect(summarizeLineTaxes(taxes!)).toEqual({ taxRate: 21, retentionRate: 15 });
    expect(templateTaxesFromInvoiceLine(undefined)).toBeNull();
  });

  it("conserva los impuestos mientras cuadran con el IVA y la retención de la línea", () => {
    expect(reconcileTemplateLineTaxes({ taxRate: 21, retentionRate: 15, taxes: [vat21, re52, irpf15] })).toEqual([vat21, re52, irpf15]);
  });

  it("si cambia el IVA, sustituye IVA y recargo (el recargo sigue al nuevo IVA) y mantiene la retención", () => {
    const result = reconcileTemplateLineTaxes({ taxRate: 10, retentionRate: 15, taxes: [vat21, re52, irpf15] });
    expect(result?.map((tax) => [tax.kind, tax.rate])).toEqual([["WITHHOLDING", 15], ["VAT", 10], ["SURCHARGE", 1.4]]);
  });

  it("si cambia la retención, sustituye solo la retención", () => {
    const result = reconcileTemplateLineTaxes({ taxRate: 21, retentionRate: 0, taxes: [vat21, irpf15] });
    expect(result).toEqual([vat21]);
  });

  it("genera con los impuestos de la empresa enlazados por id", () => {
    const taxes = resolveRecurringLineTaxes({ taxRate: 21, retentionRate: 15, taxes: [vat21, re52, irpf15] }, companyTaxes);
    expect(taxes.map((tax) => tax.id)).toEqual(["iva21", "re52", "irpf15"]);
  });

  it("si un impuesto guardado ya no existe, conserva su tipo y nombre sin enlazarlo", () => {
    const taxes = resolveRecurringLineTaxes({ taxRate: 21, retentionRate: 0, taxes: [vat21, { ...re52, taxId: "deleted" }] }, companyTaxes.filter((tax) => tax.id !== "re52"));
    expect(taxes).toEqual([
      { id: "iva21", name: "IVA 21 %", rate: 21, kind: "VAT", operation: "ADD" },
      { id: null, name: "Recargo 5,2 %", rate: 5.2, kind: "SURCHARGE", operation: "ADD" },
    ]);
  });

  it("plantillas antiguas: IVA + recargo del cliente + IRPF", () => {
    expect(resolveRecurringLineTaxes({ taxRate: 10, retentionRate: 15 }, companyTaxes, { equivalenceSurcharge: true }).map((tax) => tax.id)).toEqual(["iva10", "re14", "irpf15"]);
    expect(resolveRecurringLineTaxes({ taxRate: 10, retentionRate: 0 }, companyTaxes, { equivalenceSurcharge: false }).map((tax) => tax.id)).toEqual(["iva10"]);
  });

  it("el importe estimado incluye el recargo copiado", () => {
    const line = { description: "Género", quantity: 1, unitPrice: 100, taxRate: 21, retentionRate: 0, taxes: [vat21, re52] };
    expect(calculateInvoiceTotals([{ ...line, taxes: templateTaxesForTotals(line) }]).totalAmount).toBe(126.2);
  });
});
