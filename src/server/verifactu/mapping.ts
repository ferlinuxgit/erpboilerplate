/**
 * Traducción de una factura emitida a los campos del registro de facturación VeriFactu
 * (RegistroAlta del esquema SuministroInformacion.xsd). Código puro, sin base de datos.
 *
 * Decisiones (documentadas también en el informe de implantación):
 * - TipoFactura según la clase de documento de la factura (`documentClass`), contrastado con el
 *   documento de validaciones de la AEAT (v1.2.2, apartados 8, 9 y 13 del registro de alta):
 *   · completa → F1 con Destinatarios;
 *   · simplificada (art. 7.1) → F2, que NO puede llevar Destinatarios (apdo. 13: «Si TipoFactura
 *     es F2 o R5, la agrupación Destinatarios no puede estar cumplimentada»);
 *   · simplificada con los datos del destinatario (arts. 7.2 y 7.3) → F1 con Destinatarios y
 *     `FacturaSimplificadaArt7273 = S` (apdo. 8: «Sólo se podrá rellenar con S si TipoFactura = F1
 *     o F3 o R1 o R2 o R3 o R4»). No es una F2: esa nunca identifica al destinatario.
 *   `FacturaSinIdentifDestinatarioArt61d` (apdo. 9, solo con F2 o R5) es otra cosa: la factura
 *   completa sin identificar al destinatario del art. 6.1.d; este sistema no la emite.
 *   Sin clase (facturas antiguas): F1 si el cliente tiene NIF / NIF-IVA y F2 si no lo tiene.
 * - F3: factura expedida en sustitución de facturas simplificadas (canje), con la agrupación
 *   `FacturasSustituidas` (apdo. 5: solo con F3) y Destinatarios obligatorio (apdo. 13).
 * - Corrección de una F3 errónea: según las preguntas frecuentes de la AEAT para desarrolladores,
 *   «mediante el alta de otras dos facturas tipo F3: una F3 de importe negativo […] y una nueva F3
 *   con los datos correctos». La F3 negativa se guarda como un abono que sustituye a las mismas
 *   simplificadas: aquí sale como F3 (no como R1–R5), sin datos de rectificación.
 * - Suplidos (art. 78.Tres.3.º LIVA): no entran en el desglose ni en ImporteTotal. Misma fuente:
 *   «no se registran en la información del registro de facturación de alta. A la hora de indicar
 *   el importe total de una factura que contiene un suplido, este no será tenido en cuenta y solo
 *   se consignará la suma de base imponible y cuota repercutida». `totals.subtotal` y el desglose
 *   por tipo ya llegan sin ellos (el motor los suma solo al total a pagar).
 * - Rectificativas: R1–R4 según la causa guardada; R5 si la factura original era simplificada (F2).
 * - TipoRectificativa "I" (por diferencias): nuestras rectificativas siempre expresan importes por
 *   diferencia (también las de tipo "sustitución", que llevan las líneas originales en negativo y
 *   las nuevas en positivo), así que "I" es la representación exacta de sus importes.
 * - ImporteTotal = bases + cuotas de IVA + recargo de equivalencia, sin restar retenciones de IRPF
 *   (la AEAT valida que coincida con la suma del desglose).
 * - Una base al 0 % en una factura nacional con IVA o IPSI no es una operación sujeta (S1 con tipo
 *   0 se rechaza): va como exenta con su causa. En el IGIC el tipo cero sí existe y se mantiene.
 * - La causa de exención (E1–E6) o de no sujeción (N1, N2) es la que elige el usuario en la factura;
 *   sin elección, la habitual del tratamiento (E1 exenta, E2 exportación, E5 intracomunitaria, N2).
 */
import type { InvoiceTaxBucket } from "@/lib/invoice-totals";
import { EU_COUNTRY_CODES } from "@/lib/fiscal-spain";
import { formatAeatAmount, normalizeIssuerNif } from "@/server/verifactu/format";

