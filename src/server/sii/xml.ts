/**
 * Generadores PUROS de los mensajes del SII (versión 1.1, esquemas `SuministroLR.xsd` y
 * `SuministroInformacion.xsd` de la AEAT) y lectura de sus respuestas (`RespuestaSuministro.xsd`).
 *
 * El orden de los elementos es el de las secuencias del XSD: no se puede alterar. Los tests
 * (`xml.test.ts`) validan cada mensaje contra los XSD oficiales guardados en `test-fixtures/`.
 */
import type {
  SiiCancellation,
  SiiCashMovement,
  SiiCashRecord,
  SiiHolder,
  SiiInvestmentGood,
  SiiIssuedBreakdown,
  SiiIssuedInvoice,
  SiiParty,
  SiiPartyId,
  SiiReceivedInvoice,
  SiiRectification,
  SiiVatDetail,
} from "@/server/sii/types";

const SII_WS_BASE = "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/ssii/fact/ws";
export const SII_LR_NS = `${SII_WS_BASE}/SuministroLR.xsd`;
export const SII_INFO_NS = `${SII_WS_BASE}/SuministroInformacion.xsd`;
export const SOAP_ENV_NS = "http://schemas.xmlsoap.org/soap/envelope/";

/** IDVersionSii: único valor que admite el esquema vigente. */
export const SII_VERSION = "1.1";
/** Máximo de registros por envío (maxOccurs del XSD). */
export const SII_MAX_RECORDS_PER_SUBMISSION = 10_000;

/** A0 alta, A1 modificación. Las bajas van en un mensaje propio sin TipoComunicacion. */
export type SiiCommunicationType = "A0" | "A1";

export function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Nodo: [prefijo:nombre, texto | hijos]. Los nulos, vacíos y listas sin hijos no se escriben. */
type Node = [string, string | Node[] | null | undefined];

function isEmpty(value: Node[1]): boolean {
  if (value === null || value === undefined || value === "") return true;
  return Array.isArray(value) && value.every(([, child]) => isEmpty(child));
}

function render(nodes: Node[], indent: string): string {
  return nodes
    .filter(([, value]) => !isEmpty(value))
    .map(([name, value]) => (Array.isArray(value)
      ? `${indent}<${name}>\n${render(value, `${indent}  `)}\n${indent}</${name}>`
      : `${indent}<${name}>${escapeXml(String(value))}</${name}>`))
    .join("\n");
}

const sii = (name: string, value: Node[1]): Node => [`sii:${name}`, value];
const lr = (name: string, value: Node[1]): Node => [`siiLR:${name}`, value];
const cut = (value: string, max: number) => value.trim().replace(/\s+/g, " ").slice(0, max);

function idNodes(id: SiiPartyId): Node[] {
  if (id.nif) return [sii("NIF", id.nif)];
  return [sii("IDOtro", [
    // Con NIF-IVA (02) el código de país no es exigible: va dentro del propio identificador.
    sii("CodigoPais", id.idOtro!.idType === "02" ? null : id.idOtro!.countryCode ?? null),
    sii("IDType", id.idOtro!.idType),
    sii("ID", cut(id.idOtro!.id, 20)),
  ])];
}

/** PersonaFisicaJuridicaType: NombreRazon y NIF o IDOtro. */
function partyNodes(party: SiiParty): Node[] {
  return [sii("NombreRazon", cut(party.name, 120)), ...idNodes(party)];
}

function headerNodes(holder: SiiHolder, communication: SiiCommunicationType | null): Node {
  return sii("Cabecera", [
    sii("IDVersionSii", SII_VERSION),
    sii("Titular", [sii("NombreRazon", cut(holder.name, 120)), sii("NIF", holder.nif)]),
    ...(communication ? [sii("TipoComunicacion", communication)] : []),
  ]);
}

function periodNode(period: { year: string; period: string }): Node {
  return sii("PeriodoLiquidacion", [sii("Ejercicio", period.year), sii("Periodo", period.period)]);
}

function rectificationNodes(rectification: SiiRectification | null | undefined): Node[] {
  if (!rectification) return [];
  return [
    sii("TipoRectificativa", rectification.kind),
    sii("FacturasRectificadas", rectification.rectified.map((original) => sii("IDFacturaRectificada", [
      sii("NumSerieFacturaEmisor", cut(original.number, 60)),
      sii("FechaExpedicionFacturaEmisor", original.date),
    ]))),
    // ImporteRectificacion solo cabe (y es obligatorio) en la rectificación por sustitución.
    sii("ImporteRectificacion", rectification.kind === "S" && rectification.amounts ? [
      sii("BaseRectificada", rectification.amounts.base),
      sii("CuotaRectificada", rectification.amounts.quota),
      sii("CuotaRecargoRectificado", rectification.amounts.surchargeQuota ?? null),
    ] : null),
  ];
}

