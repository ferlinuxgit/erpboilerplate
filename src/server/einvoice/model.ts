import { isEuCountry } from "@/lib/countries";
import { calculateInvoiceTotals, type InvoiceCalculationLine, type InvoiceTotals } from "@/lib/invoice-totals";
import { normalizeSpanishTaxId } from "@/lib/spanish-tax-id";
import type { Dir3Codes } from "@/server/einvoice/dir3";
import { amountToCents, roundHalfAwayFromZero } from "@/server/taxation/engine";

export { hasAnyDir3, isValidDir3, missingDir3, normalizeDir3, type Dir3Codes } from "@/server/einvoice/dir3";

/**
 * Modelo neutro de una factura EMITIDA del que salen los dos formatos electrónicos (Facturae 3.2.2
 * y UBL 2.1). Es código puro: el servicio (`service.ts`) lo rellena desde la base de datos con las
 * instantáneas fiscales congeladas al emitir y las líneas guardadas.
 */

export type EInvoiceParty = {
  name: string;
  legalName?: string | null;
  taxId: string | null;
  address: string | null;
  addressLine2?: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  countryCode: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
};

export type EInvoiceLineTax = { name?: string | null; rate: number; kind?: string | null; operation: "ADD" | "SUBTRACT" };

export type EInvoiceLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  discountPct?: number | null;
  taxes: EInvoiceLineTax[];
};

export type EInvoiceCorrective = {
  originalNumber: string;
  /** Fecha de expedición de la factura rectificada (AAAA-MM-DD). */
  originalIssueDate: string | null;
  /** Causa de la rectificación con las claves de la AEAT (R1–R5). */
  reason: string | null;
  /** DIFFERENCES o SUBSTITUTION, como se eligió en el formulario. */
  type: string | null;
  description: string | null;
  /** Base imponible y cuota de la factura rectificada: los pide el perfil de la AEAT en las rectificativas por sustitución. */
  originalTaxableBase?: number | null;
  originalTaxAmount?: number | null;
};

export type EInvoicePayment = {
  /** BANK_TRANSFER, CARD, CASH o DIRECT_DEBIT. */
  type: string | null;
  /** IBAN de la cuenta de cobro del emisor (transferencia). */
  iban?: string | null;
  /** IBAN del cliente (domiciliación). */
  debtorIban?: string | null;
};

export type EInvoiceData = {
  number: string;
  /** Fecha de expedición (AAAA-MM-DD, día civil del registro de facturación). */
  issueDate: string;
  /** Fecha de la operación si es distinta de la de expedición. */
  operationDate?: string | null;
  dueDate?: string | null;
  currency: string;
  isCreditNote: boolean;
  issuer: EInvoiceParty;
  customer: EInvoiceParty;
  /** Territorio fiscal del emisor (ES, ES-CN, ES-CE, ES-ML): decide IVA, IGIC o IPSI. */
  issuerTerritory?: string | null;
  lines: EInvoiceLine[];
  /** Total guardado de la factura: el XML debe cuadrar con él al céntimo. */
  storedTotal: number;
  /** Tratamiento de IVA de la factura (DOMESTIC, EXEMPT, INTRA_EU…). */
  vatTreatment?: string | null;
  /** Causa de exención o no sujeción comunicada a VERI*FACTU (E1–E6, N1, N2), si se indicó. */
  vatExemptionCode?: string | null;
  /** Régimen especial del criterio de caja (clave de régimen 07 del perfil UBL de la AEAT). */
  cashAccounting?: boolean;
  /** Menciones legales obligatorias de la factura (exención, inversión del sujeto pasivo, criterio de caja…). */
  legalLiterals: string[];
  corrective?: EInvoiceCorrective | null;
  payment?: EInvoicePayment | null;
  dir3?: Dir3Codes | null;
  notes?: string | null;
  /** URL de cotejo del QR de VERI*FACTU, si la factura tiene registro. */
  verifactuUrl?: string | null;
};

/** Problema que impide generar el fichero (dato obligatorio del formato que falta o no cabe). */
export class EInvoiceError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(problems.join(" "));
    this.name = "EInvoiceError";
    this.problems = problems;
  }
}