export type VerifactuInvoiceTypeCode = "F1" | "F2" | "F3" | "R1" | "R2" | "R3" | "R4" | "R5";

export type VerifactuBreakdownLine = {
  Impuesto: string;
  /** Obligatoria con IVA (01), IGIC (03) e IPSI (02; en este, solo 01, 08, 11, 18, 19 o 20). */
  ClaveRegimen?: string;
  CalificacionOperacion?: string;
  OperacionExenta?: string;
  TipoImpositivo?: string;
  BaseImponibleOimporteNoSujeto: string;
  CuotaRepercutida?: string;
  TipoRecargoEquivalencia?: string;
  CuotaRecargoEquivalencia?: string;
};

export type VerifactuRecipient = {
  name: string;
  /** NIF español (si el país es España) o identificador extranjero. */
  taxId: string | null;
  countryCode: string | null;
  /** null = NIF español; "02" NIF-IVA (UE); "04" documento oficial del país de residencia. */
  idType: string | null;
};

export type VerifactuAltaContent = {
  invoiceTypeCode: VerifactuInvoiceTypeCode;
  rectificationKind: "S" | "I" | null;
  rectifiedInvoices: Array<{ issuerTaxId: string; invoiceNumber: string; invoiceIssueDate: string }> | null;
  /** FacturasSustituidas: simplificadas a las que sustituye una F3 (null en el resto). */
  substitutedInvoices?: Array<{ issuerTaxId: string; invoiceNumber: string; invoiceIssueDate: string }> | null;
  /** FacturaSimplificadaArt7273 = S: simplificada que identifica al destinatario (F1, F3 o R1–R4). */
  simplifiedArt7273?: boolean;
  description: string;
  recipient: VerifactuRecipient | null;
  breakdown: VerifactuBreakdownLine[];
  /** FechaOperacion (dd-mm-aaaa) si difiere de la de expedición. */
  operationDate?: string | null;
  taxAmount: string;
  totalAmount: string;
  /** Aviso: sin NIF de cliente y total por encima del límite general de factura simplificada. */
  simplifiedOverLimit: boolean;
};

export type SalesTreatment = "DOMESTIC" | "INTRA_EU" | "EXPORT" | "EXEMPT" | "REVERSE_CHARGE" | "NOT_SUBJECT";

/** Clave del impuesto (L1): 01 IVA, 02 IPSI (Ceuta y Melilla), 03 IGIC (Canarias). */
export type VerifactuTaxCode = "01" | "02" | "03";

/** Impuesto del registro según el territorio del emisor (ES-CN → IGIC, ES-CE / ES-ML → IPSI). */
export function verifactuTaxCodeFor(territory: string | null | undefined): VerifactuTaxCode {
  if (territory === "ES-CN") return "03";
  if (territory === "ES-CE" || territory === "ES-ML") return "02";
  return "01";
}

/** Claves de régimen que la AEAT admite con IPSI (validaciones VERI*FACTU, apartado del desglose). */
const IPSI_REGIME_KEYS = new Set(["01", "08", "11", "18", "19", "20"]);

/**
 * Aplica la clave del impuesto a una línea de desglose. Con IPSI la ClaveRegimen también es
 * obligatoria (sin ella la AEAT acepta con errores hasta el 31-12-2026 y rechaza desde el
 * 01-01-2027): se conserva si es una de las admitidas y, si no, va la de régimen general.
 */
function withTaxCode(line: VerifactuBreakdownLine, taxCode: VerifactuTaxCode): VerifactuBreakdownLine {
  if (taxCode === "01") return line;
  const { ClaveRegimen, ...rest } = line;
  if (taxCode === "02") return { ...rest, Impuesto: taxCode, ClaveRegimen: ClaveRegimen && IPSI_REGIME_KEYS.has(ClaveRegimen) ? ClaveRegimen : "01" };
  return { ...rest, Impuesto: taxCode, ClaveRegimen };
}

