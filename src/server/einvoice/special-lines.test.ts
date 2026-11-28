import { describe, expect, it } from "vitest";

import { buildFacturaeXml, registrationDataFields } from "@/server/einvoice/facturae";
import { baseInvoice, issuer } from "@/server/einvoice/test-fixtures";
import { buildUblXml, ublProblems } from "@/server/einvoice/ubl";

/** Suplidos, descuento global y anticipo descontado en Facturae y UBL: los totales cuadran con el total guardado. */

function first(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?: [^>]*)?>(.*?)</${tag}>`, "s").exec(xml);
  return match ? match[1] : null;
}
function all(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}(?: [^>]*)?>(.*?)</${tag}>`, "gs"))].map((match) => match[1]);
}
const vat = (rate: number) => [{ name: `IVA ${rate} %`, rate, kind: "VAT", operation: "ADD" as const }];

const withDisbursement = () => baseInvoice({
  lines: [
    { description: "Gestión de matriculación", quantity: 1, unitPrice: 100, taxes: vat(21) },
    { description: "Tasa de Tráfico pagada por cuenta del cliente", quantity: 1, unitPrice: 50, taxes: [], isDisbursement: true },
  ],
  storedTotal: 171,
});

const withGlobalDiscount = () => baseInvoice({
  lines: [
    { description: "Instalación", quantity: 2, unitPrice: 100, taxes: vat(21) },
    { description: "Libros técnicos", quantity: 1, unitPrice: 100, taxes: vat(10) },
    { description: "Descuento 10 %", quantity: 1, unitPrice: -20, taxes: vat(21), isGlobalDiscount: true },
    { description: "Descuento 10 %", quantity: 1, unitPrice: -10, taxes: vat(10), isGlobalDiscount: true },
  ],
  // Bases 180 + 90 = 270; IVA 37,80 + 9,00.
  storedTotal: 316.8,
});

const withAdvance = () => baseInvoice({
  lines: [
    { description: "Obra completa", quantity: 1, unitPrice: 1000, taxes: vat(21) },
    { description: "Anticipo facturado en A2026-000001", quantity: 1, unitPrice: -300, taxes: vat(21), advanceInvoiceId: "advance-1" },
  ],
  storedTotal: 847,
});

describe("Facturae: suplidos, descuento global y anticipos", () => {
  it("suplido: en ReimbursableExpenses, fuera de las líneas y sumado al importe exigible", () => {
    const { xml } = buildFacturaeXml(withDisbursement());
    expect(all(xml, "InvoiceLine")).toHaveLength(1);
    const totalsBlock = first(xml, "InvoiceTotals")!;
    expect(first(totalsBlock, "TotalGrossAmountBeforeTaxes")).toBe("100.00");
    expect(first(totalsBlock, "InvoiceTotal")).toBe("121.00");
    expect(first(totalsBlock, "ReimbursableExpensesAmount")).toBe("50.00");
    expect(first(totalsBlock, "TotalOutstandingAmount")).toBe("121.00");
    expect(first(totalsBlock, "TotalExecutableAmount")).toBe("171.00");
    expect(first(totalsBlock, "TotalReimbursableExpenses")).toBe("50.00");
    expect(first(xml, "InstallmentAmount")).toBe("171.00");
    expect(first(first(xml, "Batch")!, "TotalExecutableAmount")).toContain("171.00");
    expect(first(xml, "InvoiceAdditionalInformation")).toContain("Suplidos (art. 78.Tres.3.º Ley 37/1992): Tasa de Tráfico pagada por cuenta del cliente 50.00");
  });

  it("descuento global: GeneralDiscounts y bases del desglose ya descontadas", () => {
    const { xml } = buildFacturaeXml(withGlobalDiscount());
    expect(all(xml, "InvoiceLine")).toHaveLength(2);
    const totalsBlock = first(xml, "InvoiceTotals")!;
    expect(first(totalsBlock, "TotalGrossAmount")).toBe("300.00");
    expect(all(first(totalsBlock, "GeneralDiscounts")!, "DiscountAmount")).toEqual(["20.00", "10.00"]);
    expect(first(totalsBlock, "DiscountReason")).toBe("Descuento 10 %");
    expect(first(totalsBlock, "TotalGeneralDiscounts")).toBe("30.00");
    expect(first(totalsBlock, "TotalGrossAmountBeforeTaxes")).toBe("270.00");
    expect(first(totalsBlock, "InvoiceTotal")).toBe("316.80");
    expect(first(totalsBlock, "TotalExecutableAmount")).toBe("316.80");
    // Desglose de la factura (el que va antes de los totales).
    const invoiceTaxes = first(xml.slice(xml.indexOf("</InvoiceIssueData>")), "TaxesOutputs")!;
    expect(all(invoiceTaxes, "TaxableBase").map((base) => first(base, "TotalAmount"))).toEqual(["180.00", "90.00"]);
    expect(all(invoiceTaxes, "TaxAmount").map((tax) => first(tax, "TotalAmount"))).toEqual(["37.80", "9.00"]);
  });

  it("anticipo: línea negativa que minora la base, sin PaymentsOnAccount", () => {
    const { xml } = buildFacturaeXml(withAdvance());
    const lines = all(xml, "InvoiceLine");
    expect(lines).toHaveLength(2);
    expect(first(lines[1], "GrossAmount")).toBe("-300.00");
    expect(xml).not.toContain("PaymentsOnAccount");
    expect(first(first(xml, "InvoiceTotals")!, "TotalGrossAmountBeforeTaxes")).toBe("700.00");
    expect(first(first(xml, "InvoiceTotals")!, "InvoiceTotal")).toBe("847.00");
  });

  it("datos registrales del emisor en RegistrationData", () => {
    expect(registrationDataFields("Registro Mercantil de Madrid, Tomo 1234, Libro 0, Folio 56, Sección 8.ª, Hoja M-7890, Inscripción 1.ª")).toEqual([
      ["Book", "0"], ["RegisterOfCompaniesLocation", "Madrid"], ["Sheet", "M-7890"], ["Folio", "56"], ["Section", "8.ª"], ["Volume", "1234"], ["AdditionalRegistrationData", "1.ª"],
    ]);
    expect(registrationDataFields("Sociedad inscrita")).toEqual([]);
    const { xml, warnings } = buildFacturaeXml(baseInvoice({ issuer: { ...issuer, registryData: "R. M. de Madrid, Tomo 1234, Folio 56, Hoja M-7890" } }));
    expect(first(first(xml, "SellerParty")!, "RegistrationData")).toBe("<Sheet>M-7890</Sheet><Folio>56</Folio><Volume>1234</Volume>");
    expect(first(xml, "BuyerParty")).not.toContain("RegistrationData");
    expect(warnings.join(" ")).not.toContain("datos registrales");
    expect(buildFacturaeXml(baseInvoice({ issuer: { ...issuer, registryData: "Inscrita en el registro" } })).warnings.join(" ")).toContain("datos registrales");
  });
});

