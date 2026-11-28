/**
 * Traducción de las facturas del ERP a registros del SII. Código puro, sin base de datos.
 *
 * Decisiones (contrastadas con el documento «Validaciones y errores del SII» v1.1, rev. 17):
 * - EXPEDIDAS. El tipo de factura, la contraparte y el desglose por tipo salen de las mismas
 *   funciones que VERI*FACTU (`mapInvoiceToAlta` / `buildBreakdown`), para que ambos suministros
 *   digan lo mismo de una factura. Rectificativas siempre «I» (por diferencias).
 * - El desglose va a nivel de factura salvo que la contraparte se identifique con IDOtro o con un
 *   NIF que empiece por N (y no sea simplificada): entonces es obligatorio por tipo de operación
 *   (entregas / prestaciones de servicios), que se reparte según el artículo de cada línea.
 * - Clave de régimen: 02 (exportación) en las exportaciones y cuando la causa de exención es E2 o
 *   E3 (la AEAT las rechaza con la clave 01 sola); 01 en el resto.
 * - RECIBIDAS. Adquisición intracomunitaria → clave 09 y bloque DesgloseIVA con la cuota
 *   autoliquidada (la clave 09 no admite el bloque de inversión del sujeto pasivo). Inversión del
 *   sujeto pasivo → clave 01 y bloque InversionSujetoPasivo. Importación → tipo F5: se identifica
 *   por el DUA y el emisor y la contraparte son el propio titular.
 * - Cuota deducible = cuota × % deducible de la línea × prorrata; 0 en simplificadas y con recargo.
 * - CRITERIO DE CAJA (clave 07, arts. 163 decies y ss. LIVA). Expedidas: la empresa está acogida
 *   (`cashAccounting`) y la operación es nacional; la AEAT exige además que no haya bloque no
 *   sujeto, ni S2/S3, ni exenciones E2 a E5 (validación 17 de expedidas): si la factura no lo
 *   cumple, va con su clave ordinaria (son las operaciones excluidas del régimen, art. 163
 *   duodecies.Dos). Recibidas: la empresa está acogida o el proveedor lo está
 *   (`supplierCashAccounting`) y la operación es nacional (la clave 07 no admite el bloque de
 *   inversión del sujeto pasivo: validación 9 de recibidas). Los cobros y pagos de las facturas
 *   con clave 07 se suministran aparte (`cash.ts`).
 * - RECTIFICATIVAS: siempre por diferencias («I»). El programa registra una rectificativa como un
 *   documento con las diferencias (importes negativos), nunca como una factura que sustituye a
 *   otra; por eso la rectificación por sustitución («S», con ImporteRectificacion) NO APLICA. El
 *   generador de XML la admite, pero ningún flujo del programa la produce.
 *
 * Lo que una factura no permite suministrar (falta el NIF, falta el DUA…) se devuelve en
 * `problems`: el registro se crea igualmente, pero bloqueado y con el motivo a la vista.
 */
import { calculateInvoiceTotals, type InvoiceCalculationLine } from "@/lib/invoice-totals";
import { EU_COUNTRY_CODES, reverseChargeTaxAmount, type SalesVatTreatment, type SupplierVatTreatment } from "@/lib/fiscal-spain";
import { fiscalCivilDate } from "@/lib/fiscal-spain";
import type { CivilDate } from "@/server/sii/deadlines";
import type { SiiCancellation, SiiIssuedBreakdown, SiiIssuedInvoice, SiiParty, SiiPartyId, SiiInvoicePayload, SiiReceivedInvoice, SiiVatDetail } from "@/server/sii/types";
import { formatAeatAmount, formatAeatDate, isValidIssuerNifFormat, normalizeIssuerNif } from "@/server/verifactu/format";
import { buildBreakdown, mapInvoiceToAlta, type SalesTreatment, type VerifactuBreakdownLine } from "@/server/verifactu/mapping";

const cents = (value: number | string | null | undefined) => Math.round(Number(value ?? 0) * 100);
const money = (valueCents: number) => formatAeatAmount(valueCents / 100);
const sumText = (left: string | null | undefined, rightCents: number) => money(cents(left) + rightCents);