/** Campos comunes de FacturaType, en el orden del XSD. */
function commonInvoiceNodes(invoice: SiiIssuedInvoice | SiiReceivedInvoice): Node[] {
  return [
    sii("TipoFactura", invoice.invoiceType),
    ...rectificationNodes(invoice.rectification),
    sii("FechaOperacion", invoice.operationDate ?? null),
    sii("ClaveRegimenEspecialOTrascendencia", invoice.regimeKey),
    sii("ImporteTotal", invoice.totalAmount ?? null),
    sii("DescripcionOperacion", cut(invoice.description, 500)),
    sii("RefExterna", invoice.refExterna ? cut(invoice.refExterna, 60) : null),
  ];
}

function issuedDetailNode(detail: SiiVatDetail, withSurcharge: boolean): Node {
  return sii("DetalleIVA", [
    sii("TipoImpositivo", detail.rate ?? null),
    sii("BaseImponible", detail.base),
    sii("CuotaRepercutida", detail.quota ?? null),
    // El desglose de prestaciones de servicios no admite recargo de equivalencia (solo las entregas).
    ...(withSurcharge ? [
      sii("TipoRecargoEquivalencia", detail.surchargeRate ?? null),
      sii("CuotaRecargoEquivalencia", detail.surchargeQuota ?? null),
    ] : []),
  ]);
}

function issuedBreakdownNodes(breakdown: SiiIssuedBreakdown, withSurcharge: boolean): Node[] {
  return [
    sii("Sujeta", [
      sii("Exenta", (breakdown.exempt ?? []).map((detail) => sii("DetalleExenta", [
        sii("CausaExencion", detail.cause ?? null),
        sii("BaseImponible", detail.base),
      ]))),
      sii("NoExenta", breakdown.notExempt && breakdown.notExempt.details.length > 0 ? [
        sii("TipoNoExenta", breakdown.notExempt.type),
        sii("DesgloseIVA", breakdown.notExempt.details.map((detail) => issuedDetailNode(detail, withSurcharge))),
      ] : null),
    ]),
    sii("NoSujeta", [
      sii("ImportePorArticulos7_14_Otros", breakdown.notSubjectArticles ?? null),
      sii("ImporteTAIReglasLocalizacion", breakdown.notSubjectLocation ?? null),
    ]),
  ];
}

function issuedRecordNode(invoice: SiiIssuedInvoice): Node {
  const breakdown = invoice.breakdown.level === "invoice"
    ? sii("DesgloseFactura", issuedBreakdownNodes(invoice.breakdown.invoice, true))
    : sii("DesgloseTipoOperacion", [
        sii("PrestacionServicios", invoice.breakdown.services ? issuedBreakdownNodes(invoice.breakdown.services, false) : null),
        sii("Entrega", invoice.breakdown.goods ? issuedBreakdownNodes(invoice.breakdown.goods, true) : null),
      ]);
  return lr("RegistroLRFacturasEmitidas", [
    periodNode(invoice.period),
    lr("IDFactura", [
      sii("IDEmisorFactura", [sii("NIF", invoice.issuerNif)]),
      sii("NumSerieFacturaEmisor", cut(invoice.number, 60)),
      sii("FechaExpedicionFacturaEmisor", invoice.issueDate),
    ]),
    lr("FacturaExpedida", [
      ...commonInvoiceNodes(invoice),
      sii("Contraparte", invoice.counterparty ? partyNodes(invoice.counterparty) : null),
      sii("TipoDesglose", [breakdown]),
    ]),
  ]);
}

function receivedDetailNode(detail: SiiVatDetail): Node {
  return sii("DetalleIVA", [
    sii("TipoImpositivo", detail.rate ?? null),
    sii("BaseImponible", detail.base),
    sii("CuotaSoportada", detail.quota ?? null),
    sii("TipoRecargoEquivalencia", detail.surchargeRate ?? null),
    sii("CuotaRecargoEquivalencia", detail.surchargeQuota ?? null),
    sii("BienInversion", detail.investmentGood ? "S" : null),
  ]);
}

