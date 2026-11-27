import { describe, expect, it } from "vitest";

import { EInvoiceError } from "@/server/einvoice/model";
import { baseInvoice } from "@/server/einvoice/test-fixtures";
import { buildUblXml, UBL_CUSTOMIZATION_ID, ublProblems } from "@/server/einvoice/ubl";

function first(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?: [^>]*)?>(.*?)</${tag}>`, "s").exec(xml);
  return match ? match[1] : null;
}

function all(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}(?: [^>]*)?>(.*?)</${tag}>`, "gs"))].map((match) => match[1]);
}

const cents = (value: string | null) => Math.round(Number(value) * 100);

describe("UBL 2.1 (núcleo EN 16931:2017)", () => {
  const { xml, fileName } = buildUblXml(baseInvoice());

  it("cabecera: espacios de nombres, especificación, número, fechas y tipo", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">')).toBe(true);
    expect(first(xml, "cbc:CustomizationID")).toBe(UBL_CUSTOMIZATION_ID);
    // BT-1: el número completo, tal y como se emitió (el código único del art. 7.5 del RD 238/2026 lo incluye).
    expect(first(xml, "cbc:ID")).toBe("F2026-000012");
    expect(first(xml, "cbc:IssueDate")).toBe("2026-11-20");
    expect(first(xml, "cbc:DueDate")).toBe("2026-12-20");
    expect(first(xml, "cbc:InvoiceTypeCode")).toBe("380");
    expect(first(xml, "cbc:DocumentCurrencyCode")).toBe("EUR");
    expect(fileName).toBe("F2026-000012-ubl.xml");
    expect(xml).not.toMatch(/>\s+</);
  });

  it("partes con NIF-IVA con prefijo de país y domicilio", () => {
    const supplier = first(xml, "cac:AccountingSupplierParty")!;
    expect(first(first(supplier, "cac:PartyTaxScheme")!, "cbc:CompanyID")).toBe("ESB12345674");
    expect(first(supplier, "cbc:RegistrationName")).toBe("Talleres Norte, S.L.");
    expect(first(first(supplier, "cac:PartyName")!, "cbc:Name")).toBe("Talleres Norte");
    expect(first(supplier, "cbc:IdentificationCode")).toBe("ES");
    const customer = first(xml, "cac:AccountingCustomerParty")!;
    expect(first(first(customer, "cac:PartyTaxScheme")!, "cbc:CompanyID")).toBe("ESA58818501");
    expect(first(customer, "cbc:PostalZone")).toBe("46021");
  });

  it("totales: reglas BR-CO-10, 13, 14 y 15 del núcleo y total guardado", () => {
    const totals = first(xml, "cac:LegalMonetaryTotal")!;
    const lineSum = all(xml, "cac:InvoiceLine").reduce((sum, line) => sum + cents(first(line, "cbc:LineExtensionAmount")), 0);
    expect(cents(first(totals, "cbc:LineExtensionAmount"))).toBe(lineSum);
    expect(first(totals, "cbc:TaxExclusiveAmount")).toBe("369.97");
    const taxTotal = first(xml, "cac:TaxTotal")!;
    const subtotals = all(taxTotal, "cac:TaxSubtotal");
    expect(subtotals).toHaveLength(2);
    expect(cents(first(taxTotal, "cbc:TaxAmount"))).toBe(subtotals.reduce((sum, subtotal) => sum + cents(first(subtotal, "cbc:TaxAmount")), 0));
    expect(first(taxTotal, "cbc:TaxAmount")).toBe("70.89");
    expect(cents(first(totals, "cbc:TaxInclusiveAmount"))).toBe(36997 + 7089);
    expect(first(totals, "cbc:PayableAmount")).toBe("440.86");
    expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">440.86</cbc:PayableAmount>');
  });

  it("desglose por categoría S y tipo; líneas con cantidad, precio, descuento y categoría", () => {
    const subtotals = all(first(xml, "cac:TaxTotal")!, "cac:TaxSubtotal");
    expect(first(subtotals[0], "cbc:TaxableAmount")).toBe("329.97");
    expect(first(subtotals[0], "cbc:TaxAmount")).toBe("69.29");
    expect(first(first(subtotals[0], "cac:TaxCategory")!, "cbc:ID")).toBe("S");
    expect(first(subtotals[0], "cbc:Percent")).toBe("21");
    expect(first(first(subtotals[0], "cac:TaxScheme")!, "cbc:ID")).toBe("VAT");
    const lines = all(xml, "cac:InvoiceLine");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('<cbc:InvoicedQuantity unitCode="C62">2</cbc:InvoicedQuantity>');
    expect(first(lines[0], "cbc:LineExtensionAmount")).toBe("270.00");
    expect(first(first(lines[0], "cac:AllowanceCharge")!, "cbc:ChargeIndicator")).toBe("false");
    expect(first(first(lines[0], "cac:AllowanceCharge")!, "cbc:Amount")).toBe("30.00");
    expect(first(lines[0], "cbc:PriceAmount")).toBe("150.00");
    expect(first(lines[1], "cbc:Name")).toBe("Aceite &lt;sintético&gt; &amp; filtros");
    expect(lines[1]).not.toContain("cac:AllowanceCharge");
  });

  it("medio de pago por transferencia con IBAN y QR de VERI*FACTU como referencia", () => {
    expect(first(xml, "cbc:PaymentMeansCode")).toBe("30");
    expect(first(first(xml, "cac:PayeeFinancialAccount")!, "cbc:ID")).toBe("ES9121000418450200051332");
    const reference = first(xml, "cac:AdditionalDocumentReference")!;
    expect(first(reference, "cbc:ID")).toBe("QR");
    expect(first(reference, "cbc:DocumentDescription")).toBe("VERIFACTU");
    expect(first(reference, "cbc:URI")).toContain("ValidarQR?nif=B12345674&amp;numserie=");
  });

  it("rectificativa: tipo 384, importes por diferencias y referencia a la factura original", () => {
    const credit = buildUblXml(baseInvoice({
      number: "R2026-000003",
      isCreditNote: true,
      lines: [{ description: "Devolución", quantity: 1, unitPrice: -40, discountPct: 10, taxes: [{ rate: 4, kind: "VAT", operation: "ADD" }] }],
      storedTotal: -37.44,
      corrective: { originalNumber: "F2026-000012", originalIssueDate: "2026-11-20", reason: "R4", type: "DIFFERENCES", description: "Devolución de mercancía" },
    })).xml;
    expect(first(credit, "cbc:InvoiceTypeCode")).toBe("384");
    const reference = first(credit, "cac:InvoiceDocumentReference")!;
    expect(first(reference, "cbc:ID")).toBe("F2026-000012");
    expect(first(reference, "cbc:IssueDate")).toBe("2026-11-20");
    const line = first(credit, "cac:InvoiceLine")!;
    // El precio nunca es negativo (BR-27): el signo pasa a la cantidad.
    expect(line).toContain('<cbc:InvoicedQuantity unitCode="C62">-1</cbc:InvoicedQuantity>');
    expect(first(line, "cbc:PriceAmount")).toBe("40.00");
    expect(first(line, "cbc:LineExtensionAmount")).toBe("-36.00");
    expect(first(first(line, "cac:AllowanceCharge")!, "cbc:ChargeIndicator")).toBe("true");
    expect(first(first(line, "cac:AllowanceCharge")!, "cbc:Amount")).toBe("4.00");
    expect(first(credit, "cbc:PayableAmount")).toBe("-37.44");
    expect(credit).not.toContain("cbc:DueDate");
    expect(credit).not.toContain("cac:PaymentMeans");
    expect(first(credit, "cbc:Note")).toContain("Rectificativa R4 por diferencias: Devolución de mercancía");
  });

  it("categorías sin cuota: exenta, intracomunitaria, exportación, inversión y no sujeta", () => {
    const line = { description: "Servicio", quantity: 1, unitPrice: 100, taxes: [] };
    const category = (vatTreatment: string, literal: string) => {
      const subtotal = first(buildUblXml(baseInvoice({ lines: [line], storedTotal: 100, vatTreatment, legalLiterals: [literal] })).xml, "cac:TaxSubtotal")!;
      return [first(first(subtotal, "cac:TaxCategory")!, "cbc:ID"), first(subtotal, "cbc:TaxExemptionReasonCode"), first(subtotal, "cbc:TaxExemptionReason")];
    };
    expect(category("EXEMPT", "Operación exenta de IVA (art. 20 Ley 37/1992 del IVA).")).toEqual(["E", null, "Operación exenta de IVA (art. 20 Ley 37/1992 del IVA)."]);
    expect(category("INTRA_EU", "Entrega intracomunitaria exenta.")).toEqual(["K", "VATEX-EU-IC", "Entrega intracomunitaria exenta."]);
    expect(category("EXPORT", "Exportación exenta.")).toEqual(["G", "VATEX-EU-G", "Exportación exenta."]);
    expect(category("REVERSE_CHARGE", "Inversión del sujeto pasivo.")).toEqual(["AE", "VATEX-EU-AE", "Inversión del sujeto pasivo."]);
    expect(category("INTRA_EU_SERVICES", "Inversión del sujeto pasivo.")).toEqual(["AE", "VATEX-EU-AE", "Inversión del sujeto pasivo."]);
    expect(category("NOT_SUBJECT", "Operación no sujeta.")).toEqual(["O", "VATEX-EU-O", "Operación no sujeta."]);
  });

  it("IGIC usa la categoría L", () => {
    const igic = buildUblXml(baseInvoice({ issuerTerritory: "ES-CN", lines: [{ description: "Servicio", quantity: 1, unitPrice: 100, taxes: [{ rate: 7, kind: "VAT", operation: "ADD" }] }], storedTotal: 107 })).xml;
    expect(first(first(igic, "cac:TaxCategory")!, "cbc:ID")).toBe("L");
  });

  it("retención: WithholdingTaxTotal, restada del importe a pagar y con aviso", () => {
    const { xml: withheld, warnings } = buildUblXml(baseInvoice({
      lines: [{ description: "Honorarios", quantity: 1, unitPrice: 1000, taxes: [{ rate: 21, kind: "VAT", operation: "ADD" }, { rate: 15, kind: "WITHHOLDING", operation: "SUBTRACT" }] }],
      storedTotal: 1060,
    }));
    const block = first(withheld, "cac:WithholdingTaxTotal")!;
    expect(first(block, "cbc:TaxAmount")).toBe("150.00");
    expect(first(block, "cbc:Percent")).toBe("15");
    expect(first(first(block, "cac:TaxScheme")!, "cbc:ID")).toBe("WTH");
    expect(first(withheld, "cbc:TaxInclusiveAmount")).toBe("1210.00");
    expect(first(withheld, "cbc:PayableAmount")).toBe("1060.00");
    expect(warnings.some((warning) => warning.includes("retención"))).toBe(true);
  });

  it("no genera lo que el núcleo no sabe expresar (recargo de equivalencia) ni datos incompletos", () => {
    const surcharge = baseInvoice({
      lines: [{ description: "Género", quantity: 10, unitPrice: 12.35, taxes: [{ rate: 21, kind: "VAT", operation: "ADD" }, { rate: 5.2, kind: "SURCHARGE", operation: "ADD" }] }],
      storedTotal: 155.86,
    });
    expect(() => buildUblXml(surcharge)).toThrow(EInvoiceError);
    expect(ublProblems(surcharge)[0]).toContain("recargo de equivalencia");
    expect(ublProblems(baseInvoice({ customer: { ...baseInvoice().customer, taxId: null } }))[0]).toContain("NIF del cliente");
    expect(ublProblems(baseInvoice())).toEqual([]);
  });
});
