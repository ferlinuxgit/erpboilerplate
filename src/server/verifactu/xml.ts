/**
 * XML de remisión VERI*FACTU: mensaje SOAP `RegFactuSistemaFacturacion` (SuministroLR.xsd) con
 * registros `RegistroAlta` / `RegistroAnulacion` (SuministroInformacion.xsd, versión 1.0).
 * El orden de los elementos sigue la secuencia del XSD; los opcionales vacíos no se emiten.
 */

export const SUMINISTRO_LR_NS =
  "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd";
export const SUMINISTRO_INFORMACION_NS =
  "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd";
export const SOAP_ENV_NS = "http://schemas.xmlsoap.org/soap/envelope/";

/** Máximo de registros por envío (AEAT). */
export const MAX_RECORDS_PER_SUBMISSION = 1000;

export type XmlRecord = {
  recordType: string;
  issuerTaxId: string;
  issuerName: string;
  invoiceNumber: string;
  invoiceIssueDate: string;
  invoiceTypeCode: string | null;
  rectificationKind: string | null;
  rectifiedInvoices: Array<{ issuerTaxId: string; invoiceNumber: string; invoiceIssueDate: string }> | null;
  description: string | null;
  recipient: { name: string; taxId: string | null; countryCode: string | null; idType: string | null } | null;
  breakdown: Array<Record<string, string>> | null;
  taxAmount: string | null;
  totalAmount: string | null;
  previousIssuerTaxId: string | null;
  previousInvoiceNumber: string | null;
  previousInvoiceIssueDate: string | null;
  previousHash: string | null;
  hash: string;
  generatedAtText: string;
  systemInfo: Record<string, string>;
};

export function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

type Node = [string, string | Node[] | null | undefined];

function render(nodes: Node[], prefix: string, indent: string): string {
  return nodes
    .filter(([, value]) => value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0))
    .map(([name, value]) => {
      if (Array.isArray(value)) {
        return `${indent}<${prefix}:${name}>\n${render(value, prefix, `${indent}  `)}\n${indent}</${prefix}:${name}>`;
      }
      return `${indent}<${prefix}:${name}>${escapeXml(String(value))}</${prefix}:${name}>`;
    })
    .join("\n");
}

const BREAKDOWN_ORDER = [
  "Impuesto",
  "ClaveRegimen",
  "CalificacionOperacion",
  "OperacionExenta",
  "TipoImpositivo",
  "BaseImponibleOimporteNoSujeto",
  "BaseImponibleACoste",
  "CuotaRepercutida",
  "TipoRecargoEquivalencia",
  "CuotaRecargoEquivalencia",
];

const SYSTEM_ORDER = [
  "NombreRazon",
  "NIF",
  "NombreSistemaInformatico",
  "IdSistemaInformatico",
  "Version",
  "NumeroInstalacion",
  "TipoUsoPosibleSoloVerifactu",
  "TipoUsoPosibleMultiOT",
  "IndicadorMultiplesOT",
];

function chaining(record: XmlRecord): Node[] {
  if (!record.previousHash) return [["PrimerRegistro", "S"]];
  return [[
    "RegistroAnterior",
    [
      ["IDEmisorFactura", record.previousIssuerTaxId],
      ["NumSerieFactura", record.previousInvoiceNumber],
      ["FechaExpedicionFactura", record.previousInvoiceIssueDate],
      ["Huella", record.previousHash],
    ],
  ]];
}

function systemInfo(record: XmlRecord): Node[] {
  return SYSTEM_ORDER.map((key) => [key, record.systemInfo[key] || null] as Node);
}

function recipient(record: XmlRecord): Node[] | null {
  const value = record.recipient;
  if (!value?.taxId) return null;
  const identification: Node[] = value.idType
    ? [["IDOtro", [["CodigoPais", value.countryCode], ["IDType", value.idType], ["ID", value.taxId]]]]
    : [["NIF", value.taxId]];
  return [["IDDestinatario", [["NombreRazon", value.name.slice(0, 120)], ...identification]]];
}

function altaNodes(record: XmlRecord): Node[] {
  return [
    ["IDVersion", "1.0"],
    ["IDFactura", [
      ["IDEmisorFactura", record.issuerTaxId],
      ["NumSerieFactura", record.invoiceNumber],
      ["FechaExpedicionFactura", record.invoiceIssueDate],
    ]],
    ["NombreRazonEmisor", record.issuerName],
    ["TipoFactura", record.invoiceTypeCode],
    ["TipoRectificativa", record.rectificationKind],
    ["FacturasRectificadas", record.rectifiedInvoices?.map((original) => [
      "IDFacturaRectificada",
      [
        ["IDEmisorFactura", original.issuerTaxId],
        ["NumSerieFactura", original.invoiceNumber],
        ["FechaExpedicionFactura", original.invoiceIssueDate],
      ],
    ] as Node) ?? null],
    ["DescripcionOperacion", record.description ?? ""],
    ["Destinatarios", recipient(record)],
    ["Desglose", (record.breakdown ?? []).map((line) => [
      "DetalleDesglose",
      BREAKDOWN_ORDER.map((key) => [key, line[key] ?? null] as Node),
    ] as Node)],
    ["CuotaTotal", record.taxAmount],
    ["ImporteTotal", record.totalAmount],
    ["Encadenamiento", chaining(record)],
    ["SistemaInformatico", systemInfo(record)],
    ["FechaHoraHusoGenRegistro", record.generatedAtText],
    ["TipoHuella", "01"],
    ["Huella", record.hash],
  ];
}

