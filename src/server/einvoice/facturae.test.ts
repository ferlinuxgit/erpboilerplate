import { describe, expect, it } from "vitest";

import { buildFacturaeXml, facturaeProblems, FACTURAE_NAMESPACE } from "@/server/einvoice/facturae";
import { decimalString, EInvoiceError, isNaturalPerson, isValidDir3, looksLikePublicAdministration, splitPersonName, splitSeriesAndNumber } from "@/server/einvoice/model";
import { baseInvoice, townHall } from "@/server/einvoice/test-fixtures";

/** Contenido del primer elemento con ese nombre (los XML generados no tienen atributos salvo en la raíz). */
function first(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>(.*?)</${tag}>`, "s").exec(xml);
  return match ? match[1] : null;
}

function all(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>(.*?)</${tag}>`, "gs"))].map((match) => match[1]);
}

/** Orden de los elementos hijos directos, para comprobar la secuencia que exige el esquema. */
function childOrder(xml: string, tags: string[]) {
  const positions = tags.map((tag) => xml.indexOf(`<${tag}>`));
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
}

describe("Facturae 3.2.2: estructura", () => {
  const { xml, fileName } = buildFacturaeXml(baseInvoice());

  it("declara el espacio de nombres oficial y la versión", () => {
    expect(xml.startsWith(`<?xml version="1.0" encoding="UTF-8"?><fe:Facturae xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:fe="${FACTURAE_NAMESPACE}">`)).toBe(true);
    expect(xml.endsWith("</fe:Facturae>")).toBe(true);
    expect(first(xml, "SchemaVersion")).toBe("3.2.2");
    expect(first(xml, "Modality")).toBe("I");
    expect(first(xml, "InvoiceIssuerType")).toBe("EM");
    expect(fileName).toBe("F2026-000012.xml");
  });

  it("sigue el orden de bloques del esquema", () => {
    childOrder(xml, ["FileHeader", "Parties", "Invoices"]);
    childOrder(first(xml, "Invoice")!, ["InvoiceHeader", "InvoiceIssueData", "TaxesOutputs", "InvoiceTotals", "Items", "PaymentDetails", "AdditionalData"]);
    childOrder(first(xml, "InvoiceLine")!, ["ItemDescription", "Quantity", "UnitPriceWithoutTax", "TotalCost", "DiscountsAndRebates", "GrossAmount", "TaxesOutputs"]);
  });

  it("no deja espacios entre nodos ni elementos vacíos (forma canónica)", () => {
    expect(xml).not.toMatch(/>\s+</);
    expect(xml).not.toMatch(/\/>/);
    expect(xml).not.toMatch(/<([A-Za-z:]+)><\/\1>/);
  });

  it("identifica a emisor y cliente como personas jurídicas residentes", () => {
    const seller = first(xml, "SellerParty")!;
    expect(first(seller, "PersonTypeCode")).toBe("J");
    expect(first(seller, "ResidenceTypeCode")).toBe("R");
    expect(first(seller, "TaxIdentificationNumber")).toBe("B12345674");
    expect(first(seller, "CorporateName")).toBe("Talleres Norte, S.L.");
    expect(first(seller, "TradeName")).toBe("Talleres Norte");
    expect(first(seller, "PostCode")).toBe("28013");
    expect(first(seller, "CountryCode")).toBe("ESP");
    expect(first(first(xml, "BuyerParty")!, "TaxIdentificationNumber")).toBe("A58818501");
  });

  it("separa serie y número sin perder caracteres", () => {
    const header = first(xml, "InvoiceHeader")!;
    expect(first(header, "InvoiceSeriesCode")).toBe("F2026-");
    expect(first(header, "InvoiceNumber")).toBe("000012");
    expect(first(header, "InvoiceDocumentType")).toBe("FC");
    expect(first(header, "InvoiceClass")).toBe("OO");
    expect(first(xml, "BatchIdentifier")).toBe("B12345674000012F2026-");
  });

  it("escapa el texto", () => {
    expect(xml).toContain("<ItemDescription>Aceite &lt;sintético&gt; &amp; filtros</ItemDescription>");
  });

  it("incluye vencimiento, transferencia e IBAN", () => {
    const installment = first(xml, "Installment")!;
    expect(first(installment, "InstallmentDueDate")).toBe("2026-12-20");
    expect(first(installment, "InstallmentAmount")).toBe("440.86");
    expect(first(installment, "PaymentMeans")).toBe("04");
    expect(first(installment, "IBAN")).toBe("ES9121000418450200051332");
  });

  it("lleva la URL de cotejo de VERI*FACTU como información adicional", () => {
    expect(first(xml, "InvoiceAdditionalInformation")).toContain("ValidarQR?nif=B12345674&amp;numserie=F2026-000012");
  });
});

