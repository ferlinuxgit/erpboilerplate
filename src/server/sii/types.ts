/**
 * Contenido de un registro del SII (Suministro Inmediato de Información, art. 62.6 RIVA y Orden
 * HFP/417/2017), ya traducido a los campos del esquema `SuministroInformacion.xsd` (versión 1.1).
 * Es lo que se guarda en `sii_record.payload` y lo que consumen los generadores de XML: datos
 * puros, con las fechas en dd-mm-aaaa y los importes como texto con punto decimal.
 */

export type SiiBook = "ISSUED" | "RECEIVED";
/** A0 alta, A1 modificación (la factura ya consta en el SII), BAJA anulación del registro. */
export type SiiOperation = "A0" | "A1" | "BAJA";
export type SiiStatus = "PENDING" | "SENT" | "ACCEPTED" | "ACCEPTED_WITH_ERRORS" | "REJECTED";

export type SiiPeriod = { year: string; period: string };

/** Identificación de una persona: NIF español o bloque IDOtro (NIF-IVA, pasaporte, documento oficial…). */
export type SiiPartyId =
  | { nif: string; idOtro?: undefined }
  | { nif?: undefined; idOtro: { countryCode?: string | null; idType: string; id: string } };

export type SiiParty = SiiPartyId & { name: string };

export type SiiVatDetail = {
  /** Tipo impositivo ("21.00"). */
  rate?: string | null;
  base: string;
  /** Cuota repercutida (expedidas) o soportada (recibidas). */
  quota?: string | null;
  surchargeRate?: string | null;
  surchargeQuota?: string | null;
  /** Solo recibidas: la línea es un bien de inversión (campo BienInversion = S). */
  investmentGood?: boolean;
};

export type SiiExemptDetail = { cause?: string | null; base: string };

/** Desglose de una factura expedida (o de su parte de entregas / de prestaciones de servicios). */
export type SiiIssuedBreakdown = {
  exempt?: SiiExemptDetail[];
  /** Sujeta y no exenta: S1 sin inversión del sujeto pasivo, S2 con inversión, S3 ambas. */
  notExempt?: { type: "S1" | "S2" | "S3"; details: SiiVatDetail[] } | null;
  /** No sujeta por los arts. 7, 14 y otros. */
  notSubjectArticles?: string | null;
  /** No sujeta por reglas de localización. */
  notSubjectLocation?: string | null;
};

export type SiiRectification = {
  /** S sustitución, I diferencias. */
  kind: "S" | "I";
  rectified: Array<{ number: string; date: string }>;
  /** Obligatorio con «S»: base y cuota de la factura sustituida. */
  amounts?: { base: string; quota: string; surchargeQuota?: string | null } | null;
};

type SiiInvoiceCommon = {
  /** Referencia propia que la AEAT devuelve en la respuesta (máx. 60): el id del registro. */
  refExterna?: string | null;
  period: SiiPeriod;
  number: string;
  /** Fecha de expedición dd-mm-aaaa. */
  issueDate: string;
  /** F1, F2, R1–R5 (expedidas) y además F5 (DUA de importación) en recibidas. */
  invoiceType: string;
  rectification?: SiiRectification | null;
  operationDate?: string | null;
  /** ClaveRegimenEspecialOTrascendencia (lista L3.1 expedidas, L3.2 recibidas). */
  regimeKey: string;
  totalAmount?: string | null;
  description: string;
};

export type SiiIssuedInvoice = SiiInvoiceCommon & {
  issuerNif: string;
  /** Sin contraparte en las simplificadas (F2 y R5). */
  counterparty?: SiiParty | null;
  /** Desglose a nivel de factura o, con contraparte extranjera, por tipo de operación. */
  breakdown:
    | { level: "invoice"; invoice: SiiIssuedBreakdown }
    | { level: "operation"; services?: SiiIssuedBreakdown | null; goods?: SiiIssuedBreakdown | null };
};

export type SiiReceivedInvoice = SiiInvoiceCommon & {
  /** Emisor de la factura (el proveedor; en un DUA de importación, el propio titular). */
  issuer: SiiParty;
  /** Líneas con inversión del sujeto pasivo (la cuota la autoliquida el titular). */
  reverseCharge?: SiiVatDetail[];
  /** Resto de líneas (IVA soportado en factura, adquisiciones intracomunitarias, importaciones). */
  vat?: SiiVatDetail[];
  counterparty: SiiParty;
  /** Fecha de registro contable dd-mm-aaaa. */
  accountingDate: string;
  deductibleQuota: string;
};

/** Baja de un registro: basta la clave de la factura y el periodo en que se dio de alta. */
export type SiiCancellation = {
  refExterna?: string | null;
  period: SiiPeriod;
  number: string;
  issueDate: string;
  /** Expedidas: NIF del titular. Recibidas: nombre e identificación del emisor. */
  issuer: SiiParty | { nif: string; name?: undefined; idOtro?: undefined };
};

/** Lo que guarda `sii_record.payload`. */
export type SiiRecordPayload =
  | { book: "ISSUED"; invoice: SiiIssuedInvoice }
  | { book: "RECEIVED"; invoice: SiiReceivedInvoice };

export type SiiHolder = { name: string; nif: string };
