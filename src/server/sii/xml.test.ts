import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { mapInvestmentGoods } from "@/server/sii/investment-goods";
import { mapIssuedInvoice, mapReceivedInvoice, cancellationFor, type SiiIssuedSource, type SiiReceivedSource } from "@/server/sii/mapping";
import { siiXsdValidator } from "@/server/sii/test-fixtures/xsd-validator";
import {
  buildBajaLRBienesInversion,
  buildBajaLRFacturasEmitidas,
  buildBajaLRFacturasRecibidas,
  buildSoapEnvelope,
  buildSuministroLRBienesInversion,
  buildSuministroLRCobrosEmitidas,
  buildSuministroLRFacturasEmitidas,
  buildSuministroLRFacturasRecibidas,
  buildSuministroLRPagosRecibidas,
  chunkForSubmission,
  parseSiiResponse,
  SII_MAX_RECORDS_PER_SUBMISSION,
} from "@/server/sii/xml";

/**
 * Cada mensaje se valida contra los XSD oficiales del SII (versión 1.1 «bis») con el validador
 * mínimo de `test-fixtures/xsd-validator.ts`. Ninguna prueba habla con la AEAT.
 */
const xsd = siiXsdValidator();
// Con SII_DUMP_DIR, cada mensaje validado se guarda en esa carpeta para pasarlo además por un
// validador XSD completo externo (xmllint, lxml…): así se hizo la comprobación del informe.
let dumped = 0;
const validator = {
  validate(xml: string) {
    const errors = xsd.validate(xml);
    if (process.env.SII_DUMP_DIR && errors.length === 0) {
      mkdirSync(process.env.SII_DUMP_DIR, { recursive: true });
      dumped += 1;
      writeFileSync(path.join(process.env.SII_DUMP_DIR, `mensaje-${String(dumped).padStart(2, "0")}.xml`), xml);
    }
    return errors;
  },
};
const holder = { name: "Empresa Demo SL", nif: "B12345674" };
const TZ = "Europe/Madrid";
const day = (iso: string) => new Date(`${iso}T10:00:00Z`);
const vat = (rate: number) => ({ name: `IVA ${rate}`, rate, kind: "VAT", operation: "ADD" as const });
const surcharge = (rate: number) => ({ name: `RE ${rate}`, rate, kind: "SURCHARGE", operation: "ADD" as const });

function issued(overrides: Partial<SiiIssuedSource> = {}): SiiIssuedSource {
  return {
    number: "FA-2027-0001",
    issueDate: day("2027-03-10"),
    operationDate: null,
    invoiceType: "INVOICE",
    rectificationReason: null,
    rectificationDescription: null,
    vatTreatment: "DOMESTIC",
    exemptionCode: null,
    holder,
    customer: { name: "Cliente Nacional SA", taxId: "A58818501", countryCode: "ES" },
    lines: [{ description: "Servicio de mantenimiento", quantity: 1, unitPrice: 100, taxes: [vat(21)], isService: true }],
    original: null,
    timeZone: TZ,
    ...overrides,
  };
}

function received(overrides: Partial<SiiReceivedSource> = {}): SiiReceivedSource {
  return {
    number: "FR-000012",
    supplierDocumentNumber: "A/2027/55",
    issueDate: day("2027-03-08"),
    accountingDate: day("2027-03-11"),
    operationDate: null,
    documentKind: "INVOICE",
    rectificationReason: null,
    rectified: null,
    isSimplified: false,
    vatTreatment: "DOMESTIC",
    importDuaNumber: null,
    importDuaDate: null,
    prorrataPct: 100,
    holder,
    supplier: { name: "Proveedor SL", taxId: "B85121501", countryCode: "ES" },
    lines: [{ description: "Material de oficina", subtotal: "200.00", taxAmount: "42.00", taxRate: "21", taxDeductiblePct: "100" }],
    timeZone: TZ,
    ...overrides,
  };
}

const emitidas = (sources: SiiIssuedSource[], communication: "A0" | "A1" = "A0") =>
  buildSuministroLRFacturasEmitidas({ holder, communication, invoices: sources.map((source) => mapIssuedInvoice(source).invoice) });
const recibidas = (sources: SiiReceivedSource[], communication: "A0" | "A1" = "A0") =>
  buildSuministroLRFacturasRecibidas({ holder, communication, invoices: sources.map((source) => mapReceivedInvoice(source).invoice) });

describe("validador XSD de pruebas", () => {
  it("detecta elementos fuera de orden, obligatorios ausentes y valores fuera de lista", () => {
    const xml = emitidas([issued()]);
    expect(validator.validate(xml)).toEqual([]);
    expect(validator.validate(xml.replace("<sii:TipoFactura>F1</sii:TipoFactura>", "<sii:TipoFactura>ZZ</sii:TipoFactura>")).join(" ")).toContain("no está en la lista");
    expect(validator.validate(xml.replace(/\s*<sii:DescripcionOperacion>[^<]*<\/sii:DescripcionOperacion>/, "")).join(" ")).toContain("falta <DescripcionOperacion>");
    const swapped = xml.replace(/(<sii:IDVersionSii>1\.1<\/sii:IDVersionSii>)([\s\S]*?)(<sii:TipoComunicacion>A0<\/sii:TipoComunicacion>)/, "$3$2$1");
    expect(validator.validate(swapped).length).toBeGreaterThan(0);
    expect(validator.validate(xml.replace("<sii:NIF>B12345674</sii:NIF>", "<sii:NIF>123</sii:NIF>")).join(" ")).toContain("NIF");
  });
});

