import { describe, expect, it } from "vitest";

import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { buildBreakdown, mapInvoiceToAlta } from "@/server/verifactu/mapping";

const vat21 = { name: "IVA 21%", rate: 21, kind: "VAT", operation: "ADD" as const };
const re52 = { name: "RE 5,2%", rate: 5.2, kind: "SURCHARGE", operation: "ADD" as const };
const irpf15 = { name: "IRPF 15%", rate: 15, kind: "WITHHOLDING", operation: "SUBTRACT" as const };

function totals(lines: Parameters<typeof calculateInvoiceTotals>[0], allowNegative = false) {
  return calculateInvoiceTotals(lines, { allowNegative });
}

describe("VeriFactu mapping", () => {
  it("maps a domestic invoice with customer NIF to F1 and excludes withholdings from ImporteTotal", () => {
    const content = mapInvoiceToAlta({
      invoiceType: "INVOICE",
      rectificationReason: null,
      vatTreatment: "DOMESTIC",
      customer: { name: "Cliente SL", taxId: "B-12345678", countryCode: "ES" },
      totals: totals([{ description: "Consultoría", quantity: 1, unitPrice: 100, taxes: [vat21, irpf15] }]),
      description: "Consultoría",
    });
    expect(content.invoiceTypeCode).toBe("F1");
    expect(content.recipient).toEqual({ name: "Cliente SL", taxId: "B12345678", countryCode: "ES", idType: null });
    expect(content.breakdown).toEqual([
      { Impuesto: "01", ClaveRegimen: "01", CalificacionOperacion: "S1", TipoImpositivo: "21.00", BaseImponibleOimporteNoSujeto: "100.00", CuotaRepercutida: "21.00" },
    ]);
    expect(content.taxAmount).toBe("21.00");
    expect(content.totalAmount).toBe("121.00");
    expect(content.rectificationKind).toBeNull();
  });

  it("maps a customer without tax id to F2 (simplified) without recipient and flags amounts over 400 €", () => {
    const small = mapInvoiceToAlta({
      invoiceType: "INVOICE",
      rectificationReason: null,
      vatTreatment: "DOMESTIC",
      customer: { name: "Particular", taxId: null, countryCode: "ES" },
      totals: totals([{ description: "Ticket", quantity: 1, unitPrice: 10, taxes: [vat21] }]),
      description: "Ticket",
    });
    expect(small.invoiceTypeCode).toBe("F2");
    expect(small.recipient).toBeNull();
    expect(small.simplifiedOverLimit).toBe(false);

    const big = mapInvoiceToAlta({ ...{ invoiceType: "INVOICE", rectificationReason: null, vatTreatment: "DOMESTIC" as const, description: "x" }, customer: { name: "Particular", taxId: "", countryCode: "ES" }, totals: totals([{ description: "Obra", quantity: 1, unitPrice: 1000, taxes: [vat21] }]) });
    expect(big.simplifiedOverLimit).toBe(true);
  });

  it("includes recargo de equivalencia in the same breakdown line and in CuotaTotal", () => {
    const breakdown = buildBreakdown("DOMESTIC", totals([{ description: "Mercancía", quantity: 2, unitPrice: 50, taxes: [vat21, re52] }]));
    expect(breakdown.lines).toEqual([
      {
        Impuesto: "01",
        ClaveRegimen: "01",
        CalificacionOperacion: "S1",
        TipoImpositivo: "21.00",
        BaseImponibleOimporteNoSujeto: "100.00",
        CuotaRepercutida: "21.00",
        TipoRecargoEquivalencia: "5.20",
        CuotaRecargoEquivalencia: "5.20",
      },
    ]);
    expect(breakdown.taxAmount).toBe("26.20");
    expect(breakdown.totalAmount).toBe("126.20");
  });

  it("uses exemption and non-subject keys by VAT treatment", () => {
    const lines = totals([{ description: "Servicio", quantity: 1, unitPrice: 200, taxes: [] }]);
    expect(buildBreakdown("INTRA_EU", lines).lines[0]).toMatchObject({ OperacionExenta: "E5", ClaveRegimen: "01" });
    expect(buildBreakdown("EXPORT", lines).lines[0]).toMatchObject({ OperacionExenta: "E2", ClaveRegimen: "02" });
    expect(buildBreakdown("EXEMPT", lines).lines[0]).toMatchObject({ OperacionExenta: "E1" });
    expect(buildBreakdown("REVERSE_CHARGE", lines).lines[0]).toMatchObject({ CalificacionOperacion: "S2", CuotaRepercutida: "0.00" });
    expect(buildBreakdown("NOT_SUBJECT", lines).lines[0]).toMatchObject({ CalificacionOperacion: "N2" });
    expect(buildBreakdown("INTRA_EU", lines).totalAmount).toBe("200.00");
  });

  it("identifies EU customers with NIF-IVA (IDType 02) and others with IDType 04", () => {
    const base = { invoiceType: "INVOICE", rectificationReason: null, vatTreatment: "INTRA_EU" as const, description: "x", totals: totals([{ description: "x", quantity: 1, unitPrice: 10, taxes: [] }]) };
    expect(mapInvoiceToAlta({ ...base, customer: { name: "GmbH", taxId: "DE123456789", countryCode: "DE" } }).recipient).toMatchObject({ idType: "02", countryCode: "DE" });
    expect(mapInvoiceToAlta({ ...base, vatTreatment: "EXPORT", customer: { name: "Inc", taxId: "12-3456789", countryCode: "US" } }).recipient).toMatchObject({ idType: "04" });
  });

  it("maps credit notes to R1–R4 by reason, R5 for simplified originals, with rectified invoice reference", () => {
    const creditTotals = totals([{ description: "Abono", quantity: -1, unitPrice: 100, taxes: [vat21] }], true);
    const original = { issuerTaxId: "B12345678", invoiceNumber: "FA000001", invoiceIssueDate: "01-09-2026", invoiceTypeCode: "F1" };
    const r1 = mapInvoiceToAlta({ invoiceType: "CREDIT_NOTE", rectificationReason: "R1", vatTreatment: "DOMESTIC", customer: { name: "Cliente", taxId: "B87654321", countryCode: "ES" }, totals: creditTotals, description: "Error", original });
    expect(r1.invoiceTypeCode).toBe("R1");
    expect(r1.rectificationKind).toBe("I");
    expect(r1.rectifiedInvoices).toEqual([{ issuerTaxId: "B12345678", invoiceNumber: "FA000001", invoiceIssueDate: "01-09-2026" }]);
    expect(r1.totalAmount).toBe("-121.00");
    expect(r1.taxAmount).toBe("-21.00");

    const r5 = mapInvoiceToAlta({ invoiceType: "CREDIT_NOTE", rectificationReason: "R4", vatTreatment: "DOMESTIC", customer: { name: "Particular", taxId: null, countryCode: "ES" }, totals: creditTotals, description: "Devolución", original: { ...original, invoiceTypeCode: "F2" } });
    expect(r5.invoiceTypeCode).toBe("R5");
    expect(r5.recipient).toBeNull();

    const r5WithoutSimplified = mapInvoiceToAlta({ invoiceType: "CREDIT_NOTE", rectificationReason: "R5", vatTreatment: "DOMESTIC", customer: { name: "Cliente", taxId: "B87654321", countryCode: "ES" }, totals: creditTotals, description: "x", original });
    expect(r5WithoutSimplified.invoiceTypeCode).toBe("R4");
  });
});