export type MapInvoiceInput = {
  invoiceType: "INVOICE" | "CREDIT_NOTE" | string;
  /** Clave del impuesto según el territorio del emisor (por defecto 01, IVA). */
  taxCode?: VerifactuTaxCode;
  rectificationReason: string | null;
  vatTreatment: SalesTreatment;
  customer: { name: string; taxId: string | null; countryCode: string | null } | null;
  totals: { subtotal: number; taxBuckets: InvoiceTaxBucket[] };
  description: string;
  /** Causa de exención (E1–E6) o de no sujeción (N1, N2) elegida en la factura. */
  exemptionCode?: string | null;
  operationDate?: string | null;
  /** Clase de documento con la que se emite (null = se deduce del NIF del cliente). */
  documentClass?: "FULL" | "SIMPLIFIED" | "SIMPLIFIED_QUALIFIED" | null;
  /** Simplificadas a las que sustituye esta factura (canje): la convierte en F3. */
  substituted?: Array<{ issuerTaxId: string; invoiceNumber: string; invoiceIssueDate: string }> | null;
  /** Factura original de una rectificativa (datos tal y como constan en su registro). */
  original?: { issuerTaxId: string; invoiceNumber: string; invoiceIssueDate: string; invoiceTypeCode: string | null } | null;
};

export const SIMPLIFIED_INVOICE_LIMIT = 400;
/** Por encima de este total la AEAT rechaza una F2 (límite del art. 4.2 RD 1619/2012). */
export const SIMPLIFIED_INVOICE_HARD_LIMIT = 3000;

export const EXEMPTION_CODES = ["E1", "E2", "E3", "E4", "E5", "E6"] as const;
export const NOT_SUBJECT_CODES = ["N1", "N2"] as const;
export const vatExemptionCodeLabels: Record<string, string> = {
  E1: "E1 · Exenta por el art. 20 (sanidad, educación, seguros, alquiler de vivienda…)",
  E2: "E2 · Exenta por el art. 21 (exportaciones)",
  E3: "E3 · Exenta por el art. 22 (operaciones asimiladas a exportaciones)",
  E4: "E4 · Exenta por los arts. 23 y 24 (zonas francas y regímenes aduaneros)",
  E5: "E5 · Exenta por el art. 25 (entregas intracomunitarias)",
  E6: "E6 · Exenta por otras causas",
  N1: "N1 · No sujeta por los arts. 7, 14 y otros",
  N2: "N2 · No sujeta por reglas de localización",
};

const pick = (code: string | null | undefined, allowed: readonly string[], fallback: string) => (code && allowed.includes(code) ? code : fallback);

/** Recargo de equivalencia asociado a cada tipo de IVA (art. 161 LIVA). */
const SURCHARGE_BY_VAT_RATE: Record<string, number[]> = {
  "21": [5.2, 1.75],
  "10": [1.4],
  "5": [0.62],
  "4": [0.5],
};

const cents = (value: number) => Math.round(value * 100);
const fromCents = (value: number) => formatAeatAmount(value / 100);
const rateText = (rate: number) => formatAeatAmount(rate);

function recipientFor(customer: MapInvoiceInput["customer"]): VerifactuRecipient | null {
  const taxId = customer?.taxId?.toUpperCase().replace(/[\s.-]/g, "") || null;
  if (!customer || !taxId) return null;
  const country = (customer.countryCode ?? "ES").trim().toUpperCase() || "ES";
  if (country === "ES") return { name: customer.name, taxId: normalizeIssuerNif(taxId), countryCode: "ES", idType: null };
  return { name: customer.name, taxId, countryCode: country, idType: EU_COUNTRY_CODES.has(country) ? "02" : "04" };
}