describe("SuministroLRFacturasEmitidas", () => {
  it("F1 nacional: cabecera con titular y A0, periodo mensual, contraparte con NIF y desglose a nivel de factura", () => {
    const xml = emitidas([issued()]);
    expect(validator.validate(xml)).toEqual([]);
    expect(xml).toContain("<sii:IDVersionSii>1.1</sii:IDVersionSii>");
    expect(xml).toContain("<sii:TipoComunicacion>A0</sii:TipoComunicacion>");
    expect(xml).toMatch(/<sii:Ejercicio>2027<\/sii:Ejercicio>\s*<sii:Periodo>03<\/sii:Periodo>/);
    expect(xml).toContain("<sii:FechaExpedicionFacturaEmisor>10-03-2027</sii:FechaExpedicionFacturaEmisor>");
    expect(xml).toContain("<sii:ClaveRegimenEspecialOTrascendencia>01</sii:ClaveRegimenEspecialOTrascendencia>");
    expect(xml).toContain("<sii:ImporteTotal>121.00</sii:ImporteTotal>");
    expect(xml).toMatch(/<sii:Contraparte>\s*<sii:NombreRazon>Cliente Nacional SA<\/sii:NombreRazon>\s*<sii:NIF>A58818501<\/sii:NIF>/);
    expect(xml).toMatch(/<sii:DesgloseFactura>\s*<sii:Sujeta>\s*<sii:NoExenta>\s*<sii:TipoNoExenta>S1<\/sii:TipoNoExenta>/);
    expect(xml).toMatch(/<sii:TipoImpositivo>21.00<\/sii:TipoImpositivo>\s*<sii:BaseImponible>100.00<\/sii:BaseImponible>\s*<sii:CuotaRepercutida>21.00<\/sii:CuotaRepercutida>/);
  });

  it("modificación (A1) y fecha de operación distinta: el periodo es el del devengo", () => {
    const xml = emitidas([issued({ operationDate: day("2027-02-25") })], "A1");
    expect(validator.validate(xml)).toEqual([]);
    expect(xml).toContain("<sii:TipoComunicacion>A1</sii:TipoComunicacion>");
    expect(xml).toContain("<sii:FechaOperacion>25-02-2027</sii:FechaOperacion>");
    expect(xml).toMatch(/<sii:Periodo>02<\/sii:Periodo>/);
  });

  it("F2 simplificada: sin contraparte", () => {
    const xml = emitidas([issued({ customer: { name: "Cliente de mostrador", taxId: null, countryCode: "ES" } })]);
    expect(validator.validate(xml)).toEqual([]);
    expect(xml).toContain("<sii:TipoFactura>F2</sii:TipoFactura>");
    expect(xml).not.toContain("<sii:Contraparte>");
  });

  it("varios tipos con recargo de equivalencia y parte exenta con su causa", () => {
    const xml = emitidas([issued({
      exemptionCode: "E1",
      lines: [
        { description: "Género", quantity: 1, unitPrice: 100, taxes: [vat(21), surcharge(5.2)], isService: false },
        { description: "Pan", quantity: 1, unitPrice: 50, taxes: [vat(4), surcharge(0.5)], isService: false },
        { description: "Formación exenta", quantity: 1, unitPrice: 30, taxes: [vat(0)], isService: true },
      ],
    })]);
    expect(validator.validate(xml)).toEqual([]);
    expect(xml).toMatch(/<sii:Exenta>\s*<sii:DetalleExenta>\s*<sii:CausaExencion>E1<\/sii:CausaExencion>\s*<sii:BaseImponible>30.00<\/sii:BaseImponible>/);
    expect(xml).toMatch(/<sii:TipoRecargoEquivalencia>5.20<\/sii:TipoRecargoEquivalencia>\s*<sii:CuotaRecargoEquivalencia>5.20<\/sii:CuotaRecargoEquivalencia>/);
    expect(xml).toMatch(/<sii:TipoRecargoEquivalencia>0.50<\/sii:TipoRecargoEquivalencia>\s*<sii:CuotaRecargoEquivalencia>0.25<\/sii:CuotaRecargoEquivalencia>/);
    // 100 + 21 + 5,20 + 50 + 2 + 0,25 + 30
    expect(xml).toContain("<sii:ImporteTotal>208.45</sii:ImporteTotal>");
  });

  it("inversión del sujeto pasivo: S2 con tipo y cuota a cero", () => {
    const xml = emitidas([issued({ vatTreatment: "REVERSE_CHARGE", lines: [{ description: "Ejecución de obra", quantity: 1, unitPrice: 1000, taxes: [], isService: true }] })]);
    expect(validator.validate(xml)).toEqual([]);
    expect(xml).toMatch(/<sii:TipoNoExenta>S2<\/sii:TipoNoExenta>\s*<sii:DesgloseIVA>\s*<sii:DetalleIVA>\s*<sii:TipoImpositivo>0.00<\/sii:TipoImpositivo>\s*<sii:BaseImponible>1000.00<\/sii:BaseImponible>\s*<sii:CuotaRepercutida>0.00<\/sii:CuotaRepercutida>/);
  });

  it("entrega intracomunitaria: IDOtro con NIF-IVA (02), desglose por tipo de operación y exenta E5 en Entrega", () => {
    const xml = emitidas([issued({
      vatTreatment: "INTRA_EU",
      customer: { name: "Kunde GmbH", taxId: "DE123456789", countryCode: "DE" },
      lines: [{ description: "Maquinaria", quantity: 2, unitPrice: 500, taxes: [], isService: false }],
    })]);
    expect(validator.validate(xml)).toEqual([]);
    expect(xml).toMatch(/<sii:IDOtro>\s*<sii:IDType>02<\/sii:IDType>\s*<sii:ID>DE123456789<\/sii:ID>/);
    expect(xml).toMatch(/<sii:DesgloseTipoOperacion>\s*<sii:Entrega>\s*<sii:Sujeta>\s*<sii:Exenta>\s*<sii:DetalleExenta>\s*<sii:CausaExencion>E5<\/sii:CausaExencion>\s*<sii:BaseImponible>1000.00<\/sii:BaseImponible>/);
    expect(xml).not.toContain("<sii:PrestacionServicios>");
  });

  it("servicio intracomunitario: no sujeto por reglas de localización dentro de PrestacionServicios", () => {
    const xml = emitidas([issued({
      vatTreatment: "INTRA_EU_SERVICES",
      customer: { name: "Client SARL", taxId: "12345678901", countryCode: "FR" },
      lines: [{ description: "Consultoría", quantity: 1, unitPrice: 800, taxes: [], isService: true }],
    })]);
    expect(validator.validate(xml)).toEqual([]);
    expect(xml).toContain("<sii:ID>FR12345678901</sii:ID>");
    expect(xml).toMatch(/<sii:PrestacionServicios>\s*<sii:NoSujeta>\s*<sii:ImporteTAIReglasLocalizacion>800.00<\/sii:ImporteTAIReglasLocalizacion>/);
  });

  it("exportación: clave de régimen 02, documento oficial del país (04) con su código y exenta E2", () => {
    const xml = emitidas([issued({
      vatTreatment: "EXPORT",
      customer: { name: "Acme Inc.", taxId: "98-7654321", countryCode: "US" },
      lines: [{ description: "Mercancía", quantity: 1, unitPrice: 300, taxes: [], isService: false }],
    })]);
    expect(validator.validate(xml)).toEqual([]);
    expect(xml).toContain("<sii:ClaveRegimenEspecialOTrascendencia>02</sii:ClaveRegimenEspecialOTrascendencia>");
    expect(xml).toMatch(/<sii:IDOtro>\s*<sii:CodigoPais>US<\/sii:CodigoPais>\s*<sii:IDType>04<\/sii:IDType>\s*<sii:ID>987654321<\/sii:ID>/);
    expect(xml).toContain("<sii:CausaExencion>E2</sii:CausaExencion>");
  });

  it("cliente extranjero con IVA español: reparte entregas y servicios según el artículo de cada línea", () => {
    const xml = emitidas([issued({
      customer: { name: "Tourist Ltd", taxId: "GB999999973", countryCode: "GB" },
      lines: [
        { description: "Producto", quantity: 1, unitPrice: 100, taxes: [vat(21)], isService: false },
        { description: "Instalación", quantity: 1, unitPrice: 50, taxes: [vat(21)], isService: true },
      ],
    })]);
    expect(validator.validate(xml)).toEqual([]);
    expect(xml).toMatch(/<sii:PrestacionServicios>[\s\S]*<sii:BaseImponible>50.00<\/sii:BaseImponible>[\s\S]*<\/sii:PrestacionServicios>\s*<sii:Entrega>[\s\S]*<sii:BaseImponible>100.00<\/sii:BaseImponible>/);
    expect(xml).toContain("<sii:ImporteTotal>181.50</sii:ImporteTotal>");
  });

  it("no sujeta por los arts. 7 y 14 (N1)", () => {
    const xml = emitidas([issued({ vatTreatment: "NOT_SUBJECT", exemptionCode: "N1", lines: [{ description: "Indemnización", quantity: 1, unitPrice: 75, taxes: [], isService: true }] })]);
    expect(validator.validate(xml)).toEqual([]);
    expect(xml).toMatch(/<sii:NoSujeta>\s*<sii:ImportePorArticulos7_14_Otros>75.00<\/sii:ImportePorArticulos7_14_Otros>/);
  });

  it.each(["R1", "R2", "R3", "R4"])("rectificativa %s por diferencias con la factura rectificada", (reason) => {
    const xml = emitidas([issued({
      number: "RE-2027-0002",
      invoiceType: "CREDIT_NOTE",
      rectificationReason: reason,
      rectificationDescription: "Devolución parcial",
      lines: [{ description: "Devolución", quantity: -1, unitPrice: 100, taxes: [vat(21)], isService: false }],
      original: { number: "FA-2027-0001", issueDate: day("2027-03-01"), simplified: false },
    })]);
    expect(validator.validate(xml)).toEqual([]);
    expect(xml).toContain(`<sii:TipoFactura>${reason}</sii:TipoFactura>`);
    expect(xml).toMatch(/<sii:TipoRectificativa>I<\/sii:TipoRectificativa>\s*<sii:FacturasRectificadas>\s*<sii:IDFacturaRectificada>\s*<sii:NumSerieFacturaEmisor>FA-2027-0001<\/sii:NumSerieFacturaEmisor>\s*<sii:FechaExpedicionFacturaEmisor>01-03-2027<\/sii:FechaExpedicionFacturaEmisor>/);
    expect(xml).toContain("<sii:BaseImponible>-100.00</sii:BaseImponible>");
    expect(xml).toContain("<sii:ImporteTotal>-121.00</sii:ImporteTotal>");
    expect(xml).not.toContain("ImporteRectificacion");
  });

  it("R5: rectificativa de una simplificada, sin contraparte", () => {
    const xml = emitidas([issued({
      invoiceType: "CREDIT_NOTE",
      rectificationReason: "R4",
      customer: { name: "Mostrador", taxId: null, countryCode: "ES" },
      lines: [{ description: "Devolución", quantity: -1, unitPrice: 10, taxes: [vat(21)], isService: false }],
      original: { number: "T-1", issueDate: day("2027-03-01"), simplified: true },
    })]);
    expect(validator.validate(xml)).toEqual([]);
    expect(xml).toContain("<sii:TipoFactura>R5</sii:TipoFactura>");
    expect(xml).not.toContain("<sii:Contraparte>");
  });

  it("rectificativa por sustitución: lleva ImporteRectificacion (generador)", () => {
    const { invoice } = mapIssuedInvoice(issued({ invoiceType: "CREDIT_NOTE", rectificationReason: "R1", original: { number: "FA-1", issueDate: day("2027-03-01"), simplified: false } }));
    const xml = buildSuministroLRFacturasEmitidas({
      holder,
      communication: "A0",
      invoices: [{ ...invoice, rectification: { kind: "S", rectified: [{ number: "FA-1", date: "01-03-2027" }], amounts: { base: "100.00", quota: "21.00" } } }],
    });
    expect(validator.validate(xml)).toEqual([]);
    expect(xml).toMatch(/<sii:ImporteRectificacion>\s*<sii:BaseRectificada>100.00<\/sii:BaseRectificada>\s*<sii:CuotaRectificada>21.00<\/sii:CuotaRectificada>/);
  });

  it("escapa los caracteres especiales y recorta los textos a su longitud máxima", () => {
    const xml = emitidas([issued({ customer: { name: `Hnos. "García" & <Hijos> ${"x".repeat(200)}`, taxId: "A58818501", countryCode: "ES" }, lines: [{ description: "y".repeat(700), quantity: 1, unitPrice: 1, taxes: [vat(21)] }] })]);
    expect(validator.validate(xml)).toEqual([]);
    expect(xml).toContain("Hnos. &quot;García&quot; &amp; &lt;Hijos&gt;");
  });

  it("no admite envíos vacíos ni de más de 10.000 registros", () => {
    const { invoice } = mapIssuedInvoice(issued());
    expect(() => buildSuministroLRFacturasEmitidas({ holder, communication: "A0", invoices: [] })).toThrow(/al menos un registro/);
    expect(() => buildSuministroLRFacturasEmitidas({ holder, communication: "A0", invoices: Array.from({ length: SII_MAX_RECORDS_PER_SUBMISSION + 1 }, () => invoice) })).toThrow(/10000/);
    expect(chunkForSubmission(Array.from({ length: 25_001 }, (_, index) => index)).map((chunk) => chunk.length)).toEqual([10_000, 10_000, 5_001]);
  });
});

