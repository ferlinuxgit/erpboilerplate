import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { getVerifactuSystemInfo } from "@/server/verifactu/config";
import { outcomeForLine, retryDelayMs } from "@/server/verifactu/sender";
import { buildRecordsExportXml, buildRegFactuSoapEnvelope, parseAeatResponse, SUMINISTRO_INFORMACION_NS, SUMINISTRO_LR_NS, type XmlRecord } from "@/server/verifactu/xml";

const systemInfo = getVerifactuSystemInfo("company-1", { VERIFACTU_PRODUCER_NIF: "B00000000", VERIFACTU_PRODUCER_NAME: "Software SL" });

const first: XmlRecord = {
  recordType: "ALTA",
  issuerTaxId: "89890001K",
  issuerName: "Empresa & Hijos S.L.",
  invoiceNumber: "12345678/G33",
  invoiceIssueDate: "01-01-2024",
  invoiceTypeCode: "F1",
  rectificationKind: null,
  rectifiedInvoices: null,
  description: "Servicios <profesionales>",
  recipient: { name: "Cliente SL", taxId: "B12345678", countryCode: "ES", idType: null },
  breakdown: [{ Impuesto: "01", ClaveRegimen: "01", CalificacionOperacion: "S1", TipoImpositivo: "21.00", BaseImponibleOimporteNoSujeto: "102.07", CuotaRepercutida: "21.43" }],
  taxAmount: "21.43",
  totalAmount: "123.50",
  previousIssuerTaxId: null,
  previousInvoiceNumber: null,
  previousInvoiceIssueDate: null,
  previousHash: null,
  hash: "3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60",
  generatedAtText: "2024-01-01T19:20:30+01:00",
  systemInfo,
};

const creditNote: XmlRecord = {
  ...first,
  invoiceNumber: "R-000001",
  invoiceTypeCode: "R4",
  rectificationKind: "I",
  rectifiedInvoices: [{ issuerTaxId: "89890001K", invoiceNumber: "12345678/G33", invoiceIssueDate: "01-01-2024" }],
  recipient: { name: "GmbH", taxId: "DE123456789", countryCode: "DE", idType: "02" },
  breakdown: [{ Impuesto: "01", ClaveRegimen: "01", OperacionExenta: "E5", BaseImponibleOimporteNoSujeto: "-10.00" }],
  taxAmount: "0.00",
  totalAmount: "-10.00",
  previousIssuerTaxId: "89890001K",
  previousInvoiceNumber: "12345678/G33",
  previousInvoiceIssueDate: "01-01-2024",
  previousHash: first.hash,
  hash: "F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97",
  generatedAtText: "2024-01-01T19:20:35+01:00",
};

const annulment: XmlRecord = {
  ...creditNote,
  recordType: "ANULACION",
  previousInvoiceNumber: "R-000001",
  previousHash: creditNote.hash,
  hash: "177547C0D57AC74748561D054A9CEC14B4C4EA23D1BEFD6F2E69E3A388F90C68",
};

function elementOrder(xml: string, parent: string) {
  const block = new RegExp(`<sum1:${parent}>([\\s\\S]*?)</sum1:${parent}>`).exec(xml)?.[1] ?? "";
  const names: string[] = [];
  let depth = 0;
  for (const match of block.matchAll(/<(\/?)sum1:([A-Za-z]+)[^>]*?(\/?)>/g)) {
    if (match[1]) { depth -= 1; continue; }
    if (depth === 0) names.push(match[2]);
    if (!match[3]) depth += 1;
  }
  return names;
}