function exemptLine(treatment: SalesTreatment, baseCents: number, code?: string | null): VerifactuBreakdownLine {
  const base = fromCents(baseCents);
  switch (treatment) {
    case "INTRA_EU":
      return { Impuesto: "01", ClaveRegimen: "01", OperacionExenta: pick(code, EXEMPTION_CODES, "E5"), BaseImponibleOimporteNoSujeto: base };
    case "EXPORT":
      return { Impuesto: "01", ClaveRegimen: "02", OperacionExenta: pick(code, EXEMPTION_CODES, "E2"), BaseImponibleOimporteNoSujeto: base };
    case "REVERSE_CHARGE":
      return { Impuesto: "01", ClaveRegimen: "01", CalificacionOperacion: "S2", TipoImpositivo: "0.00", BaseImponibleOimporteNoSujeto: base, CuotaRepercutida: "0.00" };
    case "NOT_SUBJECT":
      return { Impuesto: "01", ClaveRegimen: "01", CalificacionOperacion: pick(code, NOT_SUBJECT_CODES, "N2"), BaseImponibleOimporteNoSujeto: base };
    default:
      return { Impuesto: "01", ClaveRegimen: "01", OperacionExenta: pick(code, EXEMPTION_CODES, "E1"), BaseImponibleOimporteNoSujeto: base };
  }
}

/** Desglose (DetalleDesglose) y totales CuotaTotal / ImporteTotal a partir del desglose por tipo de la factura. */
export function buildBreakdown(treatment: SalesTreatment, totals: MapInvoiceInput["totals"], taxCode: VerifactuTaxCode = "01", exemptionCode?: string | null) {
  const subtotalCents = cents(totals.subtotal);
  const vatBuckets = totals.taxBuckets.filter((bucket) => bucket.operation === "ADD" && (bucket.kind ?? "VAT").toUpperCase() === "VAT");
  const surchargeBuckets = totals.taxBuckets.filter((bucket) => bucket.operation === "ADD" && (bucket.kind ?? "").toUpperCase() === "SURCHARGE");
  const lines: VerifactuBreakdownLine[] = [];
  let quotaCents = 0;
  let coveredBaseCents = 0;
  const usedSurcharges = new Set<InvoiceTaxBucket>();

  if (treatment === "DOMESTIC") {
    for (const bucket of [...vatBuckets].sort((left, right) => right.rate - left.rate)) {
      const baseCents = cents(bucket.baseAmount);
      const amountCents = cents(bucket.amount);
      // Tipo 0 sin cuota fuera del IGIC: no es S1; su base cae en la línea exenta de más abajo.
      if (taxCode !== "03" && bucket.rate === 0 && amountCents === 0) continue;
      const surcharge = surchargeBuckets.find((candidate) => !usedSurcharges.has(candidate)
        && ((SURCHARGE_BY_VAT_RATE[String(bucket.rate)] ?? []).includes(candidate.rate) || cents(candidate.baseAmount) === baseCents));
      if (surcharge) usedSurcharges.add(surcharge);
      const line: VerifactuBreakdownLine = {
        Impuesto: "01",
        ClaveRegimen: "01",
        CalificacionOperacion: "S1",
        TipoImpositivo: rateText(bucket.rate),
        BaseImponibleOimporteNoSujeto: fromCents(baseCents),
        CuotaRepercutida: fromCents(amountCents),
      };
      if (surcharge) {
        line.TipoRecargoEquivalencia = rateText(surcharge.rate);
        line.CuotaRecargoEquivalencia = fromCents(cents(surcharge.amount));
        quotaCents += cents(surcharge.amount);
      }
      lines.push(line);
      quotaCents += amountCents;
      coveredBaseCents += baseCents;
    }
    // Recargos sin IVA emparejable (datos atípicos): se suman a la cuota para no perder importe.
    for (const surcharge of surchargeBuckets) {
      if (!usedSurcharges.has(surcharge)) quotaCents += cents(surcharge.amount);
    }
  }

  const uncoveredCents = subtotalCents - coveredBaseCents;
  if (uncoveredCents !== 0 || lines.length === 0) lines.push(exemptLine(treatment, uncoveredCents, exemptionCode));

  return {
    lines: lines.map((line) => withTaxCode(line, taxCode)),
    taxAmount: fromCents(quotaCents),
    totalAmount: fromCents(subtotalCents + quotaCents),
  };
}