describe("SuministroLRFacturasRecibidas", () => {
  it("F1 nacional: fecha de registro contable, cuota deducible con % deducible y prorrata, y bien de inversión", () => {
    const xml = recibidas([received({
      prorrataPct: 80,
      lines: [
        { description: "Material", subtotal: "200.00", taxAmount: "42.00", taxRate: "21", taxDeductiblePct: "100" },
        { description: "Vehículo", subtotal: "1000.00", taxAmount: "210.00", taxRate: "21", taxDeductiblePct: "50", isInvestmentGood: true },
        { description: "Libros", subtotal: "100.00", taxAmount: "4.00", taxRate: "4", taxDeductiblePct: "100" },
      ],
    })]);
    expect(validator.validate(xml)).toEqual([]);
    expect(xml).toMatch(/<sii:IDEmisorFactura>\s*<sii:NIF>B85121501<\/sii:NIF>\s*<\/sii:IDEmisorFactura>\s*<sii:NumSerieFacturaEmisor>A\/2027\/55<\/sii:NumSerieFacturaEmisor>\s*<sii:FechaExpedicionFacturaEmisor>08-03-2027</);
    expect(xml).toMatch(/<sii:BaseImponible>1000.00<\/sii:BaseImponible>\s*<sii:CuotaSoportada>210.00<\/sii:CuotaSoportada>\s*<sii:BienInversion>S<\/sii:BienInversion>/);
    expect(xml).toContain("<sii:FechaRegContable>11-03-2027</sii:FechaRegContable>");
    // (42 + 105 + 4) × 80 %
    expect(xml).toContain("<sii:CuotaDeducible>120.80</sii:CuotaDeducible>");
    expect(xml).toContain("<sii:ImporteTotal>1556.00</sii:ImporteTotal>");
    expect(xml).toMatch(/<sii:Contraparte>\s*<sii:NombreRazon>Proveedor SL<\/sii:NombreRazon>\s*<sii:NIF>B85121501<\/sii:NIF>/);
  });

  it("inversión del sujeto pasivo: bloque InversionSujetoPasivo con la cuota autoliquidada al tipo general", () => {
    const xml = recibidas([received({ vatTreatment: "REVERSE_CHARGE", lines: [{ description: "Chatarra", subtotal: "500.00", taxAmount: "0", taxRate: "0", taxDeductiblePct: "100" }] })]);
    expect(validator.validate(xml)).toEqual([]);
    expect(xml).toMatch(/<sii:InversionSujetoPasivo>\s*<sii:DetalleIVA>\s*<sii:TipoImpositivo>21.00<\/sii:TipoImpositivo>\s*<sii:BaseImponible>500.00<\/sii:BaseImponible>\s*<sii:CuotaSoportada>105.00<\/sii:CuotaSoportada>/);
    expect(xml).not.toContain("<sii:DesgloseIVA>");
    expect(xml).not.toContain("<sii:ImporteTotal>");
    expect(xml).toContain("<sii:CuotaDeducible>105.00</sii:CuotaDeducible>");
  });

  it("adquisición intracomunitaria: clave 09, NIF-IVA del proveedor y cuota en DesgloseIVA (sin bloque de inversión)", () => {
    const xml = recibidas([received({
      vatTreatment: "INTRA_EU",
      supplier: { name: "Fournisseur SAS", taxId: "FR12345678901", countryCode: "FR" },
      lines: [{ description: "Componentes", subtotal: "1000.00", taxAmount: "0", taxRate: "21", taxDeductiblePct: "100" }],
    })]);
    expect(validator.validate(xml)).toEqual([]);
    expect(xml).toContain("<sii:ClaveRegimenEspecialOTrascendencia>09</sii:ClaveRegimenEspecialOTrascendencia>");
    expect(xml).toMatch(/<sii:IDEmisorFactura>\s*<sii:IDOtro>\s*<sii:IDType>02<\/sii:IDType>\s*<sii:ID>FR12345678901<\/sii:ID>/);
    expect(xml).not.toContain("<sii:InversionSujetoPasivo>");
    expect(xml).toMatch(/<sii:DesgloseIVA>\s*<sii:DetalleIVA>\s*<sii:TipoImpositivo>21.00<\/sii:TipoImpositivo>\s*<sii:BaseImponible>1000.00<\/sii:BaseImponible>\s*<sii:CuotaSoportada>210.00<\/sii:CuotaSoportada>/);
  });

  it("importación: F5 identificada por el DUA; emisor y contraparte son el titular", () => {
    const mapped = mapReceivedInvoice(received({
      vatTreatment: "IMPORT",
      supplier: { name: "Shenzhen Co", taxId: "91440300", countryCode: "CN" },
      importDuaNumber: "27ES00280112345678",
      importDuaDate: day("2027-03-09"),
      lines: [{ description: "Mercancía importada", subtotal: "2000.00", taxAmount: "420.00", taxRate: "21", taxDeductiblePct: "100" }],
    }));
    expect(mapped.problems).toEqual([]);
    const xml = buildSuministroLRFacturasRecibidas({ holder, communication: "A0", invoices: [mapped.invoice] });
    expect(validator.validate(xml)).toEqual([]);
    expect(xml).toContain("<sii:TipoFactura>F5</sii:TipoFactura>");
    expect(xml).toMatch(/<sii:IDEmisorFactura>\s*<sii:NIF>B12345674<\/sii:NIF>\s*<\/sii:IDEmisorFactura>\s*<sii:NumSerieFacturaEmisor>27ES00280112345678<\/sii:NumSerieFacturaEmisor>\s*<sii:FechaExpedicionFacturaEmisor>09-03-2027</);
    expect(xml).toMatch(/<sii:Contraparte>\s*<sii:NombreRazon>Empresa Demo SL<\/sii:NombreRazon>\s*<sii:NIF>B12345674<\/sii:NIF>/);
  });

  it("importación sin DUA: no se puede suministrar y lo dice", () => {
    expect(mapReceivedInvoice(received({ vatTreatment: "IMPORT" })).problems.join(" ")).toContain("DUA");
  });

  it("rectificativa recibida (documentKind RECTIFICATION) por diferencias con la factura que rectifica", () => {
    const xml = recibidas([received({
      documentKind: "RECTIFICATION",
      supplierDocumentNumber: "AB/7",
      rectified: { number: "A/2027/55", issueDate: day("2027-03-08") },
      lines: [{ description: "Abono", subtotal: "-50.00", taxAmount: "-10.50", taxRate: "21", taxDeductiblePct: "100" }],
    })]);
    expect(validator.validate(xml)).toEqual([]);
    expect(xml).toContain("<sii:TipoFactura>R4</sii:TipoFactura>");
    expect(xml).toMatch(/<sii:TipoRectificativa>I<\/sii:TipoRectificativa>\s*<sii:FacturasRectificadas>\s*<sii:IDFacturaRectificada>\s*<sii:NumSerieFacturaEmisor>A\/2027\/55</);
    expect(xml).toContain("<sii:CuotaDeducible>-10.50</sii:CuotaDeducible>");
  });

  it("simplificada y recargo de equivalencia: cuota deducible cero", () => {
    const simplified = recibidas([received({ isSimplified: true })]);
    expect(validator.validate(simplified)).toEqual([]);
    expect(simplified).toContain("<sii:TipoFactura>F2</sii:TipoFactura>");
    expect(simplified).toContain("<sii:CuotaDeducible>0.00</sii:CuotaDeducible>");
    const withSurcharge = recibidas([received({ lines: [{ description: "Género", subtotal: "100.00", taxAmount: "21.00", taxRate: "21", taxDeductiblePct: "100", surchargeRate: "5.2", surchargeAmount: "5.20" }] })]);
    expect(validator.validate(withSurcharge)).toEqual([]);
    expect(withSurcharge).toMatch(/<sii:TipoRecargoEquivalencia>5.20<\/sii:TipoRecargoEquivalencia>\s*<sii:CuotaRecargoEquivalencia>5.20<\/sii:CuotaRecargoEquivalencia>/);
    expect(withSurcharge).toContain("<sii:CuotaDeducible>0.00</sii:CuotaDeducible>");
  });

  it("línea sin IVA: solo la base; proveedor sin NIF: problema", () => {
    const xml = recibidas([received({ lines: [{ description: "Seguro", subtotal: "300.00", taxAmount: "0", taxRate: "0", taxDeductiblePct: "100" }] })]);
    expect(validator.validate(xml)).toEqual([]);
    expect(xml).toMatch(/<sii:DetalleIVA>\s*<sii:BaseImponible>300.00<\/sii:BaseImponible>\s*<\/sii:DetalleIVA>/);
    expect(mapReceivedInvoice(received({ supplier: { name: "Sin NIF", taxId: null, countryCode: "ES" } })).problems.join(" ")).toContain("no tiene NIF");
  });
});

