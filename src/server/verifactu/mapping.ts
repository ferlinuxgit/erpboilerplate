/**
 * Traducción de una factura emitida a los campos del registro de facturación VeriFactu
 * (RegistroAlta del esquema SuministroInformacion.xsd). Código puro, sin base de datos.
 *
 * Decisiones (documentadas también en el informe de implantación):
 * - TipoFactura F1 si el cliente tiene NIF / NIF-IVA; F2 (simplificada, art. 4 y 7.2 RD 1619/2012)
 *   si no lo tiene. Las facturas a clientes sin NIF por encima del límite de simplificada (400 € o
 *   3.000 € según actividad) se marcan igualmente F2 y la UI avisa (`simplifiedOverLimit`).
 * - Rectificativas: R1–R4 según la causa guardada; R5 si la factura original era simplificada (F2).
 * - TipoRectificativa "I" (por diferencias): nuestras rectificativas siempre expresan importes por
 *   diferencia (también las de tipo "sustitución", que llevan las líneas originales en negativo y
 *   las nuevas en positivo), así que "I" es la representación exacta de sus importes.
 * - ImporteTotal = bases + cuotas de IVA + recargo de equivalencia, sin restar retenciones de IRPF
 *   (la AEAT valida que coincida con la suma del desglose).
 */
import type { InvoiceTaxBucket } from "@/lib/invoice-totals";
import { EU_COUNTRY_CODES } from "@/lib/fiscal-spain";
import { formatAeatAmount, normalizeIssuerNif } from "@/server/verifactu/format";

export type VerifactuInvoiceTypeCode = "F1" | "F2" | "F3" | "R1" | "R2" | "R3" | "R4" | "R5";

export type VerifactuBreakdownLine = {
  Impuesto: string;
  ClaveRegimen: string;
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
  description: string;
  recipient: VerifactuRecipient | null;
  breakdown: VerifactuBreakdownLine[];
  taxAmount: string;
  totalAmount: string;
  /** Aviso: sin NIF de cliente y total por encima del límite general de factura simplificada. */
  simplifiedOverLimit: boolean;
};

export type SalesTreatment = "DOMESTIC" | "INTRA_EU" | "EXPORT" | "EXEMPT" | "REVERSE_CHARGE" | "NOT_SUBJECT";

export type MapInvoiceInput = {
  invoiceType: "INVOICE" | "CREDIT_NOTE" | string;
  rectificationReason: string | null;
  vatTreatment: SalesTreatment;
  customer: { name: string; taxId: string | null; countryCode: string | null } | null;
  totals: { subtotal: number; taxBuckets: InvoiceTaxBucket[] };
  description: string;
  /** Factura original de una rectificativa (datos tal y como constan en su registro). */
  original?: { issuerTaxId: string; invoiceNumber: string; invoiceIssueDate: string; invoiceTypeCode: string | null } | null;
};

export const SIMPLIFIED_INVOICE_LIMIT = 400;

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

function exemptLine(treatment: SalesTreatment, baseCents: number): VerifactuBreakdownLine {
  const base = fromCents(baseCents);
  switch (treatment) {
    case "INTRA_EU":
      return { Impuesto: "01", ClaveRegimen: "01", OperacionExenta: "E5", BaseImponibleOimporteNoSujeto: base };
    case "EXPORT":
      return { Impuesto: "01", ClaveRegimen: "02", OperacionExenta: "E2", BaseImponibleOimporteNoSujeto: base };
    case "REVERSE_CHARGE":
      return { Impuesto: "01", ClaveRegimen: "01", CalificacionOperacion: "S2", TipoImpositivo: "0.00", BaseImponibleOimporteNoSujeto: base, CuotaRepercutida: "0.00" };
    case "NOT_SUBJECT":
      return { Impuesto: "01", ClaveRegimen: "01", CalificacionOperacion: "N2", BaseImponibleOimporteNoSujeto: base };
    default:
      return { Impuesto: "01", ClaveRegimen: "01", OperacionExenta: "E1", BaseImponibleOimporteNoSujeto: base };
  }
}

/** Desglose (DetalleDesglose) y totales CuotaTotal / ImporteTotal a partir del desglose por tipo de la factura. */
export function buildBreakdown(treatment: SalesTreatment, totals: MapInvoiceInput["totals"]) {
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
  if (uncoveredCents !== 0 || lines.length === 0) lines.push(exemptLine(treatment, uncoveredCents));

  return {
    lines,
    taxAmount: fromCents(quotaCents),
    totalAmount: fromCents(subtotalCents + quotaCents),
  };
}

export function mapInvoiceToAlta(input: MapInvoiceInput): VerifactuAltaContent {
  const recipient = recipientFor(input.customer);
  const breakdown = buildBreakdown(input.vatTreatment, input.totals);
  const isCreditNote = input.invoiceType === "CREDIT_NOTE";

  let invoiceTypeCode: VerifactuInvoiceTypeCode;
  if (isCreditNote) {
    const reason = ["R1", "R2", "R3", "R4", "R5"].includes(input.rectificationReason ?? "") ? (input.rectificationReason as VerifactuInvoiceTypeCode) : "R4";
    const originalSimplified = input.original?.invoiceTypeCode === "F2" || input.original?.invoiceTypeCode === "R5";
    invoiceTypeCode = originalSimplified ? "R5" : reason === "R5" ? "R4" : reason;
  } else {
    invoiceTypeCode = recipient ? "F1" : "F2";
  }

  const description = input.description.trim().replace(/\s+/g, " ").slice(0, 500) || "Prestación de servicios / entrega de bienes";

  return {
    invoiceTypeCode,
    rectificationKind: isCreditNote ? "I" : null,
    rectifiedInvoices: isCreditNote && input.original
      ? [{ issuerTaxId: input.original.issuerTaxId, invoiceNumber: input.original.invoiceNumber, invoiceIssueDate: input.original.invoiceIssueDate }]
      : null,
    description,
    // Las simplificadas (F2) y sus rectificativas (R5) no identifican destinatario.
    recipient: invoiceTypeCode === "F2" || invoiceTypeCode === "R5" ? null : recipient,
    breakdown: breakdown.lines,
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