describe("Facturae 3.2.2: importes", () => {
  const { xml } = buildFacturaeXml(baseInvoice());

  it("líneas: coste total, descuento e importe bruto con dos decimales y coherentes", () => {
    const lines = all(xml, "InvoiceLine");
    expect(lines).toHaveLength(3);
    expect(first(lines[0], "Quantity")).toBe("2");
    expect(first(lines[0], "UnitPriceWithoutTax")).toBe("150.00");
    expect(first(lines[0], "TotalCost")).toBe("300.00");
    expect(first(lines[0], "DiscountRate")).toBe("10.00");
    expect(first(lines[0], "DiscountAmount")).toBe("30.00");
    expect(first(lines[0], "GrossAmount")).toBe("270.00");
    expect(first(lines[1], "TotalCost")).toBe("59.97");
    expect(lines[1]).not.toContain("DiscountsAndRebates");
    for (const line of lines) {
      const discount = Number(first(line, "DiscountAmount") ?? "0");
      expect(Math.round((Number(first(line, "TotalCost")) - discount) * 100)).toBe(Math.round(Number(first(line, "GrossAmount")) * 100));
    }
  });

  it("desglosa por tipo con la cuota calculada sobre la suma de bases", () => {
    const taxes = all(first(first(xml, "Invoice")!, "TaxesOutputs")!, "Tax");
    expect(taxes).toHaveLength(2);
    expect(first(taxes[0], "TaxTypeCode")).toBe("01");
    expect(first(taxes[0], "TaxRate")).toBe("21.00");
    expect(first(first(taxes[0], "TaxableBase")!, "TotalAmount")).toBe("329.97");
    expect(first(first(taxes[0], "TaxAmount")!, "TotalAmount")).toBe("69.29");
    expect(first(taxes[1], "TaxRate")).toBe("4.00");
    expect(first(first(taxes[1], "TaxAmount")!, "TotalAmount")).toBe("1.60");
  });

  it("los totales cumplen las fórmulas del esquema y coinciden con el total guardado", () => {
    const totals = first(xml, "InvoiceTotals")!;
    const value = (tag: string) => Number(first(totals, tag));
    expect(first(totals, "TotalGrossAmount")).toBe("369.97");
    expect(first(totals, "TotalGrossAmountBeforeTaxes")).toBe("369.97");
    expect(first(totals, "TotalTaxOutputs")).toBe("70.89");
    expect(first(totals, "TotalTaxesWithheld")).toBe("0.00");
    expect(first(totals, "InvoiceTotal")).toBe("440.86");
    expect(Math.round((value("TotalGrossAmountBeforeTaxes") + value("TotalTaxOutputs") - value("TotalTaxesWithheld")) * 100)).toBe(44086);
    expect(first(totals, "TotalOutstandingAmount")).toBe("440.86");
    expect(first(totals, "TotalExecutableAmount")).toBe("440.86");
    expect(first(first(xml, "TotalInvoicesAmount")!, "TotalAmount")).toBe("440.86");
    // Regla 6 del anexo II de la Orden HAP/1650/2015: todos los importes con dos decimales.
    for (const tag of ["TotalAmount", "TotalCost", "GrossAmount", "InstallmentAmount", "InvoiceTotal"]) {
      for (const amount of all(xml, tag)) expect(amount).toMatch(/^-?\d+\.\d{2}$/);
    }
  });

  it("se niega a generar si el total no cuadra con el guardado", () => {
    expect(() => buildFacturaeXml(baseInvoice({ storedTotal: 440.85 }))).toThrow(EInvoiceError);
  });
});