describe("bajas", () => {
  it("BajaLRFacturasEmitidas: sin TipoComunicacion, con la clave de la factura y la referencia", () => {
    const cancellation = { ...cancellationFor({ book: "ISSUED", invoice: mapIssuedInvoice(issued()).invoice }), refExterna: "rec-1" };
    const xml = buildBajaLRFacturasEmitidas({ holder, cancellations: [cancellation] });
    expect(validator.validate(xml)).toEqual([]);
    expect(xml).not.toContain("TipoComunicacion");
    expect(xml).toMatch(/<siiLR:RegistroLRBajaExpedidas>\s*<sii:PeriodoLiquidacion>[\s\S]*<sii:NIF>B12345674<\/sii:NIF>[\s\S]*<sii:NumSerieFacturaEmisor>FA-2027-0001<[\s\S]*<siiLR:RefExterna>rec-1<\/siiLR:RefExterna>/);
  });

  it("BajaLRFacturasRecibidas: el emisor va con nombre e identificación", () => {
    const xml = buildBajaLRFacturasRecibidas({ holder, cancellations: [cancellationFor({ book: "RECEIVED", invoice: mapReceivedInvoice(received()).invoice })] });
    expect(validator.validate(xml)).toEqual([]);
    expect(xml).toMatch(/<sii:IDEmisorFactura>\s*<sii:NombreRazon>Proveedor SL<\/sii:NombreRazon>\s*<sii:NIF>B85121501<\/sii:NIF>/);
  });
});