export type SiiMapped<T> = { invoice: T; problems: string[] };

/** Periodo de liquidación del SII: siempre mensual (el SII obliga a liquidar el IVA cada mes). */
export function siiPeriodOf(date: Date, timeZone: string) {
  const civil = fiscalCivilDate(date, timeZone);
  return { year: String(civil.year), period: String(civil.month).padStart(2, "0") };
}

export function civilDateOf(date: Date, timeZone: string): CivilDate {
  return fiscalCivilDate(date, timeZone);
}

const cleanTaxId = (value: string | null | undefined) => (value ?? "").toUpperCase().replace(/[\s.\-/]/g, "");

/**
 * Identificación de un tercero: NIF si es español; si no, IDOtro con NIF-IVA (02) dentro de la UE
 * —el identificador lleva el prefijo del Estado miembro, EL para Grecia— o documento oficial del
 * país de residencia (04) fuera de ella. null si no tiene identificador.
 */
export function siiPartyId(taxId: string | null | undefined, countryCode: string | null | undefined): SiiPartyId | null {
  const id = cleanTaxId(taxId);
  if (!id) return null;
  const country = (countryCode ?? "ES").trim().toUpperCase().slice(0, 2) || "ES";
  if (country === "ES") return { nif: normalizeIssuerNif(id) };
  if (EU_COUNTRY_CODES.has(country)) {
    const prefix = country === "GR" ? "EL" : country;
    return { idOtro: { idType: "02", id: id.startsWith(prefix) ? id : `${prefix}${id}` } };
  }
  return { idOtro: { countryCode: country, idType: "04", id } };
}

/** Líneas de desglose de VERI*FACTU → bloques Sujeta (Exenta / NoExenta) y NoSujeta del SII. */
export function toSiiIssuedBreakdown(lines: VerifactuBreakdownLine[]): SiiIssuedBreakdown {
  const exempt = new Map<string, number>();
  const details: SiiVatDetail[] = [];
  let hasS1 = false;
  let hasS2 = false;
  let articles: string | null = null;
  let location: string | null = null;
  for (const line of lines) {
    const baseCents = cents(line.BaseImponibleOimporteNoSujeto);
    if (line.OperacionExenta) {
      exempt.set(line.OperacionExenta, (exempt.get(line.OperacionExenta) ?? 0) + baseCents);
    } else if (line.CalificacionOperacion === "N1") {
      articles = sumText(articles, baseCents);
    } else if (line.CalificacionOperacion === "N2") {
      location = sumText(location, baseCents);
    } else if (line.CalificacionOperacion === "S2") {
      hasS2 = true;
      // Con inversión del sujeto pasivo el tipo y la cuota van a cero (no se admiten en blanco).
      details.push({ rate: "0.00", base: money(baseCents), quota: "0.00" });
    } else {
      hasS1 = true;
      details.push({
        rate: line.TipoImpositivo ?? null,
        base: money(baseCents),
        quota: line.CuotaRepercutida ?? null,
        surchargeRate: line.TipoRecargoEquivalencia ?? null,
        surchargeQuota: line.CuotaRecargoEquivalencia ?? null,
      });
    }
  }
  return {
    exempt: [...exempt.entries()].map(([cause, baseCents]) => ({ cause, base: money(baseCents) })),
    notExempt: details.length > 0 ? { type: hasS1 && hasS2 ? "S3" : hasS2 ? "S2" : "S1", details } : null,
    notSubjectArticles: articles,
    notSubjectLocation: location,
  };
}

