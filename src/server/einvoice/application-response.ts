import { EInvoiceError } from "@/server/einvoice/model";
import { clip, el, txt, xmlDocument, type XmlNode } from "@/server/einvoice/xml";

/**
 * Mensajes de estado de la factura electrónica en UBL «ApplicationResponse» (anexo II de la Orden
 * HAC/1028/2026, BOE-A-2026-20587), que se remiten a la solución pública de facturación
 * electrónica (SPFE) de la AEAT. Código puro.
 *
 * Fuentes contrastadas el 28-11-2026:
 * - Anexo II de la orden (BOE): campos y rutas UBL de cada mensaje y su `ResponseCode`.
 * - «Reglas de negocio anexo II OM SPFE» v0.1 de 19-11-2026 (reglas BR-ANEXOII, BR-PAGO,
 *   BR-RECHAZO, BR-COBRO y BR-IMPAGO).
 * - «Catálogo de servicios» v0.1.6 de la SPFE (servicios de comunicación de estados del emisor
 *   y del destinatario) y los ejemplos oficiales `Cobrada.xml` y `Pagar.xml`.
 *
 * Quién envía cada mensaje (regla BR-ANEXOII-4):
 * - El EMISOR: cobro (SETTLEMENT) e impago (DEFAULT), y sus bajas (CANCELSETTLEMENT, CANCELDEFAULT).
 * - El DESTINATARIO: pago (PAYMENT) y rechazo (REJECTION), y sus bajas.
 * La aceptación NO es un mensaje: toda factura que entra en la SPFE se considera aceptada mientras
 * no se rechace (art. 12.1 del RD 238/2026; catálogo de servicios, apartado 6.9.2).
 *
 * SIN VERIFICAR: no se ha enviado ningún mensaje a la SPFE (exige certificado y el sobre ebXML del
 * catálogo de servicios, que aquí no se genera). Lo único comprobado es la validez frente al XSD
 * de UBL 2.5 de OASIS y las reglas de negocio que este módulo aplica. `SenderParty` y
 * `ReceiverParty` van vacíos, como en los ejemplos oficiales: la documentación no dice qué deben
 * contener. El identificador del mensaje (`cbc:ID`) es libre; se sigue la forma de los ejemplos.
 */

export const SPFE_STATUS_MESSAGE_CODES = ["PAYMENT", "CANCELPAYMENT", "REJECTION", "CANCELREJECTION", "SETTLEMENT", "CANCELSETTLEMENT", "DEFAULT", "CANCELDEFAULT"] as const;
export type SpfeStatusMessageCode = (typeof SPFE_STATUS_MESSAGE_CODES)[number];

/** Lista L1 del anexo II: motivo del rechazo. */
export const SPFE_REJECTION_CODES = ["01", "02"] as const;

export type SpfeReportedInvoice = {
  /** Serie y número de la factura informada (BT-1). */
  number: string;
  /** Fecha de expedición (AAAA-MM-DD). */
  issueDate: string;
  issuerTaxId: string;
  issuerName: string;
  /** Importe a pagar (BT-115): no se informa el pago ni el cobro de una factura negativa. */
  payableAmount?: number | null;
  /** Factura rectificativa (código 384): solo admite el indicador «NegativeAmountInvoice» (BR-PAGO-6). */
  isCreditNote?: boolean;
};

export type SpfeStatusMessageInput = {
  code: SpfeStatusMessageCode;
  /** Identificador del mensaje (libre; los ejemplos usan «SETTLEMENTS-AAAAMMDD-0001»). */
  messageId: string;
  /** Fecha en que se genera la comunicación (AAAA-MM-DD), no la del estado. */
  messageDate: string;
  /**
   * Fecha del estado: pago, rechazo o cobro (EffectiveDate). En el impago es la fecha de
   * vencimiento del pago, que el anexo II coloca también en EffectiveDate.
   */
  effectiveDate?: string | null;
  /** Fecha de vencimiento del plazo de pago (Ley 3/2004): obligatoria en el pago, opcional en el cobro. */
  dueDate?: string | null;
  /** Fechas opcionales de recepción de la factura y de las mercancías o servicios. */
  receptionDate?: string | null;
  shipmentDate?: string | null;
  /** Cobro a través de un mecanismo de financiación concertado por el emisor (solo SETTLEMENT). */
  financingArrangement?: boolean;
  /** Motivo del rechazo (lista L1): 01 comercial, 02 consumo particular o no afecto a la actividad. */
  rejectionCode?: string | null;
  invoice: SpfeReportedInvoice;
};