describe("criterio de caja (clave 07)", () => {
  const key = (xml: string) => /<sii:ClaveRegimenEspecialOTrascendencia>(\d+)</.exec(xml)?.[1];

  it("expedida nacional de una empresa acogida: clave 07; si la operación está excluida del régimen, su clave ordinaria", () => {
    const xml = emitidas([issued({ cashAccounting: true })]);
    expect(validator.validate(xml)).toEqual([]);
    expect(key(xml)).toBe("07");
    // Inversión del sujeto pasivo (S2), exportación (E2) o entrega intracomunitaria (E5): validación 17 de expedidas.
    expect(mapIssuedInvoice(issued({ cashAccounting: true, vatTreatment: "REVERSE_CHARGE" })).invoice.regimeKey).toBe("01");
    expect(mapIssuedInvoice(issued({ cashAccounting: true, vatTreatment: "EXPORT", customer: { name: "Client Inc", taxId: "123456", countryCode: "US" } })).invoice.regimeKey).toBe("02");
    expect(mapIssuedInvoice(issued({ cashAccounting: true, vatTreatment: "INTRA_EU", customer: { name: "Client GmbH", taxId: "DE123456789", countryCode: "DE" } })).invoice.regimeKey).not.toBe("07");
    expect(mapIssuedInvoice(issued()).invoice.regimeKey).toBe("01");
  });

  it("recibida de un proveedor acogido: clave 07 solo en operaciones nacionales (no con inversión del sujeto pasivo)", () => {
    const xml = recibidas([received({ cashAccounting: true })]);
    expect(validator.validate(xml)).toEqual([]);
    expect(key(xml)).toBe("07");
    expect(mapReceivedInvoice(received({ cashAccounting: true, vatTreatment: "REVERSE_CHARGE", lines: [{ description: "Chatarra", subtotal: "500.00", taxAmount: "0", taxRate: "0", taxDeductiblePct: "100" }] })).invoice.regimeKey).toBe("01");
  });

  const movement = { date: "15-04-2027", amount: "121.00", method: "01" as const, account: "ES9121000418450200051332" };

  it("SuministroLRCobrosEmitidas: cabecera sin TipoComunicacion; los cobros de una factura en un único registro", () => {
    const xml = buildSuministroLRCobrosEmitidas({
      holder,
      records: [
        { issuer: { nif: "B12345674" }, number: "FA-2027-0001", issueDate: "10-03-2027", movements: [movement] },
        { issuer: { nif: "B12345674" }, number: "FA-2027-0001", issueDate: "10-03-2027", movements: [{ date: "31-12-2028", amount: "10.00", method: "03", account: "no debe salir" }] },
        { issuer: { nif: "B12345674" }, number: "FA-2027-0002", issueDate: "11-03-2027", movements: [{ ...movement, amount: "-121.00" }, { ...movement, date: "16-04-2027" }] },
      ],
    });
    expect(validator.validate(xml)).toEqual([]);
    expect(xml).not.toContain("TipoComunicacion");
    expect(xml.match(/<siiLR:RegistroLRCobros>/g)).toHaveLength(2);
    expect(xml).toMatch(/<siiLR:IDFactura>\s*<sii:IDEmisorFactura>\s*<sii:NIF>B12345674<\/sii:NIF>\s*<\/sii:IDEmisorFactura>\s*<sii:NumSerieFacturaEmisor>FA-2027-0001</);
    expect(xml).toMatch(/<sii:Cobro>\s*<sii:Fecha>15-04-2027<\/sii:Fecha>\s*<sii:Importe>121.00<\/sii:Importe>\s*<sii:Medio>01<\/sii:Medio>\s*<sii:Cuenta_O_Medio>ES9121000418450200051332</);
    // Con el medio 03 no se admite la cuenta (error 1152).
    expect(xml).toMatch(/<sii:Medio>03<\/sii:Medio>\s*<\/sii:Cobro>/);
    expect(xml).toContain("<sii:Importe>-121.00</sii:Importe>");
  });

  it("SuministroLRPagosRecibidas: el emisor va con nombre e identificación", () => {
    const xml = buildSuministroLRPagosRecibidas({
      holder,
      records: [{ issuer: { name: "Proveedor SL", nif: "B85121501" }, number: "A/2027/55", issueDate: "08-03-2027", movements: [{ date: "20-04-2027", amount: "242.00", method: "05" }] }],
    });
    expect(validator.validate(xml)).toEqual([]);
    expect(xml).toMatch(/<siiLR:RegistroLRPagos>\s*<siiLR:IDFactura>\s*<sii:IDEmisorFactura>\s*<sii:NombreRazon>Proveedor SL<\/sii:NombreRazon>\s*<sii:NIF>B85121501</);
    expect(xml).toMatch(/<sii:Pago>\s*<sii:Fecha>20-04-2027<\/sii:Fecha>\s*<sii:Importe>242.00<\/sii:Importe>\s*<sii:Medio>05<\/sii:Medio>\s*<\/sii:Pago>/);
    expect(() => buildSuministroLRPagosRecibidas({ holder, records: [{ issuer: { nif: "B85121501" }, number: "X", issueDate: "08-03-2027", movements: [movement] }] })).toThrow(/nombre del emisor/);
  });
});