export type SiiIssuedSource = {
  number: string;
  issueDate: Date;
  operationDate: Date | null;
  invoiceType: string;
  rectificationReason: string | null;
  rectificationDescription: string | null;
  /** Tratamiento de IVA ya resuelto (explícito o por el país del cliente). */
  vatTreatment: SalesVatTreatment;
  exemptionCode: string | null;
  holder: { name: string; nif: string | null };
  customer: { name: string; taxId: string | null; countryCode: string | null } | null;
  lines: Array<InvoiceCalculationLine & { isService?: boolean | null }>;
  /** Factura que rectifica: su número, fecha y si era simplificada. */
  original: { number: string; issueDate: Date; simplified: boolean } | null;
  timeZone: string;
  /** Las líneas sin artículo se tratan como servicios (empresa de servicios) o como entregas. */
  servicesByDefault?: boolean;
  /** La empresa aplica el régimen especial del criterio de caja a esta operación (clave 07 si es nacional). */
  cashAccounting?: boolean;
  /**
   * Factura que sustituye a simplificadas ya emitidas y declaradas (canje, `invoice.isSubstitutive`),
   * o su anulación al corregir un canje: se declara como F3 (lista L2 del SII), no como F1 ni como
   * rectificativa.
   */
  substitutive?: boolean;
};

/** Clave de régimen del criterio de caja (lista L3.1 y L3.2). */
export const SII_CASH_ACCOUNTING_KEY = "07";

/** ¿Admite la AEAT la clave 07 como única clave con este desglose? (validación 17 de expedidas). */
export function issuedBreakdownAllowsCashAccounting(breakdown: SiiIssuedInvoice["breakdown"]) {
  const parts = breakdown.level === "invoice" ? [breakdown.invoice] : [breakdown.services, breakdown.goods];
  return parts.every((part) => !part || (
    !part.notSubjectArticles && !part.notSubjectLocation
    && (!part.notExempt || part.notExempt.type === "S1")
    && (part.exempt ?? []).every((detail) => !["E2", "E3", "E4", "E5"].includes(detail.cause ?? ""))
  ));
}

/** Los servicios intracomunitarios B2B se declaran como no sujetos por reglas de localización. */
function breakdownTreatment(treatment: SalesVatTreatment): SalesTreatment {
  return treatment === "INTRA_EU_SERVICES" ? "NOT_SUBJECT" : treatment;
}

function hasContent(breakdown: SiiIssuedBreakdown) {
  return Boolean((breakdown.exempt?.length ?? 0) > 0 || breakdown.notExempt || breakdown.notSubjectArticles || breakdown.notSubjectLocation);
}

function breakdownTotalCents(breakdown: SiiIssuedBreakdown) {
  let total = cents(breakdown.notSubjectArticles) + cents(breakdown.notSubjectLocation);
  for (const detail of breakdown.exempt ?? []) total += cents(detail.base);
  for (const detail of breakdown.notExempt?.details ?? []) total += cents(detail.base) + cents(detail.quota) + cents(detail.surchargeQuota);
  return total;
}