describe("VeriFactu XML (RegFactuSistemaFacturacion)", () => {
  const xml = buildRegFactuSoapEnvelope({ issuer: { name: first.issuerName, taxId: first.issuerTaxId }, records: [first, creditNote, annulment] });

  it("wraps the records in a SOAP envelope with the AEAT namespaces and header", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain(`xmlns:sum="${SUMINISTRO_LR_NS}"`);
    expect(xml).toContain(`xmlns:sum1="${SUMINISTRO_INFORMACION_NS}"`);
    expect(xml).toMatch(/<sum:Cabecera>\s*<sum1:ObligadoEmision>\s*<sum1:NombreRazon>Empresa &amp; Hijos S\.L\.<\/sum1:NombreRazon>\s*<sum1:NIF>89890001K<\/sum1:NIF>/);
    expect(xml.match(/<sum:RegistroFactura>/g)).toHaveLength(3);
  });

  it("emits RegistroAlta elements in XSD order and escapes text", () => {
    expect(elementOrder(xml, "RegistroAlta")).toEqual([
      "IDVersion",
      "IDFactura",
      "NombreRazonEmisor",
      "TipoFactura",
      "DescripcionOperacion",
      "Destinatarios",
      "Desglose",
      "CuotaTotal",
      "ImporteTotal",
      "Encadenamiento",
      "SistemaInformatico",
      "FechaHoraHusoGenRegistro",
      "TipoHuella",
      "Huella",
    ]);
    expect(xml).toContain("<sum1:DescripcionOperacion>Servicios &lt;profesionales&gt;</sum1:DescripcionOperacion>");
    expect(xml).toMatch(/<sum1:Encadenamiento>\s*<sum1:PrimerRegistro>S<\/sum1:PrimerRegistro>/);
    expect(xml).toMatch(/<sum1:DetalleDesglose>\s*<sum1:Impuesto>01<\/sum1:Impuesto>\s*<sum1:ClaveRegimen>01<\/sum1:ClaveRegimen>\s*<sum1:CalificacionOperacion>S1<\/sum1:CalificacionOperacion>\s*<sum1:TipoImpositivo>21\.00<\/sum1:TipoImpositivo>\s*<sum1:BaseImponibleOimporteNoSujeto>102\.07<\/sum1:BaseImponibleOimporteNoSujeto>\s*<sum1:CuotaRepercutida>21\.43<\/sum1:CuotaRepercutida>/);
    expect(xml).toMatch(/<sum1:TipoHuella>01<\/sum1:TipoHuella>\s*<sum1:Huella>3C464DAF/);
    expect(xml).toMatch(/<sum1:SistemaInformatico>\s*<sum1:NombreRazon>Software SL<\/sum1:NombreRazon>\s*<sum1:NIF>B00000000<\/sum1:NIF>\s*<sum1:NombreSistemaInformatico>/);
  });

  it("chains to the previous record and describes rectifications and foreign recipients", () => {
    expect(xml).toMatch(/<sum1:TipoFactura>R4<\/sum1:TipoFactura>\s*<sum1:TipoRectificativa>I<\/sum1:TipoRectificativa>\s*<sum1:FacturasRectificadas>\s*<sum1:IDFacturaRectificada>\s*<sum1:IDEmisorFactura>89890001K/);
    expect(xml).toMatch(/<sum1:IDOtro>\s*<sum1:CodigoPais>DE<\/sum1:CodigoPais>\s*<sum1:IDType>02<\/sum1:IDType>\s*<sum1:ID>DE123456789<\/sum1:ID>/);
    expect(xml).toMatch(/<sum1:RegistroAnterior>\s*<sum1:IDEmisorFactura>89890001K<\/sum1:IDEmisorFactura>\s*<sum1:NumSerieFactura>12345678\/G33<\/sum1:NumSerieFactura>\s*<sum1:FechaExpedicionFactura>01-01-2024<\/sum1:FechaExpedicionFactura>\s*<sum1:Huella>3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60<\/sum1:Huella>/);
    expect(xml).toContain("<sum1:OperacionExenta>E5</sum1:OperacionExenta>");
  });

  it("builds RegistroAnulacion with the *Anulada identifiers", () => {
    expect(elementOrder(xml, "RegistroAnulacion")).toEqual(["IDVersion", "IDFactura", "Encadenamiento", "SistemaInformatico", "FechaHoraHusoGenRegistro", "TipoHuella", "Huella"]);
    expect(xml).toMatch(/<sum1:IDEmisorFacturaAnulada>89890001K<\/sum1:IDEmisorFacturaAnulada>\s*<sum1:NumSerieFacturaAnulada>R-000001<\/sum1:NumSerieFacturaAnulada>\s*<sum1:FechaExpedicionFacturaAnulada>01-01-2024/);
  });

  it("is well-formed (balanced tags)", () => {
    const stack: string[] = [];
    for (const match of xml.matchAll(/<(\/?)([A-Za-z0-9]+:[A-Za-z]+)[^>]*?(\/?)>/g)) {
      if (match[3]) continue;
      if (match[1]) expect(stack.pop()).toBe(match[2]);
      else stack.push(match[2]);
    }
    expect(stack).toEqual([]);
  });

  it("rejects empty or oversized submissions", () => {
    expect(() => buildRegFactuSoapEnvelope({ issuer: { name: "x", taxId: "y" }, records: [] })).toThrow();
    expect(() => buildRegFactuSoapEnvelope({ issuer: { name: "x", taxId: "y" }, records: Array.from({ length: 1001 }, () => first) })).toThrow();
  });

  it("exports records without the SOAP envelope", () => {
    const exported = buildRecordsExportXml({ issuer: { name: "Empresa", taxId: "89890001K" }, records: [first] });
    expect(exported).toContain('<sum1:RegistrosFacturacion');
    expect(exported).not.toContain("soapenv");
  });
});