function receivedRecordNode(invoice: SiiReceivedInvoice): Node {
  return lr("RegistroLRFacturasRecibidas", [
    periodNode(invoice.period),
    lr("IDFactura", [
      sii("IDEmisorFactura", idNodes(invoice.issuer)),
      sii("NumSerieFacturaEmisor", cut(invoice.number, 60)),
      sii("FechaExpedicionFacturaEmisor", invoice.issueDate),
    ]),
    lr("FacturaRecibida", [
      ...commonInvoiceNodes(invoice),
      sii("DesgloseFactura", [
        sii("InversionSujetoPasivo", (invoice.reverseCharge ?? []).map(receivedDetailNode)),
        sii("DesgloseIVA", (invoice.vat ?? []).map(receivedDetailNode)),
      ]),
      sii("Contraparte", partyNodes(invoice.counterparty)),
      sii("FechaRegContable", invoice.accountingDate),
      sii("CuotaDeducible", invoice.deductibleQuota),
    ]),
  ]);
}

function assertBatch(count: number) {
  if (count === 0) throw new Error("Un envío al SII necesita al menos un registro.");
  if (count > SII_MAX_RECORDS_PER_SUBMISSION) {
    throw new Error(`Un envío al SII admite como máximo ${SII_MAX_RECORDS_PER_SUBMISSION} registros (se han pasado ${count}).`);
  }
}

function message(root: string, children: Node[]) {
  return `<siiLR:${root} xmlns:siiLR="${SII_LR_NS}" xmlns:sii="${SII_INFO_NS}">\n${render(children, "  ")}\n</siiLR:${root}>`;
}

/** Alta (A0) o modificación (A1) de facturas expedidas. */
export function buildSuministroLRFacturasEmitidas(input: { holder: SiiHolder; communication: SiiCommunicationType; invoices: SiiIssuedInvoice[] }) {
  assertBatch(input.invoices.length);
  return message("SuministroLRFacturasEmitidas", [headerNodes(input.holder, input.communication), ...input.invoices.map(issuedRecordNode)]);
}

/** Alta (A0) o modificación (A1) de facturas recibidas. */
export function buildSuministroLRFacturasRecibidas(input: { holder: SiiHolder; communication: SiiCommunicationType; invoices: SiiReceivedInvoice[] }) {
  assertBatch(input.invoices.length);
  return message("SuministroLRFacturasRecibidas", [headerNodes(input.holder, input.communication), ...input.invoices.map(receivedRecordNode)]);
}

/** Baja de facturas expedidas: la clave es NIF del titular, número y fecha de expedición. */
export function buildBajaLRFacturasEmitidas(input: { holder: SiiHolder; cancellations: SiiCancellation[] }) {
  assertBatch(input.cancellations.length);
  return message("BajaLRFacturasEmitidas", [
    headerNodes(input.holder, null),
    ...input.cancellations.map((cancellation) => lr("RegistroLRBajaExpedidas", [
      periodNode(cancellation.period),
      lr("IDFactura", [
        sii("IDEmisorFactura", [sii("NIF", cancellation.issuer.nif ?? input.holder.nif)]),
        sii("NumSerieFacturaEmisor", cut(cancellation.number, 60)),
        sii("FechaExpedicionFacturaEmisor", cancellation.issueDate),
      ]),
      lr("RefExterna", cancellation.refExterna ? cut(cancellation.refExterna, 60) : null),
    ])),
  ]);
}

/** Baja de facturas recibidas: la clave lleva además el nombre del emisor (IDFacturaRecibidaNombreBCType). */
export function buildBajaLRFacturasRecibidas(input: { holder: SiiHolder; cancellations: SiiCancellation[] }) {
  assertBatch(input.cancellations.length);
  return message("BajaLRFacturasRecibidas", [
    headerNodes(input.holder, null),
    ...input.cancellations.map((cancellation) => {
      if (!cancellation.issuer.name) throw new Error("La baja de una factura recibida necesita el nombre del emisor.");
      return lr("RegistroLRBajaRecibidas", [
        periodNode(cancellation.period),
        lr("IDFactura", [
          sii("IDEmisorFactura", partyNodes(cancellation.issuer)),
          sii("NumSerieFacturaEmisor", cut(cancellation.number, 60)),
          sii("FechaExpedicionFacturaEmisor", cancellation.issueDate),
        ]),
        lr("RefExterna", cancellation.refExterna ? cut(cancellation.refExterna, 60) : null),
      ]);
    }),
  ]);
}

// ── Cobros y pagos del régimen especial del criterio de caja ─────────────────────────────────

type CashInput = Pick<SiiCashRecord, "issuer" | "number" | "issueDate" | "movements">;

function cashMovementNode(tag: "Cobro" | "Pago", movement: SiiCashMovement): Node {
  return sii(tag, [
    sii("Fecha", movement.date),
    sii("Importe", movement.amount),
    sii("Medio", movement.method),
    // Con el medio 03 (no se cobra / paga) la cuenta no se admite (error 1152).
    sii("Cuenta_O_Medio", movement.method === "03" || !movement.account ? null : cut(movement.account, 34)),
  ]);
}