describe("Facturae 3.2.2: casos fiscales", () => {
  it("recargo de equivalencia dentro del impuesto al que acompaña", () => {
    const { xml } = buildFacturaeXml(baseInvoice({
      lines: [{ description: "Género", quantity: 10, unitPrice: 12.35, taxes: [{ rate: 21, kind: "VAT", operation: "ADD" }, { rate: 5.2, kind: "SURCHARGE", operation: "ADD" }] }],
      storedTotal: 155.86,
    }));
    const tax = all(first(first(xml, "Invoice")!, "TaxesOutputs")!, "Tax");
    expect(tax).toHaveLength(1);
    expect(first(first(tax[0], "TaxAmount")!, "TotalAmount")).toBe("25.94");
    expect(first(tax[0], "EquivalenceSurcharge")).toBe("5.20");
    expect(first(first(tax[0], "EquivalenceSurchargeAmount")!, "TotalAmount")).toBe("6.42");
    expect(first(xml, "TotalTaxOutputs")).toBe("32.36");
    expect(first(xml, "InvoiceTotal")).toBe("155.86");
  });

  it("separa el IVA con recargo del IVA sin recargo y sigue cuadrando al céntimo", () => {
    const { xml } = buildFacturaeXml(baseInvoice({
      lines: [
        { description: "Con recargo", quantity: 1, unitPrice: 0.05, taxes: [{ rate: 21, kind: "VAT", operation: "ADD" }, { rate: 5.2, kind: "SURCHARGE", operation: "ADD" }] },
        { description: "Sin recargo", quantity: 1, unitPrice: 0.07, taxes: [{ rate: 21, kind: "VAT", operation: "ADD" }] },
      ],
      // Bases 0,12; IVA 21 % sobre 0,12 = 0,03 (0,0252); recargo sobre 0,05 = 0,00.
      storedTotal: 0.15,
    }));
    const taxes = all(first(first(xml, "Invoice")!, "TaxesOutputs")!, "Tax");
    expect(taxes).toHaveLength(2);
    const sum = taxes.reduce((total, tax) => total
      + Math.round(Number(first(first(tax, "TaxAmount")!, "TotalAmount")) * 100)
      + Math.round(Number(first(first(tax, "EquivalenceSurchargeAmount") ?? "<TotalAmount>0</TotalAmount>", "TotalAmount")) * 100), 0);
    expect(sum).toBe(Math.round(Number(first(xml, "TotalTaxOutputs")) * 100));
    expect(first(xml, "InvoiceTotal")).toBe("0.15");
  });

  it("retención de IRPF en TaxesWithheld y restada del total", () => {
    const { xml, warnings } = buildFacturaeXml(baseInvoice({
      issuer: { ...baseInvoice().issuer, name: "María López García", legalName: null, taxId: "12345678Z" },
      lines: [{ description: "Honorarios", quantity: 1, unitPrice: 1000, taxes: [{ rate: 21, kind: "VAT", operation: "ADD" }, { rate: 15, kind: "WITHHOLDING", operation: "SUBTRACT" }] }],
      storedTotal: 1060,
    }));
    const invoice = first(xml, "Invoice")!;
    childOrder(invoice, ["TaxesOutputs", "TaxesWithheld", "InvoiceTotals"]);
    const withheld = first(invoice, "TaxesWithheld")!;
    expect(first(withheld, "TaxTypeCode")).toBe("04");
    expect(first(withheld, "TaxRate")).toBe("15.00");
    expect(first(first(withheld, "TaxAmount")!, "TotalAmount")).toBe("150.00");
    expect(first(xml, "TotalTaxOutputs")).toBe("210.00");
    expect(first(xml, "TotalTaxesWithheld")).toBe("150.00");
    expect(first(xml, "InvoiceTotal")).toBe("1060.00");
    // En la línea, la retención va antes que los impuestos repercutidos.
    childOrder(first(xml, "InvoiceLine")!, ["GrossAmount", "TaxesWithheld", "TaxesOutputs"]);
    // Emisor persona física: nombre y apellidos separados, con aviso para revisarlos.
    const seller = first(xml, "SellerParty")!;
    expect(first(seller, "PersonTypeCode")).toBe("F");
    expect(first(seller, "Name")).toBe("María");
    expect(first(seller, "FirstSurname")).toBe("López");
    expect(first(seller, "SecondSurname")).toBe("García");
    expect(warnings.some((warning) => warning.includes("persona física"))).toBe(true);
  });

  it("rectificativa: clase OR, bloque Corrective e importes negativos", () => {
    const { xml } = buildFacturaeXml(baseInvoice({
      number: "R2026-000003",
      isCreditNote: true,
      lines: [{ description: "Devolución manual técnico", quantity: -1, unitPrice: 40, taxes: [{ rate: 4, kind: "VAT", operation: "ADD" }] }],
      storedTotal: -41.6,
      corrective: { originalNumber: "F2026-000012", originalIssueDate: "2026-11-20", reason: "R4", type: "DIFFERENCES", description: "Devolución de mercancía" },
    }));
    expect(first(xml, "InvoiceClass")).toBe("OR");
    const corrective = first(xml, "Corrective")!;
    childOrder(corrective, ["InvoiceNumber", "InvoiceSeriesCode", "ReasonCode", "ReasonDescription", "TaxPeriod", "CorrectionMethod", "CorrectionMethodDescription", "AdditionalReasonDescription", "InvoiceIssueDate"]);
    expect(first(corrective, "InvoiceNumber")).toBe("000012");
    expect(first(corrective, "InvoiceSeriesCode")).toBe("F2026-");
    expect(first(corrective, "ReasonCode")).toBe("16");
    expect(first(corrective, "ReasonDescription")).toBe("Base imponible");
    expect(first(corrective, "StartDate")).toBe("2026-11-01");
    expect(first(corrective, "EndDate")).toBe("2026-11-30");
    expect(first(corrective, "CorrectionMethod")).toBe("02");
    expect(first(corrective, "CorrectionMethodDescription")).toBe("Rectificación por diferencias");
    expect(first(corrective, "AdditionalReasonDescription")).toContain("R4");
    expect(first(corrective, "AdditionalReasonDescription")).toContain("Devolución de mercancía");
    expect(first(corrective, "InvoiceIssueDate")).toBe("2026-11-20");
    expect(first(xml, "Quantity")).toBe("-1");
    expect(first(xml, "GrossAmount")).toBe("-40.00");
    expect(first(xml, "InvoiceTotal")).toBe("-41.60");
    // Un abono no lleva plan de pagos.
    expect(xml).not.toContain("PaymentDetails");
  });

  it("rectificativa por concurso: motivo 85 de Facturae", () => {
    const { xml } = buildFacturaeXml(baseInvoice({
      number: "R2026-000004",
      isCreditNote: true,
      lines: [{ description: "Cuota no cobrada", quantity: -1, unitPrice: 100, taxes: [{ rate: 21, kind: "VAT", operation: "ADD" }] }],
      storedTotal: -121,
      corrective: { originalNumber: "F2026-000001", originalIssueDate: "2026-02-10", reason: "R2", type: "DIFFERENCES", description: null },
    }));
    expect(first(xml, "ReasonCode")).toBe("85");
    expect(first(xml, "EndDate")).toBe("2026-02-28");
  });

  it("exenta: tipo 0, SpecialTaxableEvent con el código del impuesto y mención legal", () => {
    const literal = "Operación exenta de IVA (art. 20 Ley 37/1992 del IVA).";
    const { xml } = buildFacturaeXml(baseInvoice({
      lines: [{ description: "Formación", quantity: 1, unitPrice: 500, taxes: [] }],
      storedTotal: 500,
      vatTreatment: "EXEMPT",
      legalLiterals: [literal],
    }));
    const line = first(xml, "InvoiceLine")!;
    expect(first(line, "TaxRate")).toBe("0.00");
    expect(first(first(line, "TaxAmount")!, "TotalAmount")).toBe("0.00");
    expect(first(line, "SpecialTaxableEventCode")).toBe("01");
    expect(first(line, "SpecialTaxableEventReason")).toBe(`01 ${literal}`);
    expect(first(xml, "LegalReference")).toBe(literal);
    expect(first(xml, "TotalTaxOutputs")).toBe("0.00");
  });

  it("no sujeta: código 02; inversión del sujeto pasivo: sin SpecialTaxableEvent", () => {
    const line = { description: "Servicio", quantity: 1, unitPrice: 100, taxes: [] };
    expect(first(buildFacturaeXml(baseInvoice({ lines: [line], storedTotal: 100, vatTreatment: "NOT_SUBJECT", legalLiterals: ["Operación no sujeta a IVA."] })).xml, "SpecialTaxableEventCode")).toBe("02");
    expect(buildFacturaeXml(baseInvoice({ lines: [line], storedTotal: 100, vatTreatment: "REVERSE_CHARGE", legalLiterals: ["Inversión del sujeto pasivo."] })).xml).not.toContain("SpecialTaxableEvent");
  });

  it("Canarias usa el código de IGIC", () => {
    const { xml } = buildFacturaeXml(baseInvoice({
      issuerTerritory: "ES-CN",
      lines: [{ description: "Servicio", quantity: 1, unitPrice: 100, taxes: [{ rate: 7, kind: "VAT", operation: "ADD" }] }],
      storedTotal: 107,
    }));
    expect(first(first(xml, "TaxesOutputs")!, "TaxTypeCode")).toBe("03");
  });
});