// ---------------------------------------------------------------------------------------------
// Importes
// ---------------------------------------------------------------------------------------------

/** Importe con exactamente dos decimales («1234.50», «-0.10»), a partir de céntimos enteros. */
export function centsToFixed(cents: number): string {
  const rounded = Math.round(cents);
  const sign = rounded < 0 ? "-" : "";
  const absolute = Math.abs(rounded);
  return `${sign}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

export function amountToFixed(value: number): string {
  return centsToFixed(amountToCents(value));
}

/**
 * Número con hasta `maxDecimals` decimales y al menos `minDecimals`, sin notación exponencial
 * (tipos «DoubleUpToEightDecimalType» de Facturae y cantidades y precios de UBL).
 */
export function decimalString(value: number, maxDecimals = 8, minDecimals = 0): string {
  if (!Number.isFinite(value)) return (0).toFixed(minDecimals);
  let text = value.toFixed(maxDecimals);
  if (text.includes(".")) {
    text = text.replace(/0+$/, "");
    const decimals = text.length - text.indexOf(".") - 1;
    if (decimals < minDecimals) text = `${text}${"0".repeat(minDecimals - decimals)}`;
    if (text.endsWith(".")) text = text.slice(0, -1);
  }
  return text === "-0" ? "0" : text;
}

/** Coste total de la línea (cantidad × precio) redondeado a céntimos por el método común. */
export function lineTotalCostCents(line: Pick<EInvoiceLine, "quantity" | "unitPrice">): number {
  return roundHalfAwayFromZero(line.quantity * line.unitPrice * 100);
}

export type EInvoiceTotals = InvoiceTotals & { totalCents: number; subtotalCents: number; taxCents: number; retentionCents: number };

/**
 * Totales de la factura con el motor fiscal de la aplicación (el mismo que el PDF y el registro
 * VERI*FACTU). Si no cuadran con el total guardado no se genera nada: una factura electrónica que
 * dice otra cosa que la factura emitida sería una factura distinta.
 */
export function computeEInvoiceTotals(data: Pick<EInvoiceData, "lines" | "isCreditNote" | "storedTotal">): EInvoiceTotals {
  const lines: InvoiceCalculationLine[] = data.lines.map((line) => ({
    description: line.description?.trim() ? line.description : "-",
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountPct: line.discountPct ?? 0,
    taxes: line.taxes.map((tax) => ({ name: tax.name ?? null, rate: tax.rate, kind: tax.kind ?? "VAT", operation: tax.operation })),
  }));
  const totals = calculateInvoiceTotals(lines, { allowNegative: data.isCreditNote });
  const totalCents = amountToCents(totals.totalAmount);
  if (totalCents !== amountToCents(data.storedTotal)) {
    throw new EInvoiceError([
      `El total calculado a partir de las líneas (${centsToFixed(totalCents)}) no coincide con el total guardado de la factura (${amountToFixed(data.storedTotal)}). No se genera la factura electrónica para no entregar un documento distinto del emitido.`,
    ]);
  }
  return {
    ...totals,
    totalCents,
    subtotalCents: amountToCents(totals.subtotal),
    taxCents: amountToCents(totals.taxAmount),
    retentionCents: amountToCents(totals.retentionAmount),
  };
}

// ---------------------------------------------------------------------------------------------
// Partes
// ---------------------------------------------------------------------------------------------

export function partyCountry(party: Pick<EInvoiceParty, "countryCode">) {
  return (party.countryCode ?? "ES").trim().toUpperCase() || "ES";
}

/** NIF español sin el prefijo «ES» del NIF-IVA; los identificadores extranjeros se dejan como están. */
export function partyTaxNumber(party: Pick<EInvoiceParty, "taxId" | "countryCode">): string {
  const normalized = normalizeSpanishTaxId(party.taxId);
  if (partyCountry(party) === "ES" && /^ES[0-9A-Z]{9}$/.test(normalized)) return normalized.slice(2);
  return normalized;
}

/**
 * ¿Persona física? En España lo dice el NIF: DNI (empieza por dígito), NIE (X, Y, Z) y los NIF K, L
 * y M son de personas físicas; el resto de letras, de entidades. Fuera de España no se puede saber
 * por el identificador: se trata como persona jurídica (el caso habitual entre empresas).
 */
export function isNaturalPerson(party: Pick<EInvoiceParty, "taxId" | "countryCode">): boolean {
  if (partyCountry(party) !== "ES") return false;
  return /^[0-9XYZKLM]/.test(partyTaxNumber(party));
}

/** Residencia fiscal para Facturae: R (España), U (resto de la UE) o E (fuera de la UE). */
export function residenceType(party: Pick<EInvoiceParty, "countryCode">): "R" | "U" | "E" {
  const country = partyCountry(party);
  if (country === "ES") return "R";
  return isEuCountry(country) ? "U" : "E";
}

export type PersonName = { name: string; firstSurname: string; secondSurname: string | null };

/**
 * Parte «Nombre Apellido1 Apellido2» (o «Apellido1 Apellido2, Nombre») en los tres campos que pide
 * Facturae para las personas físicas. La ficha guarda el nombre completo en un solo campo, así que
 * es una aproximación: con tres palabras o más, las dos últimas son los apellidos.
 */
export function splitPersonName(fullName: string): PersonName {
  const cleaned = fullName.replace(/\s+/g, " ").trim();
  const comma = cleaned.indexOf(",");
  if (comma > 0 && comma < cleaned.length - 1) {
    const surnames = cleaned.slice(0, comma).trim().split(" ");
    const name = cleaned.slice(comma + 1).trim();
    return { name, firstSurname: surnames[0], secondSurname: surnames.slice(1).join(" ") || null };
  }
  const words = cleaned.split(" ").filter(Boolean);
  if (words.length <= 1) return { name: cleaned, firstSurname: cleaned, secondSurname: null };
  if (words.length === 2) return { name: words[0], firstSurname: words[1], secondSurname: null };
  return { name: words.slice(0, -2).join(" "), firstSurname: words[words.length - 2], secondSurname: words[words.length - 1] };
}

/**
 * Serie y número. La aplicación guarda el número completo («F2026-000012»); Facturae y FACe los
 * piden separados. La serie es todo lo que precede al último grupo de dígitos, de modo que
 * serie + número reproduce exactamente el número de la factura emitida.
 */
export function splitSeriesAndNumber(fullNumber: string): { series: string | null; number: string } {
  const value = fullNumber.trim();
  const match = /^(.*?)(\d+)$/.exec(value);
  if (!match || !match[1]) return { series: null, number: value };
  return { series: match[1], number: match[2] };
}

/** ISO 3166-1 alfa-2 → alfa-3 (Facturae usa alfa-3). Estados de la UE y los socios comerciales habituales. */
const ALPHA3: Record<string, string> = {
  ES: "ESP", PT: "PRT", FR: "FRA", DE: "DEU", IT: "ITA", NL: "NLD", BE: "BEL", LU: "LUX", IE: "IRL", AT: "AUT",
  DK: "DNK", SE: "SWE", FI: "FIN", PL: "POL", CZ: "CZE", SK: "SVK", HU: "HUN", RO: "ROU", BG: "BGR", GR: "GRC",
  HR: "HRV", SI: "SVN", EE: "EST", LV: "LVA", LT: "LTU", CY: "CYP", MT: "MLT", GB: "GBR", CH: "CHE", NO: "NOR",
  IS: "ISL", LI: "LIE", AD: "AND", MC: "MCO", SM: "SMR", VA: "VAT", GI: "GIB", US: "USA", CA: "CAN", MX: "MEX",
  AR: "ARG", BR: "BRA", CL: "CHL", CO: "COL", PE: "PER", UY: "URY", PY: "PRY", BO: "BOL", EC: "ECU", VE: "VEN",
  CR: "CRI", PA: "PAN", DO: "DOM", CU: "CUB", GT: "GTM", HN: "HND", SV: "SLV", NI: "NIC", PR: "PRI", MA: "MAR",
  DZ: "DZA", TN: "TUN", EG: "EGY", ZA: "ZAF", NG: "NGA", SN: "SEN", TR: "TUR", IL: "ISR", SA: "SAU", AE: "ARE",
  QA: "QAT", KW: "KWT", IN: "IND", CN: "CHN", JP: "JPN", KR: "KOR", HK: "HKG", SG: "SGP", TW: "TWN", TH: "THA",
  VN: "VNM", ID: "IDN", MY: "MYS", PH: "PHL", AU: "AUS", NZ: "NZL", RU: "RUS", UA: "UKR", RS: "SRB", BA: "BIH",
  ME: "MNE", MK: "MKD", AL: "ALB", MD: "MDA", BY: "BLR", GE: "GEO", AM: "ARM", AZ: "AZE", KZ: "KAZ",
};

export function countryAlpha3(countryCode: string | null | undefined): string | null {
  return ALPHA3[(countryCode ?? "ES").trim().toUpperCase() || "ES"] ?? null;
}

// ---------------------------------------------------------------------------------------------
// Administración pública
// ---------------------------------------------------------------------------------------------

/**
 * ¿El NIF es de una Administración pública española? Las letras P (corporaciones locales), Q
 * (organismos públicos) y S (órganos de la Administración del Estado y de las comunidades
 * autónomas) lo indican (Orden EHA/451/2008). Sirve para avisar de que faltan los DIR3.
 */
export function looksLikePublicAdministration(party: Pick<EInvoiceParty, "taxId" | "countryCode">): boolean {
  return partyCountry(party) === "ES" && /^[PQS][0-9]{7}[0-9A-J]$/.test(partyTaxNumber(party));
}

// ---------------------------------------------------------------------------------------------
// Impuestos
// ---------------------------------------------------------------------------------------------

export type IndirectTaxSystem = "VAT" | "IGIC" | "IPSI";

/** Impuesto indirecto del territorio del emisor: IVA, IGIC (Canarias) o IPSI (Ceuta y Melilla). */
export function indirectTaxSystem(territory: string | null | undefined): IndirectTaxSystem {
  const value = (territory ?? "").toUpperCase();
  if (value === "ES-CN") return "IGIC";
  if (value === "ES-CE" || value === "ES-ML") return "IPSI";
  return "VAT";
}

export const isVatTax = (tax: EInvoiceLineTax) => tax.operation === "ADD" && (tax.kind ?? "VAT").toUpperCase() === "VAT";
export const isSurchargeTax = (tax: EInvoiceLineTax) => tax.operation === "ADD" && (tax.kind ?? "").toUpperCase() === "SURCHARGE";
export const isOtherOutputTax = (tax: EInvoiceLineTax) => tax.operation === "ADD" && !isVatTax(tax) && !isSurchargeTax(tax);
export const isWithholdingTax = (tax: EInvoiceLineTax) => tax.operation === "SUBTRACT";

/**
 * Naturaleza de las líneas sin cuota según el tratamiento de la factura: exenta, no sujeta, o
 * sujeta con inversión del sujeto pasivo. La causa comunicada a VERI*FACTU (E1–E6 / N1–N2) manda
 * sobre el tratamiento cuando existe.
 */
export type ZeroTaxNature = "EXEMPT" | "NOT_SUBJECT" | "REVERSE_CHARGE" | "EXPORT" | "INTRA_EU" | "ZERO_RATE";

export function zeroTaxNature(vatTreatment: string | null | undefined, vatExemptionCode: string | null | undefined): ZeroTaxNature {
  const treatment = (vatTreatment ?? "").toUpperCase();
  const code = (vatExemptionCode ?? "").toUpperCase();
  if (treatment === "REVERSE_CHARGE") return "REVERSE_CHARGE";
  if (treatment === "EXPORT") return "EXPORT";
  if (treatment === "INTRA_EU") return "INTRA_EU";
  if (/^N[12]$/.test(code) || treatment === "NOT_SUBJECT" || treatment === "INTRA_EU_SERVICES") return "NOT_SUBJECT";
  if (/^E[1-6]$/.test(code) || treatment === "EXEMPT") return "EXEMPT";
  return "ZERO_RATE";
}
