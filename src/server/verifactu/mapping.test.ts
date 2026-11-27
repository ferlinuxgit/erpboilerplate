import { describe, expect, it } from "vitest";

import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { buildBreakdown, mapInvoiceToAlta, verifactuTaxCodeFor } from "@/server/verifactu/mapping";

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

  it("uses the exemption or non-subject cause chosen on the invoice when it fits the treatment", () => {
    const lines = totals([{ description: "Servicio", quantity: 1, unitPrice: 200, taxes: [] }]);
    expect(buildBreakdown("EXEMPT", lines, "01", "E6").lines[0]).toMatchObject({ OperacionExenta: "E6" });
    expect(buildBreakdown("NOT_SUBJECT", lines, "01", "N1").lines[0]).toMatchObject({ CalificacionOperacion: "N1" });
    // Una causa que no corresponde al tratamiento se ignora.
    expect(buildBreakdown("NOT_SUBJECT", lines, "01", "E3").lines[0]).toMatchObject({ CalificacionOperacion: "N2" });
    expect(buildBreakdown("EXEMPT", lines, "01", "N1").lines[0]).toMatchObject({ OperacionExenta: "E1" });
  });

  it("declares a 0 % base as exempt instead of S1 with rate 0 (IVA / IPSI), keeping IGIC zero rate", () => {
    const mixed = { subtotal: 150, taxBuckets: [
      { name: "IVA 21", kind: "VAT", rate: 21, operation: "ADD" as const, baseAmount: 100, amount: 21 },
      { name: "IVA 0", kind: "VAT", rate: 0, operation: "ADD" as const, baseAmount: 50, amount: 0 },
    ] };
    const iva = buildBreakdown("DOMESTIC", mixed, "01", "E6");
    expect(iva.lines).toEqual([
      { Impuesto: "01", ClaveRegimen: "01", CalificacionOperacion: "S1", TipoImpositivo: "21.00", BaseImponibleOimporteNoSujeto: "100.00", CuotaRepercutida: "21.00" },
      { Impuesto: "01", ClaveRegimen: "01", OperacionExenta: "E6", BaseImponibleOimporteNoSujeto: "50.00" },
    ]);
    expect(iva.totalAmount).toBe("171.00");
    expect(buildBreakdown("DOMESTIC", mixed, "03").lines[1]).toMatchObject({ Impuesto: "03", CalificacionOperacion: "S1", TipoImpositivo: "0.00" });
  });

  it("carries the operation date only when given", () => {
    const base = { invoiceType: "INVOICE", rectificationReason: null, vatTreatment: "DOMESTIC" as const, description: "x", customer: null, totals: totals([{ description: "x", quantity: 1, unitPrice: 10, taxes: [vat21] }]) };
    expect(mapInvoiceToAlta({ ...base, operationDate: "28-08-2026" }).operationDate).toBe("28-08-2026");
    expect(mapInvoiceToAlta(base).operationDate).toBeNull();
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

describe("clase de documento y sustitutivas (validaciones AEAT v1.2.2, apdos. 5, 8 y 13)", () => {
  const invoiceTotals = totals([{ description: "Menú", quantity: 1, unitPrice: 100, taxes: [vat21] }]);
  const withNif = { name: "Cliente SL", taxId: "B87654321", countryCode: "ES" };
  const base = { invoiceType: "INVOICE", rectificationReason: null, vatTreatment: "DOMESTIC" as const, description: "Menú", totals: invoiceTotals };

  it("simplificada con datos del destinatario: F1 con destinatario y FacturaSimplificadaArt7273", () => {
    const content = mapInvoiceToAlta({ ...base, customer: withNif, documentClass: "SIMPLIFIED_QUALIFIED" });
    expect(content.invoiceTypeCode).toBe("F1");
    expect(content.recipient).toMatchObject({ taxId: "B87654321" });
    expect(content.simplifiedArt7273).toBe(true);
    expect(content.simplifiedOverLimit).toBe(false);
  });

  it("simplificada sin datos: F2 sin destinatario aunque el cliente tenga NIF", () => {
    const content = mapInvoiceToAlta({ ...base, customer: withNif, documentClass: "SIMPLIFIED" });
    expect(content.invoiceTypeCode).toBe("F2");
    expect(content.recipient).toBeNull();
    expect(content.simplifiedArt7273).toBe(false);
  });

  it("completa y facturas sin clase: como siempre", () => {
    expect(mapInvoiceToAlta({ ...base, customer: withNif, documentClass: "FULL" })).toMatchObject({ invoiceTypeCode: "F1", simplifiedArt7273: false, substitutedInvoices: null });
    expect(mapInvoiceToAlta({ ...base, customer: withNif }).invoiceTypeCode).toBe("F1");
    expect(mapInvoiceToAlta({ ...base, customer: null }).invoiceTypeCode).toBe("F2");
  });

  it("sustitutiva de simplificadas: F3 con FacturasSustituidas y destinatario", () => {
    const substituted = [{ issuerTaxId: "B12345678", invoiceNumber: "T-000007", invoiceIssueDate: "02-09-2026" }];
    const content = mapInvoiceToAlta({ ...base, customer: withNif, documentClass: "FULL", substituted });
    expect(content.invoiceTypeCode).toBe("F3");
    expect(content.substitutedInvoices).toEqual(substituted);
    expect(content.recipient).not.toBeNull();
    expect(content.rectificationKind).toBeNull();
    expect(content.rectifiedInvoices).toBeNull();
    expect(content.totalAmount).toBe("121.00");
  });

  it("rectificativa de una simplificada con destinatario: R1–R4 con la marca; de una simplificada sin registro previo: R5", () => {
    const creditTotals = totals([{ description: "Abono", quantity: -1, unitPrice: 100, taxes: [vat21] }], true);
    const original = { issuerTaxId: "B12345678", invoiceNumber: "T-000007", invoiceIssueDate: "02-09-2026", invoiceTypeCode: "F1" };
    const qualified = mapInvoiceToAlta({ invoiceType: "CREDIT_NOTE", rectificationReason: "R1", vatTreatment: "DOMESTIC", customer: withNif, totals: creditTotals, description: "x", original, documentClass: "SIMPLIFIED_QUALIFIED" });
    expect(qualified).toMatchObject({ invoiceTypeCode: "R1", simplifiedArt7273: true });
    const legacy = mapInvoiceToAlta({ invoiceType: "CREDIT_NOTE", rectificationReason: "R4", vatTreatment: "DOMESTIC", customer: withNif, totals: creditTotals, description: "x", original: { ...original, invoiceTypeCode: null }, documentClass: "SIMPLIFIED" });
    expect(legacy).toMatchObject({ invoiceTypeCode: "R5", recipient: null, simplifiedArt7273: false });
  });
});

describe("territorios con IGIC / IPSI", () => {
  const totals = { subtotal: 100, taxBuckets: [{ key: "ADD|VAT|7", name: "IGIC general 7%", kind: "VAT", rate: 7, operation: "ADD" as const, baseAmount: 100, amount: 7 }] };

  it("elige la clave del impuesto por el territorio del emisor", () => {
    expect(verifactuTaxCodeFor("ES")).toBe("01");
    expect(verifactuTaxCodeFor("ES-CN")).toBe("03");
    expect(verifactuTaxCodeFor("ES-CE")).toBe("02");
    expect(verifactuTaxCodeFor("ES-ML")).toBe("02");
  });

  it("IGIC conserva la clave de régimen; IPSI informa siempre una de las que admite la AEAT", () => {
    expect(buildBreakdown("DOMESTIC", totals, "03").lines[0]).toEqual({ Impuesto: "03", ClaveRegimen: "01", CalificacionOperacion: "S1", TipoImpositivo: "7.00", BaseImponibleOimporteNoSujeto: "100.00", CuotaRepercutida: "7.00" });
    const ipsi = buildBreakdown("DOMESTIC", totals, "02").lines[0];
    expect(ipsi).toMatchObject({ Impuesto: "02", CalificacionOperacion: "S1", ClaveRegimen: "01" });
    // Una exportación lleva 02 con IVA/IGIC; con IPSI esa clave no existe y va la de régimen general.
    expect(buildBreakdown("EXPORT", { subtotal: 50, taxBuckets: [] }, "02").lines[0]).toMatchObject({ Impuesto: "02", ClaveRegimen: "01" });
    expect(buildBreakdown("EXPORT", { subtotal: 50, taxBuckets: [] }, "03").lines[0]).toMatchObject({ Impuesto: "03", ClaveRegimen: "02", OperacionExenta: "E2" });
  });
});
