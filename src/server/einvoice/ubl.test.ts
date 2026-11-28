import { describe, expect, it } from "vitest";

import { EInvoiceError } from "@/server/einvoice/model";
import { baseInvoice } from "@/server/einvoice/test-fixtures";
import { buildUblXml, UBL_CUSTOMIZATION_ID, UBL_SPFE_CUSTOMIZATION_ID, UBL_SPFE_PROFILE_ID, ublProblems } from "@/server/einvoice/ubl";

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

describe("UBL 2.5, perfil de la solución pública de la AEAT (anexo I de la Orden HAC/1028/2026)", () => {
  const { xml, fileName, warnings } = buildUblXml(baseInvoice(), "SPFE");

  it("cabecera como en el ejemplo oficial factura.xml: especificación, perfil, copia y QR en UUID", () => {
    expect(first(xml, "cbc:CustomizationID")).toBe(UBL_SPFE_CUSTOMIZATION_ID);
    expect(first(xml, "cbc:ProfileID")).toBe(UBL_SPFE_PROFILE_ID);
    expect(first(xml, "cbc:CopyIndicator")).toBe("false");
    // El orden de UBL: ID, CopyIndicator, IssueDate.
    expect(xml.indexOf("<cbc:CopyIndicator>")).toBeGreaterThan(xml.indexOf("<cbc:ID>"));
    expect(xml.indexOf("<cbc:CopyIndicator>")).toBeLessThan(xml.indexOf("<cbc:IssueDate>"));
    const reference = first(xml, "cac:AdditionalDocumentReference")!;
    expect(first(reference, "cbc:ID")).toBe("urn:aeat:names:specification:schema:QR");
    expect(first(reference, "cbc:UUID")).toContain("ValidarQR?nif=B12345674");
    expect(xml).not.toContain("cbc:Note>");
    expect(fileName).toBe("F2026-000012-ubl-aeat.xml");
    expect(warnings).toEqual([]);
  });

  it("partes con NIF español en el esquema «LOC»/«FC» repetido en la entidad legal", () => {
    const supplier = first(xml, "cac:AccountingSupplierParty")!;
    expect(supplier).toContain('<cbc:CompanyID schemeID="FC">B12345674</cbc:CompanyID>');
    expect(first(first(supplier, "cac:TaxScheme")!, "cbc:ID")).toBe("LOC");
    expect(first(supplier, "cac:PartyLegalEntity")).toContain("<cbc:CompanyID>B12345674</cbc:CompanyID>");
    expect(first(first(supplier, "cac:Contact")!, "cbc:Name")).toBe("Talleres Norte, S.L.");
    const customer = first(xml, "cac:AccountingCustomerParty")!;
    expect(customer).toContain('<cbc:CompanyID schemeID="FC">A58818501</cbc:CompanyID>');
  });

  it("clave de régimen 01 en cada línea y medio de pago con IBAN y esquema", () => {
    const lines = all(xml, "cac:InvoiceLine");
    for (const line of lines) {
      const property = first(line, "cac:AdditionalItemProperty")!;
      expect(first(property, "cbc:Name")).toBe("urn:aeat:names:specification:schema:lin:REGI");
      expect(first(property, "cbc:Value")).toBe("01");
      expect(first(property, "cbc:ValueQualifier")).toBe("IVA");
    }
    expect(xml).toContain('<cbc:ID schemeID="IBAN">ES9121000418450200051332</cbc:ID>');
  });

  it("criterio de caja: clave de régimen 07 y mención en anotación «REG»", () => {
    const cash = buildUblXml(baseInvoice({ cashAccounting: true, legalLiterals: ["Régimen especial del criterio de caja."] }), "SPFE").xml;
    expect(first(first(cash, "cac:AdditionalItemProperty")!, "cbc:Value")).toBe("07");
    const annotation = first(cash, "cac:Annotation")!;
    expect(first(annotation, "cbc:SubjectCode")).toBe("REG");
    expect(first(annotation, "cbc:AnnotationContent")).toBe("Régimen especial del criterio de caja.");
  });

  it("recargo de equivalencia: categoría «N» con dos desgloses de la misma base", () => {
    const { xml: surcharge } = buildUblXml(baseInvoice({
      lines: [{ description: "Género", quantity: 10, unitPrice: 12.35, taxes: [{ rate: 21, kind: "VAT", operation: "ADD" }, { rate: 5.2, kind: "SURCHARGE", operation: "ADD" }] }],
      storedTotal: 155.86,
    }), "SPFE");
    const subtotals = all(first(surcharge, "cac:TaxTotal")!, "cac:TaxSubtotal");
    expect(subtotals).toHaveLength(2);
    expect(subtotals.map((subtotal) => [first(first(subtotal, "cac:TaxCategory")!, "cbc:ID"), first(subtotal, "cbc:Percent"), first(subtotal, "cbc:TaxableAmount"), first(subtotal, "cbc:TaxAmount")]))
      .toEqual([["N", "21", "123.50", "25.94"], ["N", "5.2", "123.50", "6.42"]]);
    expect(first(surcharge, "cbc:PayableAmount")).toBe("155.86");
    expect(first(first(surcharge, "cac:ClassifiedTaxCategory")!, "cbc:ID")).toBe("N");
  });

  it("recargo de equivalencia: rechaza mezclar líneas y tipos que no corresponden", () => {
    const mixed = baseInvoice({
      lines: [
        { description: "Género", quantity: 1, unitPrice: 100, taxes: [{ rate: 21, kind: "VAT", operation: "ADD" }, { rate: 5.2, kind: "SURCHARGE", operation: "ADD" }] },
        { description: "Servicio", quantity: 1, unitPrice: 100, taxes: [{ rate: 21, kind: "VAT", operation: "ADD" }] },
      ],
      storedTotal: 347.2,
    });
    expect(ublProblems(mixed, "SPFE").join(" ")).toContain("BR-ES-IVA-CR-17");
    const wrongRate = baseInvoice({ lines: [{ description: "Género", quantity: 1, unitPrice: 100, taxes: [{ rate: 10, kind: "VAT", operation: "ADD" }, { rate: 5.2, kind: "SURCHARGE", operation: "ADD" }] }], storedTotal: 115.2 });
    expect(ublProblems(wrongRate, "SPFE").join(" ")).toContain("BR-ES-N-5");
  });

  it("retención: WithholdingTaxTotal con concepto y línea «RETE» en negativo (BR-CO-16)", () => {
    const { xml: withheld, warnings: withheldWarnings } = buildUblXml(baseInvoice({
      lines: [{ description: "Honorarios", quantity: 1, unitPrice: 1000, taxes: [{ rate: 21, kind: "VAT", operation: "ADD" }, { name: "IRPF profesionales", rate: 15, kind: "WITHHOLDING", operation: "SUBTRACT" }] }],
      storedTotal: 1060,
    }), "SPFE");
    const block = first(withheld, "cac:WithholdingTaxTotal")!;
    expect(first(block, "cbc:TaxAmount")).toBe("150.00");
    expect(first(block, "cbc:TaxTypeCode")).toBe("01");
    const collection = first(withheld, "cac:CollectionInvoiceLine")!;
    expect(first(collection, "cbc:ID")).toBe("urn:aeat:names:specification:schema:add:RETE");
    expect(first(collection, "cbc:TaxInclusiveLineExtensionAmount")).toBe("-150.00");
    // A pagar = total con IVA + BT-179 (negativo).
    expect(cents(first(withheld, "cbc:TaxInclusiveAmount")) + cents(first(collection, "cbc:TaxInclusiveLineExtensionAmount"))).toBe(cents(first(withheld, "cbc:PayableAmount")));
    expect(withheldWarnings.join(" ")).toContain("lista L5");
  });

  it("rectificativa por diferencias: tipo R1–R4 y modalidad «I»", () => {
    const credit = buildUblXml(baseInvoice({
      number: "R2026-000003",
      isCreditNote: true,
      lines: [{ description: "Devolución", quantity: 1, unitPrice: -40, taxes: [{ rate: 21, kind: "VAT", operation: "ADD" }] }],
      storedTotal: -48.4,
      corrective: { originalNumber: "F2026-000012", originalIssueDate: "2026-11-20", reason: "R1", type: "DIFFERENCES", description: "Error en el precio" },
    }), "SPFE").xml;
    expect(first(credit, "cbc:InvoiceTypeCode")).toBe("384");
    const references = all(credit, "cac:AdditionalDocumentReference");
    const tipo = references.find((reference) => first(reference, "cbc:ID") === "urn:aeat:names:specification:schema:RECT:TIPO")!;
    expect(first(tipo, "cbc:DocumentTypeCode")).toBe("R1");
    const modalidad = references.find((reference) => first(reference, "cbc:ID") === "urn:aeat:names:specification:schema:RECT:MODALIDAD")!;
    expect(first(modalidad, "cbc:DocumentTypeCode")).toBe("I");
    expect(credit).not.toContain("RECT:IMPORTES");
    expect(first(first(credit, "cac:InvoiceDocumentReference")!, "cbc:ID")).toBe("F2026-000012");
    expect(credit).not.toContain("cac:PaymentMeans");
  });

  it("rectificativa por sustitución: exige y emite base y cuota rectificadas", () => {
    const corrective = { originalNumber: "F2026-000012", originalIssueDate: "2026-11-20", reason: "R1", type: "SUBSTITUTION", description: null };
    const withoutAmounts = baseInvoice({ isCreditNote: true, corrective });
    expect(ublProblems(withoutAmounts, "SPFE").join(" ")).toContain("SPFE-CORE-52");
    const credit = buildUblXml(baseInvoice({ isCreditNote: true, corrective: { ...corrective, originalTaxableBase: 369.97, originalTaxAmount: 70.89 } }), "SPFE").xml;
    const amounts = all(credit, "cac:AdditionalDocumentReference").filter((reference) => first(reference, "cbc:ID") === "urn:aeat:names:specification:schema:RECT:IMPORTES");
    expect(amounts.map((reference) => [first(reference, "cbc:DocumentTypeCode"), first(reference, "cbc:DocumentDescription")])).toEqual([["Base", "369.97"], ["Cuota", "70.89"]]);
    expect(ublProblems(baseInvoice({ isCreditNote: true, corrective: { ...corrective, reason: "R5" } }), "SPFE").join(" ")).toContain("R1 a R4");
  });

  it("solo NIF español, domicilio completo y sin entregas intracomunitarias", () => {
    const foreign = baseInvoice({ customer: { name: "Kunde GmbH", taxId: "DE123456789", address: "Hauptstraße 1", postalCode: "10115", city: "Berlin", province: "Berlin", countryCode: "DE" }, vatTreatment: "INTRA_EU", lines: [{ description: "Pieza", quantity: 1, unitPrice: 100, taxes: [] }], storedTotal: 100 });
    const problems = ublProblems(foreign, "SPFE").join(" ");
    expect(problems).toContain("NIF español");
    expect(problems).toContain("intracomunitarias");
    expect(ublProblems(baseInvoice({ customer: { ...baseInvoice().customer, province: null } }), "SPFE").join(" ")).toContain("provincia del cliente");
    expect(ublProblems(baseInvoice(), "SPFE")).toEqual([]);
  });

  it("exenta: categoría «E» con el texto pero sin código, y aviso", () => {
    const { xml: exempt, warnings: exemptWarnings } = buildUblXml(baseInvoice({ lines: [{ description: "Formación", quantity: 1, unitPrice: 100, taxes: [] }], storedTotal: 100, vatTreatment: "EXEMPT", legalLiterals: ["Operación exenta de IVA (art. 20 Ley 37/1992 del IVA)."] }), "SPFE");
    const category = first(first(exempt, "cac:TaxTotal")!, "cac:TaxCategory")!;
    expect(first(category, "cbc:ID")).toBe("E");
    expect(category).not.toContain("TaxExemptionReasonCode");
    expect(first(category, "cbc:TaxExemptionReason")).toContain("art. 20");
    expect(exemptWarnings.join(" ")).toContain("VATEX-ES");
  });

  it("IGIC: categoría «L» y calificador IGIC en la clave de régimen", () => {
    const igic = buildUblXml(baseInvoice({ issuerTerritory: "ES-CN", lines: [{ description: "Servicio", quantity: 1, unitPrice: 100, taxes: [{ rate: 7, kind: "VAT", operation: "ADD" }] }], storedTotal: 107 }), "SPFE").xml;
    expect(first(first(igic, "cac:ClassifiedTaxCategory")!, "cbc:ID")).toBe("L");
    expect(first(first(igic, "cac:AdditionalItemProperty")!, "cbc:ValueQualifier")).toBe("IGIC");
  });
});