describe("UBL: suplidos, descuento global y anticipos", () => {
  it("suplido: el núcleo no lo genera; el perfil de la AEAT lo lleva en BG-34 «SUPL»", () => {
    expect(ublProblems(withDisbursement()).join(" ")).toContain("suplidos");
    const { xml } = buildUblXml(withDisbursement(), "SPFE");
    expect(all(xml, "cac:InvoiceLine")).toHaveLength(1);
    const collection = first(xml, "cac:CollectionInvoiceLine")!;
    expect(first(collection, "cbc:ID")).toBe("urn:aeat:names:specification:schema:add:SUPL");
    expect(first(collection, "cbc:TaxInclusiveLineExtensionAmount")).toBe("50.00");
    expect(first(collection, "cbc:Description")).toBe("Tasa de Tráfico pagada por cuenta del cliente");
    expect(first(xml, "cbc:TaxInclusiveAmount")).toBe("121.00");
    expect(first(xml, "cbc:PayableAmount")).toBe("171.00");
  });

  it("descuento global: AllowanceCharge de documento por categoría y tipo", () => {
    for (const profile of ["EN16931", "SPFE"] as const) {
      const { xml } = buildUblXml(withGlobalDiscount(), profile);
      expect(all(xml, "cac:InvoiceLine")).toHaveLength(2);
      const documentLevel = xml.slice(0, xml.indexOf("<cac:TaxTotal>"));
      const documentAllowances = all(documentLevel, "cac:AllowanceCharge");
      expect(documentAllowances.map((block) => [first(block, "cbc:ChargeIndicator"), first(block, "cbc:Amount"), first(block, "cbc:Percent")])).toEqual([["false", "20.00", "21"], ["false", "10.00", "10"]]);
      const totals = first(xml, "cac:LegalMonetaryTotal")!;
      expect(first(totals, "cbc:LineExtensionAmount")).toBe("300.00");
      expect(first(totals, "cbc:AllowanceTotalAmount")).toBe("30.00");
      expect(first(totals, "cbc:TaxExclusiveAmount")).toBe("270.00");
      expect(first(totals, "cbc:PayableAmount")).toBe("316.80");
      expect(all(first(xml, "cac:TaxTotal")!, "cbc:TaxableAmount")).toEqual(["180.00", "90.00"]);
    }
  });

  it("anticipo: línea negativa con su categoría, sin PrepaidAmount", () => {
    const { xml } = buildUblXml(withAdvance());
    const lines = all(xml, "cac:InvoiceLine");
    expect(lines[1]).toContain('<cbc:InvoicedQuantity unitCode="C62">-1</cbc:InvoicedQuantity>');
    expect(first(lines[1], "cbc:LineExtensionAmount")).toBe("-300.00");
    expect(xml).not.toContain("PrepaidAmount");
    expect(first(xml, "cbc:TaxExclusiveAmount")).toBe("700.00");
    expect(first(xml, "cbc:PayableAmount")).toBe("847.00");
  });
});