describe("Facturae 3.2.2: Administración pública (DIR3)", () => {
  it("emite los centros administrativos con sus roles", () => {
    const { xml } = buildFacturaeXml(baseInvoice({
      customer: townHall,
      dir3: { accountingOffice: "L01280796", managingBody: "l01280797", processingUnit: "L01280798", proposingBody: "L01280799" },
    }));
    const buyer = first(xml, "BuyerParty")!;
    childOrder(buyer, ["TaxIdentification", "AdministrativeCentres", "LegalEntity"]);
    const centres = all(buyer, "AdministrativeCentre");
    expect(centres.map((centre) => [first(centre, "RoleTypeCode"), first(centre, "CentreCode")])).toEqual([
      ["01", "L01280796"],
      ["02", "L01280797"],
      ["03", "L01280798"],
      ["04", "L01280799"],
    ]);
    // El esquema exige domicilio en cada centro: el del destinatario.
    for (const centre of centres) expect(first(centre, "PostCode")).toBe("28005");
  });

  it("sin órgano proponente solo van los tres centros obligatorios; sin DIR3, ninguno", () => {
    const withThree = buildFacturaeXml(baseInvoice({ customer: townHall, dir3: { accountingOffice: "L01280796", managingBody: "L01280796", processingUnit: "L01280796" } })).xml;
    expect(all(withThree, "AdministrativeCentre")).toHaveLength(3);
    expect(buildFacturaeXml(baseInvoice()).xml).not.toContain("AdministrativeCentres");
  });

  it("reconoce el NIF de una Administración y valida la forma del DIR3", () => {
    expect(looksLikePublicAdministration(townHall)).toBe(true);
    expect(looksLikePublicAdministration(baseInvoice().customer)).toBe(false);
    expect(isValidDir3("L01280796")).toBe(true);
    expect(isValidDir3("ea0008567")).toBe(true);
    expect(isValidDir3("L0128079")).toBe(false);
    expect(isValidDir3("123456789")).toBe(false);
  });
});