export function mapIssuedInvoice(source: SiiIssuedSource): SiiMapped<SiiIssuedInvoice> {
  const problems: string[] = [];
  const isCreditNote = source.invoiceType === "CREDIT_NOTE";
  const treatment = breakdownTreatment(source.vatTreatment);
  const totals = calculateInvoiceTotals(source.lines, { allowNegative: isCreditNote });
  const issueDate = formatAeatDate(source.issueDate, source.timeZone);
  const operationDate = source.operationDate ? formatAeatDate(source.operationDate, source.timeZone) : null;
  const issuerNif = normalizeIssuerNif(source.holder.nif);
  if (!isValidIssuerNifFormat(issuerNif)) problems.push("La empresa no tiene un NIF válido: complétalo en Configuración › Empresa.");
  if (source.number.length > 60) problems.push("El número de la factura supera los 60 caracteres que admite el SII.");

  const descriptions = [...new Set(source.lines.map((line) => (line.description ?? "").trim()).filter(Boolean))];
  const alta = mapInvoiceToAlta({
    invoiceType: source.invoiceType,
    rectificationReason: source.rectificationReason,
    vatTreatment: treatment,
    customer: source.customer,
    totals,
    description: isCreditNote
      ? `Rectificación de la factura ${source.original?.number ?? ""}. ${source.rectificationDescription ?? ""}`.trim()
      : descriptions.join("; ") || `Factura ${source.number}`,
    exemptionCode: source.exemptionCode,
    original: source.original
      ? { issuerTaxId: issuerNif, invoiceNumber: source.original.number, invoiceIssueDate: formatAeatDate(source.original.issueDate, source.timeZone), invoiceTypeCode: source.original.simplified ? "F2" : "F1" }
      : null,
  });

  const partyId = alta.recipient ? siiPartyId(alta.recipient.taxId, alta.recipient.countryCode) : null;
  const counterparty: SiiParty | null = alta.recipient && partyId ? { name: alta.recipient.name, ...partyId } : null;
  // Validación de la AEAT: con IDOtro o un NIF que empiece por N el desglose es por tipo de operación.
  const byOperation = Boolean(counterparty && (counterparty.idOtro || counterparty.nif?.startsWith("N")));

  let breakdown: SiiIssuedInvoice["breakdown"];
  let totalCents: number;
  if (!byOperation) {
    const invoice = toSiiIssuedBreakdown(alta.breakdown);
    breakdown = { level: "invoice", invoice };
    totalCents = breakdownTotalCents(invoice);
  } else {
    // Entregas intracomunitarias y exportaciones son entregas de bienes; los servicios
    // intracomunitarios, prestaciones. En el resto decide el artículo de cada línea.
    const isService = (line: SiiIssuedSource["lines"][number]) => (
      source.vatTreatment === "INTRA_EU_SERVICES" ? true
        : source.vatTreatment === "INTRA_EU" || source.vatTreatment === "EXPORT" ? false
          : line.isService ?? Boolean(source.servicesByDefault)
    );
    const part = (lines: SiiIssuedSource["lines"]) => {
      if (lines.length === 0) return null;
      const partTotals = calculateInvoiceTotals(lines, { allowNegative: true });
      const mapped = toSiiIssuedBreakdown(buildBreakdown(treatment, partTotals, "01", source.exemptionCode).lines);
      return hasContent(mapped) ? mapped : null;
    };
    const services = part(source.lines.filter(isService));
    const goods = part(source.lines.filter((line) => !isService(line)));
    breakdown = { level: "operation", services, goods };
    totalCents = (services ? breakdownTotalCents(services) : 0) + (goods ? breakdownTotalCents(goods) : 0);
  }

  const causes = alta.breakdown.map((line) => line.OperacionExenta).filter(Boolean);
  const ordinaryKey = source.vatTreatment === "EXPORT" || causes.some((cause) => cause === "E2" || cause === "E3") ? "02" : "01";
  const regimeKey = source.cashAccounting && ordinaryKey === "01" && source.vatTreatment === "DOMESTIC" && issuedBreakdownAllowsCashAccounting(breakdown)
    ? SII_CASH_ACCOUNTING_KEY
    : ordinaryKey;
  const accrual = source.operationDate ?? source.issueDate;

  return {
    problems,
    invoice: {
      period: siiPeriodOf(accrual, source.timeZone),
      issuerNif,
      number: source.number,
      issueDate,
      invoiceType: source.substitutive ? "F3" : alta.invoiceTypeCode,
      rectification: isCreditNote && !source.substitutive
        ? { kind: "I", rectified: (alta.rectifiedInvoices ?? []).map((original) => ({ number: original.invoiceNumber, date: original.invoiceIssueDate })) }
        : null,
      operationDate: operationDate && operationDate !== issueDate ? operationDate : null,
      regimeKey,
      totalAmount: money(totalCents),
      description: alta.description,
      counterparty,
      breakdown,
    },
  };
}

export type SiiReceivedLine = {
  description: string | null;
  subtotal: number | string;
  taxAmount: number | string;
  taxRate: number | string;
  taxDeductiblePct: number | string | null;
  surchargeRate?: number | string | null;
  surchargeAmount?: number | string | null;
  isInvestmentGood?: boolean | null;
};