describe("AEAT response", () => {
  const response = `<?xml version="1.0" encoding="UTF-8"?>
<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body>
<tikR:RespuestaRegFactuSistemaFacturacion xmlns:tikR="x" xmlns:tik="y">
  <tikR:CSV>A-ABCDEF123456</tikR:CSV>
  <tikR:TiempoEsperaEnvio>60</tikR:TiempoEsperaEnvio>
  <tikR:EstadoEnvio>ParcialmenteCorrecto</tikR:EstadoEnvio>
  <tikR:RespuestaLinea>
    <tikR:IDFactura><tik:IDEmisorFactura>89890001K</tik:IDEmisorFactura><tik:NumSerieFactura>12345678/G33</tik:NumSerieFactura><tik:FechaExpedicionFactura>01-01-2024</tik:FechaExpedicionFactura></tikR:IDFactura>
    <tikR:Operacion><tik:TipoOperacion>Alta</tik:TipoOperacion></tikR:Operacion>
    <tikR:EstadoRegistro>Correcto</tikR:EstadoRegistro>
  </tikR:RespuestaLinea>
  <tikR:RespuestaLinea>
    <tikR:IDFactura><tik:IDEmisorFactura>89890001K</tik:IDEmisorFactura><tik:NumSerieFactura>R-000001</tik:NumSerieFactura><tik:FechaExpedicionFactura>01-01-2024</tik:FechaExpedicionFactura></tikR:IDFactura>
    <tikR:Operacion><tik:TipoOperacion>Alta</tik:TipoOperacion></tikR:Operacion>
    <tikR:EstadoRegistro>Incorrecto</tikR:EstadoRegistro>
    <tikR:CodigoErrorRegistro>1100</tikR:CodigoErrorRegistro>
    <tikR:DescripcionErrorRegistro>Valor o tipo incorrecto &amp; más</tikR:DescripcionErrorRegistro>
  </tikR:RespuestaLinea>
</tikR:RespuestaRegFactuSistemaFacturacion></env:Body></env:Envelope>`;

  it("parses CSV, wait time and per-record results", () => {
    const parsed = parseAeatResponse(response);
    expect(parsed.csv).toBe("A-ABCDEF123456");
    expect(parsed.waitSeconds).toBe(60);
    expect(parsed.submissionStatus).toBe("ParcialmenteCorrecto");
    expect(parsed.lines).toEqual([
      { invoiceNumber: "12345678/G33", operation: "Alta", status: "Correcto", errorCode: null, errorMessage: null },
      { invoiceNumber: "R-000001", operation: "Alta", status: "Incorrecto", errorCode: "1100", errorMessage: "Valor o tipo incorrecto & más" },
    ]);
  });

  it("parses SOAP faults", () => {
    expect(parseAeatResponse("<soap:Envelope><soap:Body><soap:Fault><faultcode>env:Client</faultcode><faultstring>Certificado no válido</faultstring></soap:Fault></soap:Body></soap:Envelope>").fault).toBe("Certificado no válido");
  });

  it("maps AEAT line states to record statuses (duplicates count as accepted)", () => {
    expect(outcomeForLine({ invoiceNumber: "x", operation: "Alta", status: "Correcto", errorCode: null, errorMessage: null }).status).toBe("ACCEPTED");
    expect(outcomeForLine({ invoiceNumber: "x", operation: "Alta", status: "AceptadoConErrores", errorCode: "2000", errorMessage: "aviso" }).status).toBe("ACCEPTED_WITH_ERRORS");
    expect(outcomeForLine({ invoiceNumber: "x", operation: "Alta", status: "Incorrecto", errorCode: "1100", errorMessage: "mal" }).status).toBe("REJECTED");
    expect(outcomeForLine({ invoiceNumber: "x", operation: "Alta", status: "Incorrecto", errorCode: "3000", errorMessage: "duplicado" }).status).toBe("ACCEPTED");
    expect(outcomeForLine(undefined).status).toBe("SENT");
  });

  it("backs off exponentially up to 6 hours", () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(3)).toBe(240_000);
    expect(retryDelayMs(50)).toBe(6 * 60 * 60_000);
  });
});