describe("Facturae 3.2.2: datos que faltan", () => {
  it("explica todo lo que falta en lugar de generar un fichero inválido", () => {
    const problems = facturaeProblems(baseInvoice({ customer: { name: "Cliente de mostrador", taxId: null, address: null, postalCode: null, city: null, province: null, countryCode: "ES" } }));
    expect(problems.some((problem) => problem.includes("NIF del cliente"))).toBe(true);
    expect(problems.some((problem) => problem.includes("dirección del cliente"))).toBe(true);
    expect(problems.some((problem) => problem.includes("código postal del cliente"))).toBe(true);
    expect(facturaeProblems(baseInvoice())).toEqual([]);
  });

  it("cliente extranjero: domicilio OverseasAddress y residencia U o E", () => {
    const { xml } = buildFacturaeXml(baseInvoice({
      customer: { name: "Dupont SARL", taxId: "FR12345678901", address: "1 rue de la Paix", postalCode: "75002", city: "Paris", province: null, countryCode: "FR" },
      lines: [{ description: "Mercancía", quantity: 1, unitPrice: 100, taxes: [] }],
      storedTotal: 100,
      vatTreatment: "INTRA_EU",
      legalLiterals: ["Entrega intracomunitaria de bienes exenta de IVA (art. 25 Ley 37/1992 del IVA)."],
    }));
    const buyer = first(xml, "BuyerParty")!;
    expect(first(buyer, "ResidenceTypeCode")).toBe("U");
    expect(first(buyer, "TaxIdentificationNumber")).toBe("FR12345678901");
    expect(first(buyer, "PostCodeAndTown")).toBe("75002 Paris");
    expect(first(buyer, "CountryCode")).toBe("FRA");
  });
});