/**
 * Los cobros (o pagos) de una misma factura viajan en un único registro: la respuesta de la AEAT
 * identifica la línea solo por la factura, no por cada cobro.
 */
function groupCashByInvoice(records: CashInput[], keyOf: (record: CashInput) => string) {
  const groups = new Map<string, CashInput>();
  for (const record of records) {
    const key = keyOf(record);
    const group = groups.get(key);
    if (group) group.movements = [...group.movements, ...record.movements];
    else groups.set(key, { ...record, movements: [...record.movements] });
  }
  return [...groups.values()].filter((group) => group.movements.length > 0);
}

/**
 * Cobros de facturas expedidas con clave de régimen 07 (`SuministroLRCobrosEmitidas`). La cabecera
 * no lleva TipoComunicacion y no existe mensaje de baja ni de modificación: un cobro se anula
 * suministrando otro de importe negativo.
 */
export function buildSuministroLRCobrosEmitidas(input: { holder: SiiHolder; records: CashInput[] }) {
  const groups = groupCashByInvoice(input.records, (record) => `${record.number}|${record.issueDate}`);
  assertBatch(groups.length);
  return message("SuministroLRCobrosEmitidas", [
    headerNodes(input.holder, null),
    ...groups.map((record) => lr("RegistroLRCobros", [
      lr("IDFactura", [
        sii("IDEmisorFactura", [sii("NIF", record.issuer.nif ?? input.holder.nif)]),
        sii("NumSerieFacturaEmisor", cut(record.number, 60)),
        sii("FechaExpedicionFacturaEmisor", record.issueDate),
      ]),
      lr("Cobros", record.movements.map((movement) => cashMovementNode("Cobro", movement))),
    ])),
  ]);
}

/** Pagos de facturas recibidas con clave de régimen 07 (`SuministroLRPagosRecibidas`). */
export function buildSuministroLRPagosRecibidas(input: { holder: SiiHolder; records: CashInput[] }) {
  const groups = groupCashByInvoice(input.records, (record) => `${record.issuer.nif ?? JSON.stringify(record.issuer.idOtro)}|${record.number}|${record.issueDate}`);
  assertBatch(groups.length);
  return message("SuministroLRPagosRecibidas", [
    headerNodes(input.holder, null),
    ...groups.map((record) => {
      if (!record.issuer.name) throw new Error("El pago de una factura recibida necesita el nombre del emisor.");
      return lr("RegistroLRPagos", [
        lr("IDFactura", [
          sii("IDEmisorFactura", partyNodes(record.issuer)),
          sii("NumSerieFacturaEmisor", cut(record.number, 60)),
          sii("FechaExpedicionFacturaEmisor", record.issueDate),
        ]),
        lr("Pagos", record.movements.map((movement) => cashMovementNode("Pago", movement))),
      ]);
    }),
  ]);
}

// ── Libro de bienes de inversión ─────────────────────────────────────────────────────────────

/** Periodo del libro de bienes de inversión: siempre anual. */
export const SII_ANNUAL_PERIOD = "0A";

function investmentGoodIdNode(good: SiiInvestmentGood): Node {
  return lr("IDFactura", [
    sii("IDEmisorFactura", partyNodes(good.issuer)),
    sii("NumSerieFacturaEmisor", cut(good.number, 60)),
    sii("FechaExpedicionFacturaEmisor", good.issueDate),
  ]);
}

/** Alta (A0) o modificación (A1) de apuntes del libro de bienes de inversión. */
export function buildSuministroLRBienesInversion(input: { holder: SiiHolder; communication: SiiCommunicationType; goods: SiiInvestmentGood[] }) {
  assertBatch(input.goods.length);
  return message("SuministroLRBienesInversion", [
    headerNodes(input.holder, input.communication),
    ...input.goods.map((good) => lr("RegistroLRBienesInversion", [
      periodNode({ year: good.year, period: SII_ANNUAL_PERIOD }),
      investmentGoodIdNode(good),
      lr("BienesInversion", [
        sii("IdentificacionBien", cut(good.goodId, 40)),
        sii("FechaInicioUtilizacion", good.startOfUseDate),
        sii("ProrrataAnualDefinitiva", good.finalProrrata),
        sii("RegularizacionAnualDeduccion", good.annualRegularization ?? null),
        sii("IdentificacionEntrega", good.deliveryId ? cut(good.deliveryId, 40) : null),
        sii("RegularizacionDeduccionEfectuada", good.deliveryRegularization ?? null),
        sii("RefExterna", good.refExterna ? cut(good.refExterna, 60) : null),
      ]),
    ])),
  ]);
}