export function mapInvoiceToAlta(input: MapInvoiceInput): VerifactuAltaContent {
  const recipient = recipientFor(input.customer);
  const breakdown = buildBreakdown(input.vatTreatment, input.totals, input.taxCode ?? "01", input.exemptionCode);
  // Un abono que cita simplificadas sustituidas no es una rectificativa: es la F3 de signo
  // contrario que anula un canje erróneo.
  const isSubstitutiveCancellation = input.invoiceType === "CREDIT_NOTE" && Boolean(input.substituted?.length) && Boolean(recipient);
  const isCreditNote = input.invoiceType === "CREDIT_NOTE" && !isSubstitutiveCancellation;

  let invoiceTypeCode: VerifactuInvoiceTypeCode;
  if (isCreditNote) {
    const reason = ["R1", "R2", "R3", "R4", "R5"].includes(input.rectificationReason ?? "") ? (input.rectificationReason as VerifactuInvoiceTypeCode) : "R4";
    // Sin registro de la original (anterior a VERI*FACTU) manda la clase heredada de ella.
    const originalSimplified = input.original?.invoiceTypeCode
      ? input.original.invoiceTypeCode === "F2" || input.original.invoiceTypeCode === "R5"
      : input.documentClass === "SIMPLIFIED";
    // R1–R4 exigen Destinatarios (apdo. 13): sin NIF solo cabe R5.
    invoiceTypeCode = originalSimplified || !recipient ? "R5" : reason === "R5" ? "R4" : reason;
  } else if (input.substituted?.length && recipient) {
    invoiceTypeCode = "F3";
  } else {
    invoiceTypeCode = recipient && input.documentClass !== "SIMPLIFIED" ? "F1" : "F2";
  }
  const identifiesRecipient = invoiceTypeCode !== "F2" && invoiceTypeCode !== "R5";

  const description = input.description.trim().replace(/\s+/g, " ").slice(0, 500) || "Prestación de servicios / entrega de bienes";

  return {
    invoiceTypeCode,
    rectificationKind: isCreditNote ? "I" : null,
    rectifiedInvoices: isCreditNote && input.original
      ? [{ issuerTaxId: input.original.issuerTaxId, invoiceNumber: input.original.invoiceNumber, invoiceIssueDate: input.original.invoiceIssueDate }]
      : null,
    substitutedInvoices: invoiceTypeCode === "F3" ? input.substituted ?? null : null,
    simplifiedArt7273: identifiesRecipient && input.documentClass === "SIMPLIFIED_QUALIFIED",
    description,
    // Las simplificadas (F2) y sus rectificativas (R5) no identifican destinatario.
    recipient: identifiesRecipient ? recipient : null,
    breakdown: breakdown.lines,
    operationDate: input.operationDate || null,
    taxAmount: breakdown.taxAmount,
    totalAmount: breakdown.totalAmount,
    simplifiedOverLimit: invoiceTypeCode === "F2" && Math.abs(Number(breakdown.totalAmount)) > SIMPLIFIED_INVOICE_LIMIT,
  };
}

export const verifactuInvoiceTypeLabels: Record<string, string> = {
  F1: "F1 · Factura completa",
  F2: "F2 · Factura simplificada",
  F3: "F3 · Sustitutiva de simplificadas",
  R1: "R1 · Rectificativa (error fundado en derecho / art. 80 Uno, Dos y Seis)",
  R2: "R2 · Rectificativa (concurso de acreedores)",
  R3: "R3 · Rectificativa (crédito incobrable)",
  R4: "R4 · Rectificativa (resto de causas)",
  R5: "R5 · Rectificativa de simplificada",
};