describe("libro de bienes de inversión", () => {
  const goods = mapInvestmentGoods([{
    lineId: "line-1", invoiceId: "sup-1", number: "FR-1", description: "Máquina cortadora", purchaseYear: 2026, baseCents: 1_000_000, vatCents: 210_000,
    deductiblePct: 100, appliedProrrataPct: 80, realEstate: false, issuer: { name: "Proveedor SL", nif: "B85121501" },
    invoiceNumber: "A/2026/7", invoiceIssueDate: "10-03-2026", accountingDate: "12-03-2026",
  }], { year: 2027, finalPct: 50, finalByYear: { 2026: 80 } }).map((entry) => ({ ...entry.good, refExterna: "rec-bi-1" }));

  it("SuministroLRBienesInversion: periodo 0A, factura de compra y apunte con prorrata y regularización", () => {
    const xml = buildSuministroLRBienesInversion({ holder, communication: "A0", goods });
    expect(validator.validate(xml)).toEqual([]);
    expect(xml).toContain("<sii:TipoComunicacion>A0</sii:TipoComunicacion>");
    expect(xml).toMatch(/<sii:PeriodoLiquidacion>\s*<sii:Ejercicio>2027<\/sii:Ejercicio>\s*<sii:Periodo>0A<\/sii:Periodo>/);
    expect(xml).toMatch(/<sii:IDEmisorFactura>\s*<sii:NombreRazon>Proveedor SL<\/sii:NombreRazon>\s*<sii:NIF>B85121501</);
    expect(xml).toMatch(/<siiLR:BienesInversion>\s*<sii:IdentificacionBien>Máquina cortadora<\/sii:IdentificacionBien>\s*<sii:FechaInicioUtilizacion>12-03-2026<\/sii:FechaInicioUtilizacion>\s*<sii:ProrrataAnualDefinitiva>50.00<\/sii:ProrrataAnualDefinitiva>\s*<sii:RegularizacionAnualDeduccion>-126.00<\/sii:RegularizacionAnualDeduccion>\s*<sii:RefExterna>rec-bi-1</);
    expect(validator.validate(buildSuministroLRBienesInversion({ holder, communication: "A1", goods: [{ ...goods[0], annualRegularization: null }] }))).toEqual([]);
  });

  it("BajaLRBienesInversion: ejercicio, factura e identificación del bien", () => {
    const xml = buildBajaLRBienesInversion({ holder, goods });
    expect(validator.validate(xml)).toEqual([]);
    expect(xml).not.toContain("TipoComunicacion");
    expect(xml).toMatch(/<siiLR:IdentificacionBien>Máquina cortadora<\/siiLR:IdentificacionBien>\s*<siiLR:RefExterna>rec-bi-1</);
  });
});