function anulacionNodes(record: XmlRecord): Node[] {
  return [
    ["IDVersion", "1.0"],
    ["IDFactura", [
      ["IDEmisorFacturaAnulada", record.issuerTaxId],
      ["NumSerieFacturaAnulada", record.invoiceNumber],
      ["FechaExpedicionFacturaAnulada", record.invoiceIssueDate],
    ]],
    ["Encadenamiento", chaining(record)],
    ["SistemaInformatico", systemInfo(record)],
    ["FechaHoraHusoGenRegistro", record.generatedAtText],
    ["TipoHuella", "01"],
    ["Huella", record.hash],
  ];
}

/** Un registro (RegistroAlta o RegistroAnulacion) con prefijo `sum1`. */
export function buildRecordXml(record: XmlRecord, indent = "") {
  const element = record.recordType === "ANULACION" ? "RegistroAnulacion" : "RegistroAlta";
  const nodes = record.recordType === "ANULACION" ? anulacionNodes(record) : altaNodes(record);
  return `${indent}<sum1:${element}>\n${render(nodes, "sum1", `${indent}  `)}\n${indent}</sum1:${element}>`;
}

/** Mensaje SOAP completo de remisión para un obligado a expedir (todas las facturas del mismo NIF). */
export function buildRegFactuSoapEnvelope(input: { issuer: { name: string; taxId: string }; records: XmlRecord[] }) {
  if (input.records.length === 0) throw new Error("No hay registros que enviar.");
  if (input.records.length > MAX_RECORDS_PER_SUBMISSION) throw new Error(`Máximo ${MAX_RECORDS_PER_SUBMISSION} registros por envío.`);
  const header = render([["ObligadoEmision", [["NombreRazon", input.issuer.name.slice(0, 120)], ["NIF", input.issuer.taxId]]]], "sum1", "        ");
  const records = input.records
    .map((record) => `        <sum:RegistroFactura>\n${buildRecordXml(record, "          ")}\n        </sum:RegistroFactura>`)
    .join("\n");
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<soapenv:Envelope xmlns:soapenv="${SOAP_ENV_NS}" xmlns:sum="${SUMINISTRO_LR_NS}" xmlns:sum1="${SUMINISTRO_INFORMACION_NS}">`,
    `  <soapenv:Header/>`,
    `  <soapenv:Body>`,
    `    <sum:RegFactuSistemaFacturacion>`,
    `      <sum:Cabecera>`,
    header,
    `      </sum:Cabecera>`,
    records,
    `    </sum:RegFactuSistemaFacturacion>`,
    `  </soapenv:Body>`,
    `</soapenv:Envelope>`,
  ].join("\n");
}

/** Exportación XML (sin sobre SOAP) de los registros de una empresa, para conservación o inspección. */
export function buildRecordsExportXml(input: { issuer: { name: string; taxId: string }; records: XmlRecord[] }) {
  const records = input.records.map((record) => buildRecordXml(record, "  ")).join("\n");
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<sum1:RegistrosFacturacion xmlns:sum1="${SUMINISTRO_INFORMACION_NS}" NIF="${escapeXml(input.issuer.taxId)}" NombreRazon="${escapeXml(input.issuer.name)}">`,
    records,
    `</sum1:RegistrosFacturacion>`,
  ].join("\n");
}

export type AeatLineResult = {
  invoiceNumber: string | null;
  operation: string | null;
  status: "Correcto" | "AceptadoConErrores" | "Incorrecto" | string;
  errorCode: string | null;
  errorMessage: string | null;
};

export type AeatSubmissionResponse = {
  csv: string | null;
  submissionStatus: string | null;
  waitSeconds: number | null;
  lines: AeatLineResult[];
  fault: string | null;
};

function firstTag(xml: string, tag: string) {
  const match = new RegExp(`<(?:[A-Za-z0-9_]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${tag}>`).exec(xml);
  return match ? decodeXml(match[1].trim()) : null;
}

function allBlocks(xml: string, tag: string) {
  const pattern = new RegExp(`<(?:[A-Za-z0-9_]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${tag}>`, "g");
  return [...xml.matchAll(pattern)].map((match) => match[1]);
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Lee la respuesta RespuestaRegFactuSistemaFacturacion (o un SOAP Fault). */
export function parseAeatResponse(xml: string): AeatSubmissionResponse {
  const fault = firstTag(xml, "faultstring");
  const wait = firstTag(xml, "TiempoEsperaEnvio");
  return {
    csv: firstTag(xml, "CSV"),
    submissionStatus: firstTag(xml, "EstadoEnvio"),
    waitSeconds: wait !== null && Number.isFinite(Number(wait)) ? Number(wait) : null,
    fault,
    lines: allBlocks(xml, "RespuestaLinea").map((block) => ({
      invoiceNumber: firstTag(block, "NumSerieFactura"),
      operation: firstTag(block, "TipoOperacion"),
      status: firstTag(block, "EstadoRegistro") ?? "Incorrecto",
      errorCode: firstTag(block, "CodigoErrorRegistro"),
      errorMessage: firstTag(block, "DescripcionErrorRegistro"),
    })),
  };
}