export type SiiReceivedSource = {
  /** Número interno del ERP (solo se usa si falta el número de la factura del proveedor). */
  number: string;
  supplierDocumentNumber: string | null;
  issueDate: Date;
  accountingDate: Date;
  operationDate: Date | null;
  documentKind: string;
  rectificationReason: string | null;
  rectified: { number: string | null; issueDate: Date | null } | null;
  isSimplified: boolean;
  vatTreatment: SupplierVatTreatment;
  importDuaNumber: string | null;
  importDuaDate: Date | null;
  /** Prorrata aplicada al contabilizar la factura (0–100). */
  prorrataPct: number;
  holder: { name: string; nif: string | null };
  supplier: { name: string; taxId: string | null; countryCode: string | null };
  lines: SiiReceivedLine[];
  timeZone: string;
  /** Tipo con el que se autoliquida una línea sin tipo (inversión del sujeto pasivo, intracomunitaria). */
  selfAssessmentRate?: number;
  /** La deducción nace con el pago: la empresa está en criterio de caja o lo está el proveedor (clave 07 si es nacional). */
  cashAccounting?: boolean;
};

export function mapReceivedInvoice(source: SiiReceivedSource): SiiMapped<SiiReceivedInvoice> {
  const problems: string[] = [];
  const holderNif = normalizeIssuerNif(source.holder.nif);
  if (!isValidIssuerNifFormat(holderNif)) problems.push("La empresa no tiene un NIF válido: complétalo en Configuración › Empresa.");
  const holder: SiiParty = { name: source.holder.name, nif: holderNif };
  const selfAssessed = source.vatTreatment === "INTRA_EU" || source.vatTreatment === "REVERSE_CHARGE";
  const isImport = source.vatTreatment === "IMPORT";
  const defaultRate = source.selfAssessmentRate ?? 21;
  const prorrata = Math.min(Math.max(source.prorrataPct, 0), 100);

  // Una línea de desglose por tipo, recargo y marca de bien de inversión.
  const groups = new Map<string, { rate: number; surchargeRate: number; investment: boolean; base: number; quota: number; surcharge: number }>();
  let deductibleCents = 0;
  let hasSurcharge = false;
  for (const line of source.lines) {
    const base = cents(line.subtotal);
    const charged = cents(line.taxAmount);
    const quota = selfAssessed ? cents(reverseChargeTaxAmount(Number(line.subtotal), Number(line.taxAmount), defaultRate)) : charged;
    const rate = selfAssessed && charged === 0 ? defaultRate : Number(line.taxRate);
    const surcharge = cents(line.surchargeAmount);
    const surchargeRate = surcharge !== 0 ? Number(line.surchargeRate ?? 0) : 0;
    if (surcharge !== 0) hasSurcharge = true;
    const investment = Boolean(line.isInvestmentGood);
    const key = `${rate}|${surchargeRate}|${investment}`;
    const group = groups.get(key) ?? { rate, surchargeRate, investment, base: 0, quota: 0, surcharge: 0 };
    group.base += base;
    group.quota += quota;
    group.surcharge += surcharge;
    groups.set(key, group);
    const deductiblePct = Math.min(Math.max(Number(line.taxDeductiblePct ?? 100), 0), 100);
    deductibleCents += Math.round((quota * deductiblePct * prorrata) / 10_000);
  }
  const details: SiiVatDetail[] = [...groups.values()]
    .sort((left, right) => right.rate - left.rate)
    .map((group) => {
      // Sin tipo ni cuota (exenta, no sujeta): solo se informa la base.
      const untaxed = group.quota === 0 && group.rate === 0;
      return {
        rate: untaxed ? null : formatAeatAmount(group.rate),
        base: money(group.base),
        quota: untaxed ? null : money(group.quota),
        surchargeRate: group.surcharge !== 0 ? formatAeatAmount(group.surchargeRate) : null,
        surchargeQuota: group.surcharge !== 0 ? money(group.surcharge) : null,
        investmentGood: group.investment,
      };
    });
  if (details.length > 12) problems.push("La factura tiene más de 12 combinaciones de tipo de IVA, recargo y bien de inversión: el SII no admite más.");

  const isRectification = source.documentKind === "RECTIFICATION";
  const reason = ["R1", "R2", "R3", "R4", "R5"].includes(source.rectificationReason ?? "") ? source.rectificationReason! : "R4";
  let invoiceType = isRectification ? (source.isSimplified ? "R5" : reason === "R5" ? "R4" : reason) : source.isSimplified ? "F2" : "F1";

  const issueDate = formatAeatDate(source.issueDate, source.timeZone);
  const accountingDate = formatAeatDate(source.accountingDate, source.timeZone);
  let number = (source.supplierDocumentNumber ?? "").trim() || source.number;
  let invoiceDate = issueDate;
  let issuer: SiiParty;

  if (isImport) {
    // Importación (F5): la clave del registro es el DUA, y emisor y contraparte son el titular.
    invoiceType = "F5";
    issuer = holder;
    number = (source.importDuaNumber ?? "").trim();
    if (!number) problems.push("Falta el número del DUA de la importación: anótalo en la factura para poder suministrarla.");
    if (source.importDuaDate) invoiceDate = formatAeatDate(source.importDuaDate, source.timeZone);
  } else {
    const id = siiPartyId(source.supplier.taxId, source.supplier.countryCode);
    if (!id) problems.push("El proveedor no tiene NIF: complétalo en su ficha para poder suministrar la factura.");
    issuer = { name: source.supplier.name, ...(id ?? { nif: "" }) };
    if (source.vatTreatment === "INTRA_EU" && id && !id.idOtro) problems.push("Una adquisición intracomunitaria necesita el NIF-IVA de un proveedor de otro país de la UE.");
  }
  if (number.length > 60) problems.push("El número de la factura supera los 60 caracteres que admite el SII.");
  if (source.accountingDate.getTime() < source.issueDate.getTime() && accountingDate !== issueDate) {
    problems.push("La fecha de registro es anterior a la de expedición de la factura: el SII la rechaza.");
  }

  const rectified = isRectification && source.rectified?.number && source.rectified.issueDate
    ? [{ number: source.rectified.number, date: formatAeatDate(source.rectified.issueDate, source.timeZone) }]
    : [];
  const operationDate = source.operationDate ? formatAeatDate(source.operationDate, source.timeZone) : null;
  const totalCents = [...groups.values()].reduce((sum, group) => sum + group.base + group.quota + group.surcharge, 0);
  const descriptions = [...new Set(source.lines.map((line) => (line.description ?? "").trim()).filter(Boolean))];
  // Simplificadas y facturas con recargo de equivalencia: la cuota no es deducible (validaciones de CuotaDeducible).
  const deductible = invoiceType === "F2" || invoiceType === "R5" || hasSurcharge ? 0 : deductibleCents;

  return {
    problems,
    invoice: {
      period: siiPeriodOf(source.accountingDate, source.timeZone),
      issuer,
      number,
      issueDate: invoiceDate,
      invoiceType,
      rectification: isRectification ? { kind: "I", rectified } : null,
      operationDate: operationDate && operationDate !== invoiceDate ? operationDate : null,
      // 09: adquisiciones intracomunitarias; 07: criterio de caja (solo operaciones nacionales); 01: régimen general.
      regimeKey: source.vatTreatment === "INTRA_EU" ? "09" : source.cashAccounting && source.vatTreatment === "DOMESTIC" ? SII_CASH_ACCOUNTING_KEY : "01",
      // Con autoliquidación el total de la factura no incluye la cuota: no se informa (es opcional).
      totalAmount: selfAssessed ? null : money(totalCents),
      description: (descriptions.join("; ") || `Factura ${number}`).slice(0, 500),
      reverseCharge: source.vatTreatment === "REVERSE_CHARGE" ? details.map((detail) => ({ ...detail, rate: detail.rate ?? "0.00", quota: detail.quota ?? "0.00" })) : [],
      vat: source.vatTreatment === "REVERSE_CHARGE" ? [] : details,
      counterparty: isImport ? holder : issuer,
      accountingDate,
      deductibleQuota: money(deductible),
    },
  };
}

/** Baja del registro de una factura ya suministrada, a partir de lo que se suministró. */
export function cancellationFor(payload: SiiInvoicePayload): SiiCancellation {
  if (payload.book === "ISSUED") {
    const { invoice } = payload;
    return { period: invoice.period, number: invoice.number, issueDate: invoice.issueDate, issuer: { nif: invoice.issuerNif } };
  }
  const { invoice } = payload;
  return { period: invoice.period, number: invoice.number, issueDate: invoice.issueDate, issuer: invoice.issuer };
}