describe("sobre SOAP y respuesta", () => {
  it("envuelve el mensaje en un sobre SOAP 1.1", () => {
    const envelope = buildSoapEnvelope(emitidas([issued()]));
    expect(envelope.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(envelope).toContain('<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">');
    expect(envelope).toMatch(/<soapenv:Body>\s*<siiLR:SuministroLRFacturasEmitidas /);
  });

  const response = `<?xml version="1.0" encoding="UTF-8"?>
<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Header/><env:Body>
<siiR:RespuestaLRFacturasEmitidas xmlns:siiR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/ssii/fact/ws/RespuestaSuministro.xsd" xmlns:sii="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/ssii/fact/ws/SuministroInformacion.xsd">
<siiR:CSV>CSVGLOBAL123</siiR:CSV>
<siiR:DatosPresentacion><sii:NIFPresentador>B12345674</sii:NIFPresentador><sii:TimestampPresentacion>10-03-2027 12:00:00</sii:TimestampPresentacion></siiR:DatosPresentacion>
<siiR:Cabecera><sii:IDVersionSii>1.1</sii:IDVersionSii><sii:Titular><sii:NombreRazon>Empresa Demo SL</sii:NombreRazon><sii:NIF>B12345674</sii:NIF></sii:Titular><sii:TipoComunicacion>A0</sii:TipoComunicacion></siiR:Cabecera>
<siiR:EstadoEnvio>ParcialmenteCorrecto</siiR:EstadoEnvio>
<siiR:RespuestaLinea><siiR:IDFactura><sii:IDEmisorFactura><sii:NIF>B12345674</sii:NIF></sii:IDEmisorFactura><sii:NumSerieFacturaEmisor>FA-1</sii:NumSerieFacturaEmisor><sii:FechaExpedicionFacturaEmisor>10-03-2027</sii:FechaExpedicionFacturaEmisor></siiR:IDFactura><siiR:RefExterna>rec-1</siiR:RefExterna><siiR:EstadoRegistro>Correcto</siiR:EstadoRegistro><siiR:CSV>CSVLINEA1</siiR:CSV></siiR:RespuestaLinea>
<siiR:RespuestaLinea><siiR:IDFactura><sii:IDEmisorFactura><sii:NIF>B12345674</sii:NIF></sii:IDEmisorFactura><sii:NumSerieFacturaEmisor>FA-2</sii:NumSerieFacturaEmisor><sii:FechaExpedicionFacturaEmisor>10-03-2027</sii:FechaExpedicionFacturaEmisor></siiR:IDFactura><siiR:EstadoRegistro>AceptadoConErrores</siiR:EstadoRegistro><siiR:CodigoErrorRegistro>2011</siiR:CodigoErrorRegistro><siiR:DescripcionErrorRegistro>El NIF de la contraparte no está identificado &amp; censado</siiR:DescripcionErrorRegistro></siiR:RespuestaLinea>
<siiR:RespuestaLinea><siiR:IDFactura><sii:IDEmisorFactura><sii:NIF>B12345674</sii:NIF></sii:IDEmisorFactura><sii:NumSerieFacturaEmisor>FA-3</sii:NumSerieFacturaEmisor><sii:FechaExpedicionFacturaEmisor>10-03-2027</sii:FechaExpedicionFacturaEmisor></siiR:IDFactura><siiR:EstadoRegistro>Incorrecto</siiR:EstadoRegistro><siiR:CodigoErrorRegistro>3000</siiR:CodigoErrorRegistro><siiR:DescripcionErrorRegistro>Factura duplicada</siiR:DescripcionErrorRegistro><siiR:RegistroDuplicado><sii:EstadoRegistro>Correcta</sii:EstadoRegistro></siiR:RegistroDuplicado></siiR:RespuestaLinea>
</siiR:RespuestaLRFacturasEmitidas></env:Body></env:Envelope>`;

  it("la respuesta de ejemplo cumple RespuestaSuministro.xsd", () => {
    const body = /<siiR:RespuestaLRFacturasEmitidas[\s\S]*<\/siiR:RespuestaLRFacturasEmitidas>/.exec(response)![0];
    expect(validator.validate(body)).toEqual([]);
  });

  it("lee el resultado por línea: correcto, aceptado con errores, incorrecto y duplicado", () => {
    const parsed = parseSiiResponse(response);
    expect(parsed).toMatchObject({ csv: "CSVGLOBAL123", submissionStatus: "ParcialmenteCorrecto", fault: null });
    expect(parsed.lines).toEqual([
      { invoiceNumber: "FA-1", issueDate: "10-03-2027", refExterna: "rec-1", status: "Correcto", errorCode: null, errorMessage: null, csv: "CSVLINEA1", duplicateStatus: null },
      { invoiceNumber: "FA-2", issueDate: "10-03-2027", refExterna: null, status: "AceptadoConErrores", errorCode: "2011", errorMessage: "El NIF de la contraparte no está identificado & censado", csv: null, duplicateStatus: null },
      { invoiceNumber: "FA-3", issueDate: "10-03-2027", refExterna: null, status: "Incorrecto", errorCode: "3000", errorMessage: "Factura duplicada", csv: null, duplicateStatus: "Correcta" },
    ]);
  });

  it("lee un SOAP Fault (rechazo del envío completo) con su código", () => {
    const parsed = parseSiiResponse('<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body><env:Fault><faultcode>env:Client</faultcode><faultstring>Codigo[4102].El XML no cumple el esquema. Falta informar campo obligatorio.: Cabecera</faultstring></env:Fault></env:Body></env:Envelope>');
    expect(parsed.fault).toContain("no cumple el esquema");
    expect(parsed.faultCode).toBe("4102");
    expect(parsed.lines).toEqual([]);
    expect(parsed.submissionStatus).toBeNull();
  });
});