describe("utilidades del modelo", () => {
  it("serie y número", () => {
    expect(splitSeriesAndNumber("F2026-000012")).toEqual({ series: "F2026-", number: "000012" });
    expect(splitSeriesAndNumber("2026/15")).toEqual({ series: "2026/", number: "15" });
    expect(splitSeriesAndNumber("000123")).toEqual({ series: null, number: "000123" });
    expect(splitSeriesAndNumber("ABC")).toEqual({ series: null, number: "ABC" });
  });

  it("nombre y apellidos", () => {
    expect(splitPersonName("María del Carmen López García")).toEqual({ name: "María del Carmen", firstSurname: "López", secondSurname: "García" });
    expect(splitPersonName("López García, María")).toEqual({ name: "María", firstSurname: "López", secondSurname: "García" });
    expect(splitPersonName("John Smith")).toEqual({ name: "John", firstSurname: "Smith", secondSurname: null });
  });

  it("persona física por NIF y decimales sin notación exponencial", () => {
    expect(isNaturalPerson({ taxId: "12345678Z", countryCode: "ES" })).toBe(true);
    expect(isNaturalPerson({ taxId: "X1234567L", countryCode: "ES" })).toBe(true);
    expect(isNaturalPerson({ taxId: "ESB12345674", countryCode: "ES" })).toBe(false);
    expect(decimalString(0.0000001, 8)).toBe("0.0000001");
    expect(decimalString(2.5, 8)).toBe("2.5");
    expect(decimalString(21, 8, 2)).toBe("21.00");
    expect(decimalString(5.2, 8, 2)).toBe("5.20");
    expect(decimalString(1e-9, 8)).toBe("0");
  });
});