const NS_RESPONSE = "urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2";
const NS_CAC = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2";
const NS_CBC = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string | null | undefined): value is string {
  if (!value || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Fecha asociada al estado: `cac:Status` con `ReferenceDate` y el atributo que la califica. */
const dated = (date: string, attribute: string) => el("cac:Status", [txt("cbc:ReferenceDate", date), el("cac:Condition", [txt("cbc:AttributeID", attribute)])]);

/** Problemas que impiden generar el mensaje (reglas del anexo II). Lista vacía si se puede. */
export function spfeStatusMessageProblems(input: SpfeStatusMessageInput): string[] {
  const problems: string[] = [];
  const { code, invoice } = input;
  const cancellation = code.startsWith("CANCEL");
  // BR-PAGO-7, BR-RECHAZO-5, BR-COBRO-4, BR-IMPAGO-4: la factura informada completa.
  if (!invoice.number.trim()) problems.push("Falta el número de la factura informada.");
  if (!validDate(invoice.issueDate)) problems.push("Falta la fecha de expedición de la factura informada.");
  if (!invoice.issuerTaxId.trim()) problems.push("Falta el NIF del emisor de la factura informada.");
  if (!invoice.issuerName.trim()) problems.push("Falta el nombre o la razón social del emisor de la factura informada.");
  if (!validDate(input.messageDate)) problems.push("Falta la fecha del mensaje.");
  if (cancellation) return problems;

  const label = { PAYMENT: "del pago", REJECTION: "del rechazo", SETTLEMENT: "del cobro", DEFAULT: "de vencimiento del pago impagado" }[code as "PAYMENT" | "REJECTION" | "SETTLEMENT" | "DEFAULT"];
  if (!validDate(input.effectiveDate)) problems.push(`Falta la fecha ${label}.`);
  // BR-PAGO-2, BR-RECHAZO-2, BR-COBRO-2, BR-IMPAGO-2: no posterior a la fecha de envío.
  else if (validDate(input.messageDate) && input.effectiveDate > input.messageDate) problems.push(`La fecha ${label} no puede ser posterior a la del mensaje.`);
  // BR-RECHAZO-3: el rechazo debe ser posterior a la expedición.
  if (code === "REJECTION" && validDate(input.effectiveDate) && validDate(invoice.issueDate) && input.effectiveDate <= invoice.issueDate) {
    problems.push("La fecha del rechazo debe ser posterior a la de expedición de la factura (regla BR-RECHAZO-3).");
  }
  if (code === "REJECTION" && !(SPFE_REJECTION_CODES as readonly string[]).includes(input.rejectionCode ?? "")) {
    problems.push("Indica el motivo del rechazo: 01 (comercial) o 02 (consumo particular o no afecto a la actividad).");
  }
  // BR-PAGO-3: el pago lleva la fecha de vencimiento del plazo de pago.
  if (code === "PAYMENT" && !validDate(input.dueDate)) problems.push("El mensaje de pago exige la fecha de vencimiento del plazo de pago (regla BR-PAGO-3).");
  // BR-PAGO-4, BR-COBRO-3, BR-IMPAGO-3.
  if (input.receptionDate && (!validDate(input.receptionDate) || (validDate(invoice.issueDate) && input.receptionDate < invoice.issueDate))) {
    problems.push("La fecha de recepción de la factura no puede ser anterior a su expedición.");
  }
  // BR-PAGO-8, BR-COBRO-5, BR-IMPAGO-5: no con importe a pagar negativo.
  if (code !== "REJECTION" && typeof invoice.payableAmount === "number" && invoice.payableAmount < 0) {
    problems.push("No se comunica el pago, el cobro ni el impago de una factura con importe a pagar negativo.");
  }
  return problems;
}

/** Árbol del mensaje ApplicationResponse. Lanza `EInvoiceError` si falta algo obligatorio. */
export function buildSpfeStatusMessageTree(input: SpfeStatusMessageInput): XmlNode {
  const problems = spfeStatusMessageProblems(input);
  if (problems.length > 0) throw new EInvoiceError(problems);
  const { code, invoice } = input;
  const statuses: XmlNode[] = [];
  if (code === "PAYMENT" || code === "SETTLEMENT") {
    if (input.dueDate && validDate(input.dueDate)) statuses.push(dated(input.dueDate, "DueDate"));
  }
  if (code === "PAYMENT" || code === "SETTLEMENT" || code === "DEFAULT") {
    if (input.shipmentDate && validDate(input.shipmentDate)) statuses.push(dated(input.shipmentDate, "ShipmentDate"));
    if (input.receptionDate) statuses.push(dated(input.receptionDate, "ReceptionDate"));
  }
  if (code === "SETTLEMENT" && input.financingArrangement) statuses.push(el("cac:Status", [el("cac:Condition", [txt("cbc:AttributeID", "FinancingArrangement")])]));
  // Pago de una rectificativa negativa: indicador «NegativeAmountInvoice» (BR-PAGO-6).
  if (code === "PAYMENT" && invoice.isCreditNote) statuses.push(el("cac:Status", [txt("cbc:StatusReason", "NegativeAmountInvoice")]));
  if (code === "REJECTION") statuses.push(el("cac:Status", [txt("cbc:ConditionCode", input.rejectionCode)]));

  return el("ApplicationResponse", [
    txt("cbc:ID", clip(input.messageId, 100)),
    txt("cbc:IssueDate", input.messageDate),
    el("cac:SenderParty", []),
    el("cac:ReceiverParty", []),
    el("cac:DocumentResponse", [
      el("cac:Response", [
        txt("cbc:ResponseCode", code),
        code.startsWith("CANCEL") ? null : txt("cbc:EffectiveDate", input.effectiveDate),
        ...statuses,
      ]),
      // Una sola factura por DocumentResponse, identificada por número, fecha y NIF del emisor.
      el("cac:DocumentReference", [
        txt("cbc:ID", invoice.number),
        txt("cbc:IssueDate", invoice.issueDate),
        txt("cbc:DocumentType", "Invoice"),
        el("cac:IssuerParty", [
          el("cac:PartyTaxScheme", [txt("cbc:CompanyID", invoice.issuerTaxId.trim()), el("cac:TaxScheme", [])]),
          el("cac:PartyLegalEntity", [txt("cbc:RegistrationName", clip(invoice.issuerName, 200))]),
        ]),
      ]),
    ]),
  ], { xmlns: NS_RESPONSE, "xmlns:cac": NS_CAC, "xmlns:cbc": NS_CBC });
}

export function buildSpfeStatusMessage(input: SpfeStatusMessageInput): { xml: string; fileName: string } {
  const xml = xmlDocument(buildSpfeStatusMessageTree(input));
  const safeNumber = input.invoice.number.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return { xml, fileName: `${safeNumber}-${input.code.toLowerCase()}-${input.messageDate}.xml` };
}