/** Baja de apuntes del libro de bienes de inversión: la clave es ejercicio, factura e identificación del bien. */
export function buildBajaLRBienesInversion(input: { holder: SiiHolder; goods: SiiInvestmentGood[] }) {
  assertBatch(input.goods.length);
  return message("BajaLRBienesInversion", [
    headerNodes(input.holder, null),
    ...input.goods.map((good) => lr("RegistroLRBajaBienesInversion", [
      periodNode({ year: good.year, period: SII_ANNUAL_PERIOD }),
      investmentGoodIdNode(good),
      lr("IdentificacionBien", cut(good.goodId, 40)),
      lr("RefExterna", good.refExterna ? cut(good.refExterna, 60) : null),
    ])),
  ]);
}

/** Sobre SOAP 1.1 (los servicios del SII son document/literal y sin SOAPAction). */
export function buildSoapEnvelope(body: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<soapenv:Envelope xmlns:soapenv="${SOAP_ENV_NS}">\n<soapenv:Header/>\n<soapenv:Body>\n${body}\n</soapenv:Body>\n</soapenv:Envelope>`;
}

/** Parte una lista en lotes del tamaño máximo que admite un envío. */
export function chunkForSubmission<T>(items: T[], size = SII_MAX_RECORDS_PER_SUBMISSION): T[][] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) chunks.push(items.slice(offset, offset + size));
  return chunks;
}

// ── Respuesta ────────────────────────────────────────────────────────────────────────────────

export type SiiLineResult = {
  invoiceNumber: string | null;
  issueDate: string | null;
  refExterna: string | null;
  /** Correcto, AceptadoConErrores o Incorrecto. */
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  csv: string | null;
  /** Si la factura ya constaba (error de duplicado): estado del registro que hay en el SII. */
  duplicateStatus: string | null;
};

export type SiiSubmissionResponse = {
  csv: string | null;
  /** Correcto, ParcialmenteCorrecto o Incorrecto; null si no es una respuesta del servicio. */
  submissionStatus: string | null;
  /** Texto del SOAP Fault: el envío entero se ha rechazado (esquema, cabecera, certificado…). */
  fault: string | null;
  faultCode: string | null;
  lines: SiiLineResult[];
};

function unescapeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function allBlocks(xml: string, tag: string) {
  const pattern = new RegExp(`<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`, "g");
  return [...xml.matchAll(pattern)].map((match) => match[1]);
}

function firstTag(xml: string, tag: string) {
  const [block] = allBlocks(xml, tag);
  return block === undefined ? null : unescapeXml(block.trim());
}

/** Quita un bloque (y su contenido) para que sus etiquetas no se confundan con las de fuera. */
function without(xml: string, tag: string) {
  return xml.replace(new RegExp(`<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>[\\s\\S]*?</(?:[\\w.-]+:)?${tag}>`, "g"), "");
}

/** Lee una respuesta RespuestaLRFacturasEmitidas / Recibidas / Baja… o un SOAP Fault. */
export function parseSiiResponse(xml: string): SiiSubmissionResponse {
  const fault = firstTag(xml, "faultstring");
  const lines = allBlocks(xml, "RespuestaLinea");
  const head = without(xml, "RespuestaLinea");
  return {
    csv: firstTag(head, "CSV"),
    submissionStatus: firstTag(head, "EstadoEnvio"),
    fault,
    // La AEAT antepone el código al texto del fallo («Codigo[4102].El XML no cumple el esquema…»).
    faultCode: fault ? (/Codigo\[(\d+)\]/i.exec(fault)?.[1] ?? /^\s*(\d{4})\b/.exec(fault)?.[1] ?? null) : null,
    lines: lines.map((block) => {
      const own = without(block, "RegistroDuplicado");
      const [duplicate] = allBlocks(block, "RegistroDuplicado");
      return {
        invoiceNumber: firstTag(own, "NumSerieFacturaEmisor"),
        issueDate: firstTag(own, "FechaExpedicionFacturaEmisor"),
        refExterna: firstTag(own, "RefExterna"),
        status: firstTag(own, "EstadoRegistro") ?? "Incorrecto",
        errorCode: firstTag(own, "CodigoErrorRegistro"),
        errorMessage: firstTag(own, "DescripcionErrorRegistro"),
        csv: firstTag(own, "CSV"),
        duplicateStatus: duplicate ? firstTag(duplicate, "EstadoRegistro") : null,
      };
    }),
  };
}
