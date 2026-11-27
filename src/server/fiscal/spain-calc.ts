/**
 * Cálculo fiscal español (IVA 303/390, retenciones 111/115) a partir de líneas de factura.
 * Módulo puro (sin base de datos) para poder testear cada regla.
 *
 * Criterios, alineados con la contabilización automática (auto-post.ts) para que la
 * conciliación fiscal-contable cuadre al céntimo:
 * - Se usan los importes guardados (base y cuota por impuesto y línea), no se recalculan.
 * - IVA deducible por línea = cuota × % deducible de la línea × prorrata, redondeado a céntimos.
 * - ISP y adquisiciones intracomunitarias: la cuota se autorepercute (devengado) y se deduce.
 * - Recargo de equivalencia repercutido: casillas propias y cuenta 477.
 */
import {
  isSelfAssessedTreatment,
  modelo303RateBoxes,
  reverseChargeTaxAmount,
  type SalesVatTreatment,
  type SupplierVatTreatment,
  type VatBucket,
} from "@/lib/fiscal-spain";
import { applyPct, centsToNumber, toCents } from "@/server/accounting/money";
import { portionCents, type CashPortion } from "@/server/fiscal/cash-accounting";

export type Modelo303Box = {
  box: string;
  label: string;
  amount: number;
  kind: "base" | "tax" | "settlement" | "info";
};

export type FiscalSourceDocument = {
  id: string;
  /** Factura de origen (difiere de `id` en la fila de anulación de una factura recibida). */
  sourceId?: string;
  number: string;
  issueDate: string;
  /** Fecha de devengo aplicada (solo emitidas, cuando difiere de la de expedición). */
  accrualDate?: string;
  /** Fecha de registro (solo recibidas): la que determina el periodo. */
  registrationDate?: string;
  /** Cuota de IVA soportada según la factura (solo recibidas; `taxAmount` es la deducible). */
  chargedTaxAmount?: number;
  totalAmount: number;
  taxBase: number;
  taxAmount: number;
  withholdingAmount?: number;
  status?: string;
  vatTreatment?: string;
  /** Importes del tramo devengado o deducido en criterio de caja (no de la factura entera). */
  cashAccounting?: boolean;
};

type TaxInput = {
  rate: string | number;
  kind?: string | null;
  operation: "ADD" | "SUBTRACT" | string;
  baseAmount?: string | number | null;
  amount?: string | number | null;
};

export type IssuedLineInput = {
  invoiceId: string;
  number: string;
  issueDate: Date;
  /** Fecha de devengo que decide el periodo (fecha de operación si procede); por defecto la de expedición. */
  accrualDate?: Date;
  /** CREDIT_NOTE = factura rectificativa: en el 303 va a «modificación de bases y cuotas» (14-15 y 25-26). */
  invoiceType?: string | null;
  totalAmount: string | number;
  status?: string | null;
  treatment: SalesVatTreatment;
  quantity: string | number;
  unitPrice: string | number;
  discountPct?: string | number | null;
  taxRate?: string | number | null;
  retentionRate?: string | number | null;
  taxes?: TaxInput[] | null;
  /** Criterio de caja: tramo de la factura que se devenga en esta fila (ver `cash-accounting.ts`). */
  portion?: CashPortion | null;
  /** Operación acogida al régimen especial del criterio de caja. */
  cashAccounting?: boolean;
};

export type SupplierLineInput = {
  invoiceId: string;
  number: string;
  issueDate: Date;
  totalAmount: string | number;
  treatment: SupplierVatTreatment;
  subtotal: string | number;
  taxAmount: string | number;
  taxRate: string | number;
  taxDeductiblePct?: string | number | null;
  retentionAmount?: string | number | null;
  retentionRate?: string | number | null;
  expenseAccountCode?: string | null;
  /** Fecha de registro (periodo de IVA); por defecto la de la factura. */
  accountingDate?: Date;
  /** Prorrata aplicada al contabilizar la factura; si falta, la indicada al cálculo. */
  prorrataPct?: string | number | null;
  /** Marca de bien de inversión de la línea; una cuenta del grupo 2 lo es siempre. */
  isInvestmentGood?: boolean | null;
  /** Fecha del asiento de anulación (solo en la fila de anulación). */
  voidedAt?: Date | null;
  /** −1 en la fila de anulación de una factura recibida (resta en el periodo de la anulación). */
  sign?: 1 | -1;
  /** RECTIFICATION = rectificativa o abono del proveedor: su deducción va a las casillas 40-41 del 303. */
  documentKind?: string | null;
  /** Factura rectificada (si está registrada). */
  rectifiedInvoiceId?: string | null;
  /** Fecha de la operación si difiere de la de la factura. */
  operationDate?: Date | null;
  /** Proveedor acogido al criterio de caja: la cuota se deduce al pago. */
  supplierCashAccounting?: boolean | null;
  /** Criterio de caja: tramo de la factura que se deduce en esta fila y fecha en que se deduce. */
  portion?: CashPortion | null;
  cashAccounting?: boolean;
  cashReason?: string;
  deductionDate?: Date;
};

type CentsBucket = { rate: number; base: number; tax: number };
/** `fullBase`: base íntegra (sin prorratear) de las líneas con alguna cuota deducible. */
type BaseTax = { base: number; tax: number; fullBase: number };

function num(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rateKey(value: string | number | null | undefined) {
  return Math.round(num(value) * 100) / 100;
}

function addBucket(map: Map<number, CentsBucket>, rate: number, base: number, tax: number) {
  const bucket = map.get(rate) ?? { rate, base: 0, tax: 0 };
  bucket.base += base;
  bucket.tax += tax;
  map.set(rate, bucket);
}

function addBaseTax(target: BaseTax, base: number, tax: number, fullBase = base) {
  target.base += base;
  target.tax += tax;
  target.fullBase += fullBase;
}

function emptyBaseTax(): BaseTax {
  return { base: 0, tax: 0, fullBase: 0 };
}

export function bucketsToNumbers(map: Map<number, CentsBucket>): VatBucket[] {
  return [...map.values()]
    .filter((bucket) => bucket.base !== 0 || bucket.tax !== 0)
    .map((bucket) => ({ rate: bucket.rate, base: centsToNumber(bucket.base), tax: centsToNumber(bucket.tax) }))
    .sort((left, right) => right.rate - left.rate);
}

function lineBaseCents(line: { quantity: string | number; unitPrice: string | number; discountPct?: string | number | null }) {
  const discountPct = Math.min(Math.max(num(line.discountPct), 0), 100);
  return toCents(num(line.quantity) * num(line.unitPrice) * (1 - discountPct / 100));
}

export type IssuedVatResult = ReturnType<typeof computeIssuedVat>;

/** IVA devengado y retenciones soportadas (473) de facturas emitidas. */
export function computeIssuedVat(lines: IssuedLineInput[]) {
  const vat = new Map<number, CentsBucket>();
  const surcharge = new Map<number, CentsBucket>();
  const withholdings = new Map<number, CentsBucket>();
  // Parte de `vat` y `surcharge` que procede de facturas rectificativas (ya incluida en ellos).
  const rectification = { vat: new Map<number, CentsBucket>(), surcharge: new Map<number, CentsBucket>() };
  // Parte de `vat` (sin rectificativas) devengada en criterio de caja: el 390 la declara en casillas propias.
  const cashVat = new Map<number, CentsBucket>();
  const zeroRated: Record<SalesVatTreatment, number> = { DOMESTIC: 0, EXEMPT: 0, INTRA_EU: 0, INTRA_EU_SERVICES: 0, EXPORT: 0, REVERSE_CHARGE: 0, NOT_SUBJECT: 0 };
  let otherTaxCents = 0;
  const documents = new Map<string, { doc: FiscalSourceDocument; base: number; tax: number; withholding: number }>();
  const drafts = new Set<string>();

  for (const line of lines) {
    // Criterio de caja: cada importe de la línea se reduce al tramo que se devenga en esta fila.
    const part = (cents: number) => portionCents(cents, line.portion);
    const fullFallbackBase = lineBaseCents(line);
    const fallbackBase = part(fullFallbackBase);
    const isRectification = line.invoiceType === "CREDIT_NOTE";
    const isCash = Boolean(line.cashAccounting) && !isRectification;
    let lineBase = fallbackBase;
    let lineTax = 0;
    let lineWithholding = 0;
    let hasVat = false;

    if (line.taxes && line.taxes.length > 0) {
      for (const tax of line.taxes) {
        const fullBase = tax.baseAmount !== undefined && tax.baseAmount !== null ? toCents(tax.baseAmount) : fullFallbackBase;
        const base = part(fullBase);
        const amount = part(tax.amount !== undefined && tax.amount !== null ? toCents(tax.amount) : toCents((centsToNumber(fullBase) * num(tax.rate)) / 100));
        lineBase = base;
        const rate = rateKey(tax.rate);
        if (tax.operation === "SUBTRACT") {
          addBucket(withholdings, rate, base, amount);
          lineWithholding += amount;
        } else if (tax.kind === "SURCHARGE") {
          addBucket(surcharge, rate, base, amount);
          if (isRectification) addBucket(rectification.surcharge, rate, base, amount);
          lineTax += amount;
        } else if (tax.kind === "VAT" || !tax.kind) {
          if (rate > 0) {
            addBucket(vat, rate, base, amount);
            if (isRectification) addBucket(rectification.vat, rate, base, amount);
            if (isCash) addBucket(cashVat, rate, base, amount);
            hasVat = true;
          }
          lineTax += amount;
        } else {
          otherTaxCents += amount;
          lineTax += amount;
        }
      }
    } else {
      const rate = rateKey(line.taxRate);
      const tax = part(toCents((centsToNumber(fullFallbackBase) * rate) / 100));
      if (rate > 0) {
        addBucket(vat, rate, fallbackBase, tax);
        if (isRectification) addBucket(rectification.vat, rate, fallbackBase, tax);
        if (isCash) addBucket(cashVat, rate, fallbackBase, tax);
        hasVat = true;
        lineTax += tax;
      }
      const retentionRate = rateKey(line.retentionRate);
      if (retentionRate > 0) {
        const withholding = part(toCents((centsToNumber(fullFallbackBase) * retentionRate) / 100));
        addBucket(withholdings, retentionRate, fallbackBase, withholding);
        lineWithholding += withholding;
      }
    }

    // Base sin IVA: se clasifica según el tratamiento (entrega intracomunitaria, exportación, ISP…).
    if (!hasVat) zeroRated[line.treatment] += lineBase;

    if (line.status === "DRAFT") drafts.add(line.invoiceId);
    const entry = documents.get(line.invoiceId) ?? {
      doc: {
        id: line.invoiceId,
        number: line.number,
        issueDate: line.issueDate.toISOString(),
        ...(line.accrualDate && line.accrualDate.getTime() !== line.issueDate.getTime() ? { accrualDate: line.accrualDate.toISOString() } : {}),
        ...(line.cashAccounting ? { cashAccounting: true } : {}),
        totalAmount: centsToNumber(toCents(line.totalAmount)),
        taxBase: 0,
        taxAmount: 0,
        withholdingAmount: 0,
        status: line.status ?? undefined,
        vatTreatment: line.treatment,
      },
      base: 0,
      tax: 0,
      withholding: 0,
    };
    entry.base += lineBase;
    entry.tax += lineTax;
    entry.withholding += lineWithholding;
    documents.set(line.invoiceId, entry);
  }

  return {
    vat,
    surcharge,
    rectification,
    cashVat,
    withholdings,
    zeroRated,
    otherTaxCents,
    draftInvoiceCount: drafts.size,
    invoiceIds: new Set(documents.keys()),
    documents: [...documents.values()]
      .map(({ doc, base, tax, withholding }) => ({ ...doc, taxBase: centsToNumber(base), taxAmount: centsToNumber(tax), withholdingAmount: centsToNumber(withholding) }))
      .sort((left, right) => right.issueDate.localeCompare(left.issueDate)),
  };
}

export type SupplierVatResult = ReturnType<typeof computeSupplierVat>;

/** Conceptos de IVA deducible con el detalle que pide el 390 (adquisiciones intracomunitarias: bienes y servicios aparte). */
export type DeductibleCategory =
  | "domesticCurrent"
  | "domesticInvestment"
  | "importCurrent"
  | "importInvestment"
  | "intraEuGoodsCurrent"
  | "intraEuGoodsInvestment"
  | "intraEuServices";

/** IVA soportado/deducible, autorepercusiones y retenciones practicadas de facturas recibidas. */
/** `selfAssessmentRate`: tipo general del país para autorepercutir líneas sin cuota (España: 21 %). */
export function computeSupplierVat(lines: SupplierLineInput[], prorrataPct: number, selfAssessmentRate = 21) {
  const input = new Map<number, CentsBucket>();
  const deductible = {
    domesticCurrent: emptyBaseTax(),
    domesticInvestment: emptyBaseTax(),
    importCurrent: emptyBaseTax(),
    importInvestment: emptyBaseTax(),
    intraEuCurrent: emptyBaseTax(),
    intraEuInvestment: emptyBaseTax(),
    // Rectificación de deducciones (casillas 40-41): rectificativas y abonos recibidos.
    rectification: emptyBaseTax(),
  };
  const selfAssessed = { intraEu: emptyBaseTax(), reverseCharge: emptyBaseTax() };
  // Desglose por tipo que pide el 390 (bases sin prorratear); no incluye las rectificativas.
  const deductibleByRate: Record<DeductibleCategory, Map<number, CentsBucket>> = {
    domesticCurrent: new Map(),
    domesticInvestment: new Map(),
    importCurrent: new Map(),
    importInvestment: new Map(),
    intraEuGoodsCurrent: new Map(),
    intraEuGoodsInvestment: new Map(),
    intraEuServices: new Map(),
  };
  const selfAssessedByRate = { intraEuGoods: new Map<number, CentsBucket>(), intraEuServices: new Map<number, CentsBucket>() };
  const professional = new Map<number, CentsBucket>();
  const rent = new Map<number, CentsBucket>();
  let totalTax = 0;
  let deductibleTotal = 0;
  let defaultRateLines = 0;
  // Autorepercusión: el total a pagar al proveedor debe ser base − retención (el IVA no se le paga).
  const selfAssessedInvoices = new Map<string, { totalCents: number; baseCents: number; withholdingCents: number }>();
  const documents = new Map<string, { doc: FiscalSourceDocument; base: number; tax: number; charged: number; withholding: number }>();

  for (const line of lines) {
    // Importes de la factura tal cual; en la fila de anulación se restan.
    const sign = line.sign ?? 1;
    // Criterio de caja: cada importe se reduce al tramo que se deduce en esta fila.
    const part = (cents: number) => portionCents(cents, line.portion);
    const base = sign * part(toCents(line.subtotal));
    const charged = sign * part(toCents(line.taxAmount));
    const selfAssessedLine = isSelfAssessedTreatment(line.treatment);
    const vat = selfAssessedLine ? sign * part(toCents(reverseChargeTaxAmount(num(line.subtotal), num(line.taxAmount), selfAssessmentRate))) : charged;
    const rate = selfAssessedLine && charged === 0 ? selfAssessmentRate : rateKey(line.taxRate);
    if (selfAssessedLine && charged === 0 && base !== 0 && sign === 1) defaultRateLines += 1;
    if (selfAssessedLine && sign === 1) {
      const selfAssessedInvoice = selfAssessedInvoices.get(line.invoiceId) ?? { totalCents: toCents(line.totalAmount), baseCents: 0, withholdingCents: 0 };
      selfAssessedInvoice.baseCents += base;
      selfAssessedInvoice.withholdingCents += toCents(line.retentionAmount ?? 0);
      selfAssessedInvoices.set(line.invoiceId, selfAssessedInvoice);
    }

    const lineDeductiblePct = Math.min(Math.max(num(line.taxDeductiblePct ?? 100), 0), 100);
    const lineProrrataPct = line.prorrataPct === null || line.prorrataPct === undefined ? prorrataPct : Math.min(Math.max(num(line.prorrataPct), 0), 100);
    const effectivePct = (lineDeductiblePct * lineProrrataPct) / 100;
    const lineDeductible = applyPct(vat, effectivePct);
    const deductibleBase = vat !== 0 ? applyPct(base, effectivePct) : 0;
    // Instrucciones del 303 (IVA deducible): «las bases figurarán sin prorratear». La base íntegra
    // entra si la cuota es deducible total o parcialmente; las líneas sin cuota o no deducibles, no.
    const fullBase = vat !== 0 && effectivePct > 0 ? base : 0;
    const investment = Boolean(line.isInvestmentGood) || (line.expenseAccountCode ?? "").startsWith("2");

    if (vat !== 0 || base !== 0) addBucket(input, rate, base, vat);
    totalTax += vat;
    deductibleTotal += lineDeductible;

    // Rectificativas y abonos del proveedor: su deducción va a «rectificación de deducciones»
    // (casillas 40-41, con su signo), no a las casillas 28-39 del periodo.
    const isRectification = line.documentKind === "RECTIFICATION";
    const service = isServiceExpenseAccount(line.expenseAccountCode);
    let category: DeductibleCategory;
    if (line.treatment === "INTRA_EU") {
      addBaseTax(selfAssessed.intraEu, base, vat);
      if (vat !== 0 || base !== 0) addBucket(service ? selfAssessedByRate.intraEuServices : selfAssessedByRate.intraEuGoods, rate, base, vat);
      category = service ? "intraEuServices" : investment ? "intraEuGoodsInvestment" : "intraEuGoodsCurrent";
      if (!isRectification) addBaseTax(investment ? deductible.intraEuInvestment : deductible.intraEuCurrent, deductibleBase, lineDeductible, fullBase);
    } else if (line.treatment === "REVERSE_CHARGE") {
      addBaseTax(selfAssessed.reverseCharge, base, vat);
      category = investment ? "domesticInvestment" : "domesticCurrent";
      if (!isRectification) addBaseTax(investment ? deductible.domesticInvestment : deductible.domesticCurrent, deductibleBase, lineDeductible, fullBase);
    } else if (line.treatment === "IMPORT") {
      category = investment ? "importInvestment" : "importCurrent";
      if (!isRectification) addBaseTax(investment ? deductible.importInvestment : deductible.importCurrent, deductibleBase, lineDeductible, fullBase);
    } else {
      category = investment ? "domesticInvestment" : "domesticCurrent";
      if (!isRectification) addBaseTax(investment ? deductible.domesticInvestment : deductible.domesticCurrent, deductibleBase, lineDeductible, fullBase);
    }
    if (isRectification) addBaseTax(deductible.rectification, deductibleBase, lineDeductible, fullBase);
    else if (fullBase !== 0 || lineDeductible !== 0) addBucket(deductibleByRate[category], rate, fullBase, lineDeductible);

    const withholding = sign * part(toCents(line.retentionAmount ?? 0));
    if (withholding !== 0) {
      const retentionRate = rateKey(line.retentionRate) || (base !== 0 ? Math.round((withholding / base) * 10_000) / 100 : 0);
      // Arrendamientos (cuenta 621) → modelo 115; resto (profesionales) → modelo 111.
      addBucket((line.expenseAccountCode ?? "").startsWith("621") ? rent : professional, retentionRate, base, withholding);
    }

    // En criterio de caja una factura puede deducirse en varios tramos: un documento por tramo.
    const portionKey = line.portion ? `:${line.deductionDate?.toISOString() ?? ""}:${line.portion.from}` : "";
    const documentId = sign === 1 ? `${line.invoiceId}${portionKey}` : `${line.invoiceId}:anulacion`;
    const entry = documents.get(documentId) ?? {
      doc: {
        id: documentId,
        sourceId: line.invoiceId,
        number: sign === 1 ? line.number : `${line.number} (anulación)`,
        issueDate: line.issueDate.toISOString(),
        registrationDate: (line.accountingDate ?? line.issueDate).toISOString(),
        ...(line.deductionDate ? { accrualDate: line.deductionDate.toISOString() } : {}),
        ...(line.cashAccounting ? { cashAccounting: true } : {}),
        totalAmount: centsToNumber(sign * toCents(line.totalAmount)),
        taxBase: 0,
        taxAmount: 0,
        withholdingAmount: 0,
        vatTreatment: line.treatment,
      },
      base: 0,
      tax: 0,
      charged: 0,
      withholding: 0,
    };
    entry.base += base;
    entry.tax += lineDeductible;
    entry.charged += vat;
    entry.withholding += withholding;
    documents.set(documentId, entry);
  }

  return {
    input,
    deductible,
    deductibleByRate,
    selfAssessed,
    selfAssessedByRate,
    professional,
    rent,
    totalTaxCents: totalTax,
    deductibleCents: deductibleTotal,
    defaultRateLines,
    invoicesWithChargedSelfAssessedVat: countSelfAssessedTotalMismatches(selfAssessedInvoices),
    invoiceIds: new Set([...documents.values()].map(({ doc }) => doc.sourceId ?? doc.id)),
    documents: [...documents.values()]
      .map(({ doc, base, tax, charged, withholding }) => ({
        ...doc,
        taxBase: centsToNumber(base),
        taxAmount: centsToNumber(tax),
        chargedTaxAmount: centsToNumber(charged),
        withholdingAmount: centsToNumber(withholding),
      }))
      .sort((left, right) => (right.registrationDate ?? right.issueDate).localeCompare(left.registrationDate ?? left.issueDate)),
  };
}

/**
 * Facturas con autorepercusión (INTRA_EU / REVERSE_CHARGE) cuyo total a pagar no es base − retención
 * (tolerancia de 1 céntimo por redondeo). Suelen ser facturas antiguas que sumaban el IVA al total.
 */
export function countSelfAssessedTotalMismatches(invoices: Map<string, { totalCents: number; baseCents: number; withholdingCents: number }>) {
  let mismatches = 0;
  for (const entry of invoices.values()) {
    if (Math.abs(entry.totalCents - (entry.baseCents - entry.withholdingCents)) > 1) mismatches += 1;
  }
  return mismatches;
}

function sumMap(map: Map<number, CentsBucket>) {
  let base = 0;
  let tax = 0;
  for (const bucket of map.values()) {
    base += bucket.base;
    tax += bucket.tax;
  }
  return { base, tax };
}

export type Modelo303Totals = {
  /** Casilla 27: total cuota devengada (IVA + recargo + autorepercusiones). */
  accruedCents: number;
  /** Casilla 45: total a deducir. */
  deductibleCents: number;
  /** Casilla 46: resultado régimen general. */
  resultCents: number;
  domesticOutputCents: number;
  surchargeCents: number;
  selfAssessedCents: number;
};

/** Regularizaciones de deducciones del último periodo: aumentan (o, en negativo, reducen) la casilla 45. */
export type Modelo303Adjustments = {
  /** Casilla 43: regularización de bienes de inversión (arts. 107 a 110 LIVA). */
  investmentRegularizationCents?: number;
  /** Casilla 44: regularización por el porcentaje definitivo de prorrata (art. 105.Cuatro LIVA). */
  prorrataRegularizationCents?: number;
};

export function computeModelo303Totals(issued: IssuedVatResult, supplier: SupplierVatResult, adjustments: Modelo303Adjustments = {}): Modelo303Totals {
  const domesticOutput = sumMap(issued.vat).tax;
  const surcharge = sumMap(issued.surcharge).tax;
  const selfAssessed = supplier.selfAssessed.intraEu.tax + supplier.selfAssessed.reverseCharge.tax;
  const accrued = domesticOutput + surcharge + selfAssessed;
  const deductible = supplier.deductibleCents + (adjustments.investmentRegularizationCents ?? 0) + (adjustments.prorrataRegularizationCents ?? 0);
  return {
    accruedCents: accrued,
    deductibleCents: deductible,
    resultCents: accrued - deductible,
    domesticOutputCents: domesticOutput,
    surchargeCents: surcharge,
    selfAssessedCents: selfAssessed,
  };
}

export type Modelo303Compensation = {
  /** Casilla 110: cuotas a compensar pendientes de periodos anteriores. */
  pendingBeforeCents: number;
  /** Casilla 78: cuotas de periodos anteriores aplicadas en este periodo. */
  appliedCents: number;
  /** Casilla 87: cuotas de periodos anteriores pendientes para periodos posteriores (110 − 78). */
  pendingAfterCents: number;
  /** Casillas 69 y 71: resultado tras la compensación (negativo = a compensar o devolver). */
  resultCents: number;
  /** Saldo a compensar que nace en este periodo (resultado negativo); no forma parte de la casilla 87. */
  generatedCents: number;
  /** Saldo total a favor al terminar el periodo: 87 + el generado en él. */
  carryForwardCents: number;
};

/**
 * Compensación de cuotas del modelo 303 (casillas 110, 78 y 87; instrucciones AEAT de 2025).
 *
 * - `openingCents`: saldo a compensar que viene de ejercicios anteriores (configuración de la empresa).
 * - `previousResultsCents`: resultado (casilla 66) de cada periodo anterior del mismo ejercicio, en
 *   orden. Un resultado negativo aumenta el saldo; uno positivo lo consume hasta donde alcance.
 * - `resultCents`: resultado del periodo que se liquida, antes de compensar (casilla 66).
 *
 * En el periodo: 110 = saldo pendiente; 78 = lo aplicado, como máximo el resultado positivo;
 * 87 = 110 − 78; 69 = 66 − 78 (sin importaciones diferidas, casilla 77, ni regularizaciones 68/108).
 * Se supone que los resultados negativos anteriores se dejaron a compensar (no se pidió devolución).
 */
export function computeModelo303Compensation(input: { openingCents: number; previousResultsCents: number[]; resultCents: number }): Modelo303Compensation {
  let pending = Math.max(0, Math.round(input.openingCents));
  for (const previous of input.previousResultsCents) {
    if (previous < 0) pending += -previous;
    else pending -= Math.min(pending, previous);
  }
  const applied = input.resultCents > 0 ? Math.min(pending, input.resultCents) : 0;
  const pendingAfter = pending - applied;
  const result = input.resultCents - applied;
  const generated = result < 0 ? -result : 0;
  return {
    pendingBeforeCents: pending,
    appliedCents: applied,
    pendingAfterCents: pendingAfter,
    resultCents: result,
    generatedCents: generated,
    carryForwardCents: pendingAfter + generated,
  };
}

function subtractBucket(bucket: CentsBucket | undefined, minus: CentsBucket | undefined, rate: number): CentsBucket {
  return { rate, base: (bucket?.base ?? 0) - (minus?.base ?? 0), tax: (bucket?.tax ?? 0) - (minus?.tax ?? 0) };
}

/**
 * Volumen de operaciones del ejercicio (casillas 80, 93, 94, 83, 84, 125 y 88 del 303). Según las
 * instrucciones solo lo rellenan, en el último periodo, quienes están exonerados del 390
 * (arrendadores, régimen simplificado o libros en la sede: SII). `yearIssued` son las facturas
 * emitidas de todo el año natural por la regla general de devengo (art. 75 LIVA).
 *
 * Casilla 81 (y 653 del 390): operaciones en criterio de caja «como si no se les hubiera aplicado
 * el régimen»; `cashYearIssued` son esas facturas, también por la regla general, y `yearIssued` el
 * resto. No se calculan, porque el programa no tiene datos que las distingan: 126-127 (ventanilla
 * única), 128 (grupo de entidades), 86 (régimen simplificado), 95 (agricultura), 96 (recargo de
 * equivalencia propio), 97 (bienes usados), 98 (agencias de viajes) ni las minoraciones 79 y 99
 * (inmuebles, operaciones financieras no habituales y entregas de bienes de inversión).
 */
export function buildModelo303VolumeBoxes(yearIssued: IssuedVatResult, options: { numbered?: boolean; cashYearIssued?: IssuedVatResult; model?: "303" | "390" } = {}): Modelo303Box[] {
  const numbered = options.numbered ?? true;
  const money = (cents: number) => centsToNumber(cents);
  const cash = options.cashYearIssued;
  const cashGeneral = cash ? sumMap(cash.vat).base : 0;
  const zero = (treatment: SalesVatTreatment) => yearIssued.zeroRated[treatment] + (cash?.zeroRated[treatment] ?? 0);
  const general = sumMap(yearIssued.vat).base;
  const intraEu = zero("INTRA_EU") + zero("INTRA_EU_SERVICES");
  const exports = zero("EXPORT");
  const exempt = zero("EXEMPT") + zero("DOMESTIC");
  const notSubject = zero("NOT_SUBJECT");
  const reverseCharge = zero("REVERSE_CHARGE");
  // Numeración del 303 (instrucciones de 2025) y su equivalente del apartado 10 del 390.
  const rows: Array<[string, string, string, number]> = [
    ["80", "99", "Volumen del año · operaciones en régimen general (sin IVA ni recargo)", general],
    ["81", "653", "Volumen del año · operaciones en criterio de caja, por la regla general de devengo (art. 75 LIVA)", cashGeneral],
    ["93", "103", "Volumen del año · entregas intracomunitarias de bienes y servicios", intraEu],
    ["94", "104", "Volumen del año · exportaciones y otras exentas con derecho a deducción", exports],
    ["83", "105", "Volumen del año · exentas sin derecho a deducción y líneas sin IVA (si alguna es a tipo cero, va con las de derecho a deducción)", exempt],
    ["84", "110", "Volumen del año · no sujetas por reglas de localización", notSubject],
    ["125", "125", "Volumen del año · sujetas con inversión del sujeto pasivo", reverseCharge],
    ["88", "108", "Total volumen de operaciones del ejercicio (art. 121 LIVA)", general + cashGeneral + intraEu + exports + exempt + notSubject + reverseCharge],
  ];
  const annual = options.model === "390";
  return rows
    .filter(([box, , , cents]) => cents !== 0 || box === "80" || box === "88")
    .map(([box, annualBox, label, cents]) => ({ box: numbered ? (annual ? annualBox : box) : "", label, amount: money(cents), kind: "info" as const }));
}

export type Modelo303BoxOptions = {
  periodYear: number;
  /** Compensación de cuotas (110, 78, 87, 69). Sin ella, la 71 repite el resultado del régimen general. */
  compensation?: Modelo303Compensation;
  /** Solo en el último periodo (4T o mes 12): emitidas de todo el ejercicio, para el volumen de operaciones. */
  yearIssued?: IssuedVatResult;
  /** Solo en el último periodo: emitidas del ejercicio en criterio de caja, por la regla general (casilla 81). */
  cashYearIssued?: IssuedVatResult;
  /** Regularizaciones del último periodo (casillas 43 y 44). */
  adjustments?: Modelo303Adjustments;
  /** Casillas informativas del criterio de caja (62, 63, 74 y 75): importes por la regla general de devengo. */
  cashInfo?: Modelo303CashInfo;
};

/** Operaciones afectadas por el criterio de caja «como si no se les hubiera aplicado» (art. 75 LIVA). */
export type Modelo303CashInfo = {
  /** Casillas 62 y 63: entregas y servicios propios en criterio de caja. */
  salesBaseCents: number;
  salesTaxCents: number;
  /** Casillas 74 y 75: adquisiciones afectadas por el criterio de caja (propio o del proveedor). */
  purchaseBaseCents: number;
  purchaseTaxCents: number;
};

/**
 * Casillas del modelo 303 (instrucciones AEAT de 2025). Solo casillas de importe; los tipos (02,
 * 05…) se indican en la etiqueta. No se calculan: régimen simplificado, compensaciones del régimen
 * de la agricultura (42), importaciones con IVA diferido (77) ni la tributación conjunta con
 * haciendas forales (65, 68).
 *
 * - Las rectificativas y abonos recibidos van a «rectificación de deducciones» (40-41), con su
 *   signo, no dentro de 28-39.
 * - 43 y 44 (regularización de bienes de inversión y de la prorrata) solo en el último periodo y si
 *   se indican en `adjustments`.
 * - 62-63 y 74-75: informativas del criterio de caja, si se indican en `cashInfo`.
 *
 * - Las facturas rectificativas emitidas van a «modificación de bases y cuotas» (14-15; recargo en
 *   25-26), sin desglose por tipos y con su signo, no dentro de 01-09.
 * - Las bases deducibles (28-39) figuran sin prorratear; las cuotas, ya prorrateadas.
 */
export function buildModelo303Boxes(issued: IssuedVatResult, supplier: SupplierVatResult, options: Modelo303BoxOptions): Modelo303Box[] {
  const boxes: Modelo303Box[] = [];
  const money = (cents: number) => centsToNumber(cents);
  const zeroDomestic = issued.zeroRated.DOMESTIC;
  const rateBoxes = modelo303RateBoxes(options.periodYear);

  const outputRates = new Set<number>([4, 10, 21, ...issued.vat.keys()]);
  if (zeroDomestic !== 0 && options.periodYear <= 2024) outputRates.add(0);
  for (const rate of [...outputRates].sort((left, right) => left - right)) {
    const mapping = rateBoxes.output[String(rate)];
    const bucket = rate === 0 && !issued.vat.has(0)
      ? { rate, base: zeroDomestic, tax: 0 }
      : subtractBucket(issued.vat.get(rate), issued.rectification.vat.get(rate), rate);
    if (!mapping) {
      if (bucket.base === 0 && bucket.tax === 0) continue;
      boxes.push({ box: "REV", label: `Revisar: IVA devengado al ${rate}% no tiene casilla en el 303 vigente`, amount: money(bucket.tax), kind: "tax" });
      continue;
    }
    boxes.push({ box: mapping.base, label: `Base IVA devengado ${rate}%`, amount: money(bucket.base), kind: "base" });
    boxes.push({ box: mapping.tax, label: `Cuota IVA devengado ${rate}%`, amount: money(bucket.tax), kind: "tax" });
  }

  boxes.push({ box: "10", label: "Base adquisiciones intracomunitarias", amount: money(supplier.selfAssessed.intraEu.base), kind: "base" });
  boxes.push({ box: "11", label: "Cuota adquisiciones intracomunitarias (autorepercutida)", amount: money(supplier.selfAssessed.intraEu.tax), kind: "tax" });
  boxes.push({ box: "12", label: "Base otras operaciones con inversión del sujeto pasivo", amount: money(supplier.selfAssessed.reverseCharge.base), kind: "base" });
  boxes.push({ box: "13", label: "Cuota otras operaciones con inversión del sujeto pasivo", amount: money(supplier.selfAssessed.reverseCharge.tax), kind: "tax" });

  const vatModification = sumMap(issued.rectification.vat);
  if (vatModification.base !== 0 || vatModification.tax !== 0) {
    boxes.push({ box: "14", label: "Modificación de bases (facturas rectificativas emitidas)", amount: money(vatModification.base), kind: "base" });
    boxes.push({ box: "15", label: "Modificación de cuotas (facturas rectificativas emitidas)", amount: money(vatModification.tax), kind: "tax" });
  }

  for (const rate of [...issued.surcharge.keys()].sort((left, right) => left - right)) {
    const bucket = subtractBucket(issued.surcharge.get(rate), issued.rectification.surcharge.get(rate), rate);
    if (bucket.base === 0 && bucket.tax === 0) continue;
    const mapping = rateBoxes.surcharge[String(rate)];
    if (!mapping) {
      boxes.push({ box: "REV", label: `Revisar: recargo de equivalencia al ${rate}% sin casilla`, amount: money(bucket.tax), kind: "tax" });
      continue;
    }
    boxes.push({ box: mapping.base, label: `Base recargo de equivalencia ${rate}%`, amount: money(bucket.base), kind: "base" });
    boxes.push({ box: mapping.tax, label: `Cuota recargo de equivalencia ${rate}%`, amount: money(bucket.tax), kind: "tax" });
  }
  const surchargeModification = sumMap(issued.rectification.surcharge);
  if (surchargeModification.base !== 0 || surchargeModification.tax !== 0) {
    boxes.push({ box: "25", label: "Modificación de bases del recargo de equivalencia (rectificativas)", amount: money(surchargeModification.base), kind: "base" });
    boxes.push({ box: "26", label: "Modificación de cuotas del recargo de equivalencia (rectificativas)", amount: money(surchargeModification.tax), kind: "tax" });
  }

  const totals = computeModelo303Totals(issued, supplier, options.adjustments);
  boxes.push({ box: "27", label: "Total cuota devengada", amount: money(totals.accruedCents), kind: "tax" });

  const deductibleBoxes: Array<[string, string, string, BaseTax]> = [
    ["28", "29", "operaciones interiores corrientes", supplier.deductible.domesticCurrent],
    ["30", "31", "operaciones interiores con bienes de inversión", supplier.deductible.domesticInvestment],
    ["32", "33", "importaciones de bienes corrientes", supplier.deductible.importCurrent],
    ["34", "35", "importaciones de bienes de inversión", supplier.deductible.importInvestment],
    ["36", "37", "adquisiciones intracomunitarias corrientes", supplier.deductible.intraEuCurrent],
    ["38", "39", "adquisiciones intracomunitarias de bienes de inversión", supplier.deductible.intraEuInvestment],
  ];
  for (const [baseBox, taxBox, label, values] of deductibleBoxes) {
    const always = baseBox === "28";
    if (!always && values.fullBase === 0 && values.tax === 0) continue;
    boxes.push({ box: baseBox, label: `Base deducible · ${label} (sin prorratear)`, amount: money(values.fullBase), kind: "base" });
    boxes.push({ box: taxBox, label: `Cuota deducible · ${label}`, amount: money(values.tax), kind: "tax" });
  }
  const rectified = supplier.deductible.rectification;
  if (rectified.fullBase !== 0 || rectified.tax !== 0) {
    boxes.push({ box: "40", label: "Rectificación de deducciones · base (rectificativas y abonos recibidos, sin prorratear)", amount: money(rectified.fullBase), kind: "base" });
    boxes.push({ box: "41", label: "Rectificación de deducciones · cuota", amount: money(rectified.tax), kind: "tax" });
  }
  const investmentRegularization = options.adjustments?.investmentRegularizationCents;
  if (investmentRegularization !== undefined && investmentRegularization !== 0) {
    boxes.push({ box: "43", label: "Regularización de bienes de inversión (negativa si reduce la deducción)", amount: money(investmentRegularization), kind: "tax" });
  }
  const prorrataRegularization = options.adjustments?.prorrataRegularizationCents;
  if (prorrataRegularization !== undefined) {
    boxes.push({ box: "44", label: "Regularización por el porcentaje definitivo de prorrata (negativa si reduce la deducción)", amount: money(prorrataRegularization), kind: "tax" });
  }
  boxes.push({ box: "45", label: "Total a deducir", amount: money(totals.deductibleCents), kind: "tax" });
  boxes.push({ box: "46", label: "Resultado régimen general (27 − 45)", amount: money(totals.resultCents), kind: "settlement" });

  const compensation = options.compensation;
  if (compensation) {
    boxes.push({ box: "64", label: "Suma de resultados (46; sin régimen simplificado)", amount: money(totals.resultCents), kind: "settlement" });
    boxes.push({ box: "66", label: "Atribuible a la Administración del Estado (100 %)", amount: money(totals.resultCents), kind: "settlement" });
    boxes.push({ box: "110", label: "Cuotas a compensar pendientes de periodos anteriores", amount: money(compensation.pendingBeforeCents), kind: "settlement" });
    boxes.push({ box: "78", label: "Cuotas a compensar de periodos anteriores aplicadas en este periodo", amount: money(compensation.appliedCents), kind: "settlement" });
    boxes.push({ box: "87", label: "Cuotas a compensar de periodos previos pendientes para periodos posteriores (110 − 78)", amount: money(compensation.pendingAfterCents), kind: "settlement" });
    boxes.push({ box: "69", label: "Resultado (66 − 78)", amount: money(compensation.resultCents), kind: "settlement" });
    boxes.push({
      box: "71",
      label: compensation.resultCents > 0 ? "Resultado de la liquidación: a ingresar" : compensation.resultCents < 0 ? "Resultado de la liquidación: a compensar o devolver" : "Resultado de la liquidación: cero",
      amount: money(compensation.resultCents),
      kind: "settlement",
    });
  } else {
    boxes.push({ box: "71", label: "Resultado de la liquidación (sin compensaciones de periodos anteriores)", amount: money(totals.resultCents), kind: "settlement" });
  }

  const informative: Array<[string, string, number]> = [
    // Casilla 59: entregas intracomunitarias de bienes y prestaciones de servicios a empresas de la UE
    // no sujetas por reglas de localización (las que se declaran en el 349 con clave E o S).
    ["59", "Entregas intracomunitarias de bienes y prestaciones de servicios", issued.zeroRated.INTRA_EU + issued.zeroRated.INTRA_EU_SERVICES],
    ["60", "Exportaciones y operaciones asimiladas", issued.zeroRated.EXPORT],
    ["120", "Operaciones no sujetas por reglas de localización", issued.zeroRated.NOT_SUBJECT],
    ["122", "Operaciones sujetas con inversión del sujeto pasivo (emitidas)", issued.zeroRated.REVERSE_CHARGE],
  ];
  for (const [box, label, cents] of informative) {
    if (cents !== 0) boxes.push({ box, label, amount: money(cents), kind: "info" });
  }
  const exempt = issued.zeroRated.EXEMPT + (options.periodYear <= 2024 ? 0 : zeroDomestic);
  if (exempt !== 0) {
    boxes.push({ box: "EXE", label: "Operaciones exentas o sin IVA (no van en el 303; se declaran en el 390)", amount: money(exempt), kind: "info" });
  }
  const cashInfo = options.cashInfo;
  if (cashInfo) {
    const cashRows: Array<[string, string, number]> = [
      ["62", "Criterio de caja · base de tus entregas y servicios del periodo según la regla general de devengo", cashInfo.salesBaseCents],
      ["63", "Criterio de caja · cuota de tus entregas y servicios del periodo según la regla general de devengo", cashInfo.salesTaxCents],
      ["74", "Criterio de caja · base de las adquisiciones afectadas, según la regla general de devengo", cashInfo.purchaseBaseCents],
      ["75", "Criterio de caja · cuota soportada de las adquisiciones afectadas, según la regla general de devengo", cashInfo.purchaseTaxCents],
    ];
    for (const [box, label, cents] of cashRows) {
      if (cents !== 0) boxes.push({ box, label, amount: money(cents), kind: "info" });
    }
  }
  if (options.yearIssued) boxes.push(...buildModelo303VolumeBoxes(options.yearIssued, { cashYearIssued: options.cashYearIssued }));

  return boxes;
}

export type VatPeriodResult = { period: string; resultCents: number };

type RateBoxes = Record<string, [string, string]>;

/**
 * Casillas del modelo 390 (apartado 5, IVA devengado), contrastadas con las instrucciones del
 * ejercicio 2025 y el diseño de registro de la sede de la AEAT (dr390e2025 y dr390e2026: la
 * numeración no cambia). Pares [base, cuota] por tipo. Los tipos del 2 %, 5 % y 7,5 % ya no están
 * vigentes: el diseño obliga a dejarlos a cero, así que un importe a esos tipos se marca para revisar.
 */
const MODELO_390_OUTPUT = {
  ordinary: { "4": ["01", "02"], "10": ["03", "04"], "21": ["05", "06"] } as RateBoxes,
  cash: { "4": ["643", "644"], "10": ["645", "646"], "21": ["647", "648"] } as RateBoxes,
  intraEuGoods: { "4": ["21", "22"], "10": ["23", "24"], "21": ["25", "26"] } as RateBoxes,
  intraEuServices: { "4": ["545", "546"], "10": ["547", "548"], "21": ["551", "552"] } as RateBoxes,
  surcharge: { "0.5": ["35", "36"], "1.4": ["599", "600"], "5.2": ["601", "602"], "1.75": ["41", "42"] } as RateBoxes,
};

/** Apartado 5, IVA deducible: desglose por tipo y casillas de total [base, cuota] de cada concepto. */
const MODELO_390_DEDUCTIBLE: Array<{ category: DeductibleCategory; label: string; rates: RateBoxes; total: [string, string] }> = [
  { category: "domesticCurrent", label: "operaciones interiores corrientes", rates: { "2": ["695", "696"], "4": ["190", "191"], "5": ["724", "725"], "7.5": ["697", "698"], "10": ["603", "604"], "21": ["605", "606"] }, total: ["48", "49"] },
  { category: "domesticInvestment", label: "operaciones interiores de bienes de inversión", rates: { "4": ["196", "197"], "10": ["611", "612"], "21": ["613", "614"] }, total: ["50", "51"] },
  { category: "importCurrent", label: "importaciones de bienes corrientes", rates: { "2": ["757", "758"], "4": ["202", "203"], "5": ["732", "733"], "7.5": ["759", "760"], "10": ["619", "620"], "21": ["621", "622"] }, total: ["52", "53"] },
  { category: "importInvestment", label: "importaciones de bienes de inversión", rates: { "4": ["208", "209"], "10": ["623", "624"], "21": ["625", "626"] }, total: ["54", "55"] },
  { category: "intraEuGoodsCurrent", label: "adquisiciones intracomunitarias de bienes corrientes", rates: { "2": ["765", "766"], "4": ["214", "215"], "5": ["736", "737"], "7.5": ["767", "768"], "10": ["627", "628"], "21": ["629", "630"] }, total: ["56", "57"] },
  { category: "intraEuGoodsInvestment", label: "adquisiciones intracomunitarias de bienes de inversión", rates: { "4": ["220", "221"], "10": ["631", "632"], "21": ["633", "634"] }, total: ["58", "59"] },
  { category: "intraEuServices", label: "adquisiciones intracomunitarias de servicios", rates: { "4": ["587", "588"], "10": ["635", "636"], "21": ["637", "638"] }, total: ["597", "598"] },
];

export type Modelo390Options = {
  periodResults?: VatPeriodResult[];
  openingCents?: number;
  /** Regularizaciones del ejercicio (casillas 63 y 522). */
  adjustments?: Modelo303Adjustments;
  /** Emitidas del ejercicio por la regla general de devengo, para el volumen de operaciones (por defecto, `issued`). */
  volumeIssued?: IssuedVatResult;
  /** Emitidas del ejercicio en criterio de caja, por la regla general (casilla 653). */
  cashYearIssued?: IssuedVatResult;
  /** Apartado 11: operaciones en criterio de caja según la regla general (654-657). */
  cashInfo?: Modelo303CashInfo;
  /** Apartado 12: prorrata general del ejercicio (casillas 115, 116 y 118). */
  prorrata?: { totalCents: number; deductibleCents: number; pct: number };
};

/**
 * Resumen anual del IVA con la numeración oficial del modelo 390 (ejercicio 2025 y siguientes).
 * Solo se numeran las casillas que el programa calcula. No se calculan: operaciones intragrupo,
 * regímenes especiales (bienes usados, agencias de viajes, simplificado, agricultura), modificación
 * por concurso o créditos incobrables (31-32, 45-46), tributación por territorios (87-94),
 * devoluciones mensuales (96, 524) ni el desglose por actividades y sectores diferenciados.
 *
 * - `issued` es lo devengado en el ejercicio (en criterio de caja, lo cobrado): las cuotas del
 *   régimen del criterio de caja van en sus casillas (643-648), no en 01-06.
 * - Un importe a un tipo sin casilla vigente sale como fila «REV» para revisarlo a mano.
 * - 85: cuotas a compensar que vienen del ejercicio anterior; 86 = 84 − 85 (sin IVA a la
 *   importación liquidado por la Aduana, 659). 95: suma de los resultados a ingresar de los 303.
 *   97: saldo a compensar al cerrar el último periodo (si se pide la devolución, va en la 98).
 */
export function buildModelo390Summary(issued: IssuedVatResult, supplier: SupplierVatResult, options: Modelo390Options = {}): Modelo303Box[] {
  const rows: Modelo303Box[] = [];
  const money = (cents: number) => centsToNumber(cents);
  const push = (box: string, label: string, cents: number, kind: Modelo303Box["kind"]) => rows.push({ box, label, amount: money(cents), kind });
  const pushRates = (map: Map<number, CentsBucket>, boxes: RateBoxes, label: string, kinds: { always?: number[] } = {}) => {
    const rates = new Set<number>([...(kinds.always ?? []), ...map.keys()]);
    for (const rate of [...rates].sort((left, right) => left - right)) {
      const bucket = map.get(rate) ?? { rate, base: 0, tax: 0 };
      const mapping = boxes[String(rate)];
      if (bucket.base === 0 && bucket.tax === 0 && !(mapping && kinds.always?.includes(rate))) continue;
      if (!mapping) {
        push("REV", `Revisar: ${label} al ${rate}% no tiene casilla vigente en el 390 (base ${money(bucket.base).toFixed(2)} €)`, bucket.tax, "tax");
        continue;
      }
      push(mapping[0], `${label} · base al ${rate}%`, bucket.base, "base");
      push(mapping[1], `${label} · cuota al ${rate}%`, bucket.tax, "tax");
    }
  };
  const net = (map: Map<number, CentsBucket>, ...minus: Array<Map<number, CentsBucket>>) => {
    const result = new Map<number, CentsBucket>();
    for (const rate of new Set([...map.keys(), ...minus.flatMap((entry) => [...entry.keys()])])) {
      let bucket = subtractBucket(map.get(rate), undefined, rate);
      for (const entry of minus) bucket = subtractBucket(bucket, entry.get(rate), rate);
      if (bucket.base !== 0 || bucket.tax !== 0) result.set(rate, bucket);
    }
    return result;
  };

  // Rectificativas en criterio de caja: `cashVat` ya las excluye; el resto del régimen ordinario
  // es lo devengado menos las rectificativas (29-30) y menos lo del criterio de caja.
  const hasCash = issued.cashVat.size > 0;
  pushRates(net(issued.vat, issued.rectification.vat, issued.cashVat), MODELO_390_OUTPUT.ordinary, "Devengado · régimen ordinario", { always: hasCash ? [] : [4, 10, 21] });
  if (hasCash) pushRates(issued.cashVat, MODELO_390_OUTPUT.cash, "Devengado · régimen especial del criterio de caja");
  pushRates(supplier.selfAssessedByRate.intraEuGoods, MODELO_390_OUTPUT.intraEuGoods, "Devengado · adquisiciones intracomunitarias de bienes");
  pushRates(supplier.selfAssessedByRate.intraEuServices, MODELO_390_OUTPUT.intraEuServices, "Devengado · adquisiciones intracomunitarias de servicios");
  if (supplier.selfAssessed.reverseCharge.base !== 0 || supplier.selfAssessed.reverseCharge.tax !== 0) {
    push("27", "Devengado · base de otros supuestos de inversión del sujeto pasivo", supplier.selfAssessed.reverseCharge.base, "base");
    push("28", "Devengado · cuota de otros supuestos de inversión del sujeto pasivo", supplier.selfAssessed.reverseCharge.tax, "tax");
  }
  const vatModification = sumMap(issued.rectification.vat);
  if (vatModification.base !== 0 || vatModification.tax !== 0) {
    push("29", "Devengado · modificación de bases (facturas rectificativas emitidas)", vatModification.base, "base");
    push("30", "Devengado · modificación de cuotas (facturas rectificativas emitidas)", vatModification.tax, "tax");
  }
  const outputVat = sumMap(issued.vat);
  push("33", "Total bases IVA", outputVat.base + supplier.selfAssessed.intraEu.base + supplier.selfAssessed.reverseCharge.base, "base");
  push("34", "Total cuotas IVA", outputVat.tax + supplier.selfAssessed.intraEu.tax + supplier.selfAssessed.reverseCharge.tax, "tax");
  pushRates(net(issued.surcharge, issued.rectification.surcharge), MODELO_390_OUTPUT.surcharge, "Devengado · recargo de equivalencia");
  const surchargeModification = sumMap(issued.rectification.surcharge);
  if (surchargeModification.base !== 0 || surchargeModification.tax !== 0) {
    push("43", "Devengado · modificación de bases del recargo de equivalencia", surchargeModification.base, "base");
    push("44", "Devengado · modificación de cuotas del recargo de equivalencia", surchargeModification.tax, "tax");
  }
  const totals = computeModelo303Totals(issued, supplier, options.adjustments);
  push("47", "Total cuotas IVA y recargo de equivalencia", totals.accruedCents, "tax");

  for (const concept of MODELO_390_DEDUCTIBLE) {
    const map = supplier.deductibleByRate[concept.category];
    const total = sumMap(map);
    if (total.base === 0 && total.tax === 0) continue;
    pushRates(map, concept.rates, `Deducible · ${concept.label} (base sin prorratear)`);
    push(concept.total[0], `Deducible · total bases de ${concept.label}`, total.base, "base");
    push(concept.total[1], `Deducible · total cuotas de ${concept.label}`, total.tax, "tax");
  }
  const rectified = supplier.deductible.rectification;
  if (rectified.fullBase !== 0 || rectified.tax !== 0) {
    push("639", "Deducible · rectificación de deducciones, base (rectificativas y abonos recibidos)", rectified.fullBase, "base");
    push("62", "Deducible · rectificación de deducciones, cuota", rectified.tax, "tax");
  }
  const investmentRegularization = options.adjustments?.investmentRegularizationCents;
  if (investmentRegularization !== undefined && investmentRegularization !== 0) push("63", "Regularización de bienes de inversión", investmentRegularization, "tax");
  const prorrataRegularization = options.adjustments?.prorrataRegularizationCents;
  if (prorrataRegularization !== undefined) push("522", "Regularización por el porcentaje definitivo de prorrata", prorrataRegularization, "tax");
  push("64", "Suma de deducciones", totals.deductibleCents, "tax");
  push("65", "Resultado régimen general (47 − 64)", totals.resultCents, "settlement");

  if (options.periodResults && options.periodResults.length > 0) {
    const openingCents = options.openingCents ?? 0;
    let toPay = 0;
    const previous: number[] = [];
    let last: Modelo303Compensation | null = null;
    for (const period of options.periodResults) {
      last = computeModelo303Compensation({ openingCents, previousResultsCents: previous, resultCents: period.resultCents });
      if (last.resultCents > 0) toPay += last.resultCents;
      previous.push(period.resultCents);
    }
    push("84", "Suma de resultados (65; sin régimen simplificado)", totals.resultCents, "settlement");
    push("85", "Compensación de cuotas del ejercicio anterior", openingCents, "settlement");
    push("86", "Resultado de la liquidación (84 − 85)", totals.resultCents - openingCents, "settlement");
    push("95", "Total de resultados a ingresar en las autoliquidaciones (303) del ejercicio", toPay, "settlement");
    push("97", "A compensar al cerrar el último periodo (si pediste la devolución, es la casilla 98)", last?.carryForwardCents ?? 0, "settlement");
  }

  rows.push(...buildModelo303VolumeBoxes(options.volumeIssued ?? issued, { model: "390", cashYearIssued: options.cashYearIssued }));

  const cashInfo = options.cashInfo;
  if (cashInfo) {
    const cashRows: Array<[string, string, number]> = [
      ["654", "Criterio de caja · base de tus entregas y servicios según la regla general de devengo", cashInfo.salesBaseCents],
      ["655", "Criterio de caja · cuota de tus entregas y servicios según la regla general de devengo", cashInfo.salesTaxCents],
      ["656", "Criterio de caja · base de las adquisiciones afectadas, según la regla general de devengo", cashInfo.purchaseBaseCents],
      ["657", "Criterio de caja · cuota soportada de las adquisiciones afectadas, según la regla general de devengo", cashInfo.purchaseTaxCents],
    ];
    for (const [box, label, cents] of cashRows) {
      if (cents !== 0) push(box, label, cents, "info");
    }
  }
  if (options.prorrata) {
    push("115", "Prorrata · importe total de las operaciones", options.prorrata.totalCents, "info");
    push("116", "Prorrata · importe de las operaciones con derecho a deducción", options.prorrata.deductibleCents, "info");
    rows.push({ box: "118", label: "Prorrata · porcentaje definitivo (%)", amount: options.prorrata.pct, kind: "info" });
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Modelo 349: declaración recapitulativa de operaciones intracomunitarias.
// ---------------------------------------------------------------------------------------------

/**
 * Claves del 349 que el programa asigna: E entregas de bienes, A adquisiciones de bienes, S
 * servicios prestados, I servicios adquiridos. El diseño de registro (Orden HAC/174/2020) tiene
 * además T (entregas subsiguientes en operaciones triangulares), M y H (entregas posteriores a una
 * importación exenta, la H por el representante fiscal) y R, D y C (transferencias, devoluciones y
 * sustituciones en ventas de bienes en consigna). El programa no tiene ningún dato que distinga
 * esas operaciones (no hay marca de triangular, de importación previa ni de consigna), así que no
 * las asigna: quien las realice debe cambiar la clave a mano al presentar.
 */
export type Modelo349Key = "E" | "A" | "S" | "I";

export const modelo349KeyLabels: Record<Modelo349Key, string> = {
  E: "E · Entregas intracomunitarias de bienes",
  A: "A · Adquisiciones intracomunitarias de bienes",
  S: "S · Prestaciones intracomunitarias de servicios",
  I: "I · Adquisiciones intracomunitarias de servicios",
};

export type Modelo349Entry = {
  key: Modelo349Key;
  operatorName: string;
  operatorTaxId: string | null;
  countryCode: string | null;
  baseCents: number;
  /** Rectificación de una operación de otro periodo (se declara aparte con el periodo original). */
  rectifiesPeriod?: string | null;
};

export type Modelo349Operator = {
  key: Modelo349Key;
  taxId: string;
  name: string;
  countryCode: string;
  amount: number;
};

export type Modelo349Rectification = Modelo349Operator & {
  originalPeriod: string;
  /**
   * Como lo pide el modelo: «base imponible declarada anteriormente» (lo consignado en el periodo
   * que se corrige) y «base imponible rectificada» (el importe total correcto, no la diferencia).
   * `amount` es la diferencia. Sin dato del periodo original quedan sin informar.
   */
  previousAmount?: number;
  rectifiedAmount?: number;
};

/** Art. 81.2 RIVA: por encima de este importe de entregas y servicios, el 349 es mensual. */
export const MODELO_349_MONTHLY_THRESHOLD = 50_000;

/**
 * Periodicidad del 349 (art. 81.2 RIVA): es trimestral solo si ni en el trimestre de referencia ni
 * en ninguno de los cuatro trimestres naturales anteriores las entregas de bienes y prestaciones de
 * servicios intracomunitarias (claves E, M, H, T y S; no las adquisiciones) superan 50.000 €.
 * `quarterTotalsCents`: importes de esos trimestres (el de referencia y hasta cuatro anteriores).
 */
export function modelo349RequiresMonthly(quarterTotalsCents: number[]) {
  return quarterTotalsCents.some((cents) => cents > MODELO_349_MONTHLY_THRESHOLD * 100);
}

export type Modelo349Result = {
  operators: Modelo349Operator[];
  rectifications: Modelo349Rectification[];
  operatorCount: number;
  totalAmount: number;
  rectificationAmount: number;
  issues: Array<{ code: string; message: string }>;
  /** Entregas y servicios (claves E y S) del periodo: el importe que cuenta para el umbral de 50.000 €. */
  deliveriesAmount?: number;
  /** true si por el umbral del art. 81.2 RIVA corresponde presentar el 349 cada mes. */
  monthlyRequired?: boolean;
};

/** Clave de una venta (E/S) o compra (A/I) intracomunitaria. */
export function modelo349Key(side: "sale" | "purchase", isService: boolean): Modelo349Key {
  if (side === "sale") return isService ? "S" : "E";
  return isService ? "I" : "A";
}

/** En compras se distingue por la cuenta de gasto: servicios exteriores (62x) → I; resto (60x, 2xx…) → A. */
export function isServiceExpenseAccount(accountCode: string | null | undefined) {
  return (accountCode ?? "").startsWith("62");
}

/** NIF-IVA con prefijo de país (Grecia usa EL en VIES). */
export function normalizeVatOperatorId(taxId: string | null | undefined, countryCode: string | null | undefined) {
  const raw = (taxId ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!raw) return "";
  const country = ((countryCode ?? "").toUpperCase() === "GR" ? "EL" : (countryCode ?? "").toUpperCase()).trim();
  if (/^[A-Z]{2}/.test(raw) && (raw.startsWith(country) || !country)) return raw;
  return `${country}${raw}`;
}

export function isPlausibleVatOperatorId(value: string) {
  return /^[A-Z]{2}[0-9A-Z]{2,13}$/.test(value) && !value.startsWith("ES");
}

export function computeModelo349(entries: Modelo349Entry[]): Modelo349Result {
  const operators = new Map<string, Modelo349Operator & { cents: number }>();
  const rectifications = new Map<string, Modelo349Rectification & { cents: number }>();
  const issues: Modelo349Result["issues"] = [];
  const invalidIds = new Set<string>();

  for (const entry of entries) {
    const taxId = normalizeVatOperatorId(entry.operatorTaxId, entry.countryCode);
    const countryCode = (entry.countryCode ?? taxId.slice(0, 2)).toUpperCase();
    if (!taxId || !isPlausibleVatOperatorId(taxId)) invalidIds.add(`${entry.operatorName} (${taxId || "sin NIF-IVA"})`);
    const idKey = taxId || `SIN-NIF:${entry.operatorName}`;
    if (entry.rectifiesPeriod) {
      const key = `${entry.key}|${idKey}|${entry.rectifiesPeriod}`;
      const current = rectifications.get(key) ?? { key: entry.key, taxId: taxId || "Sin NIF-IVA", name: entry.operatorName, countryCode, amount: 0, cents: 0, originalPeriod: entry.rectifiesPeriod };
      current.cents += entry.baseCents;
      rectifications.set(key, current);
      continue;
    }
    const key = `${entry.key}|${idKey}`;
    const current = operators.get(key) ?? { key: entry.key, taxId: taxId || "Sin NIF-IVA", name: entry.operatorName, countryCode, amount: 0, cents: 0 };
    current.cents += entry.baseCents;
    operators.set(key, current);
  }

  if (invalidIds.size > 0) {
    issues.push({
      code: "model-349-vat-id",
      message: `${invalidIds.size} operador(es) sin NIF-IVA válido de otro país de la UE: ${[...invalidIds].slice(0, 5).join(", ")}. Compruébalo en el censo VIES antes de presentar.`,
    });
  }
  const finalize = <T extends { cents: number; amount: number; key: Modelo349Key }>(map: Map<string, T>) => [...map.values()]
    .filter((row) => row.cents !== 0)
    .map(({ cents, ...row }) => ({ ...row, amount: centsToNumber(cents) }))
    .sort((left, right) => String(left.key).localeCompare(String(right.key)) || right.amount - left.amount);
  const operatorRows = finalize(operators) as Modelo349Operator[];
  const rectificationRows = finalize(rectifications) as Modelo349Rectification[];
  if (operatorRows.some((row) => row.amount < 0)) {
    issues.push({ code: "model-349-negative", message: "Algún operador tiene importe negativo en el periodo: las rectificativas superan las operaciones. Revisa si corresponden a periodos anteriores." });
  }
  return {
    operators: operatorRows,
    rectifications: rectificationRows,
    operatorCount: operatorRows.length,
    totalAmount: centsToNumber(operatorRows.reduce((total, row) => total + toCents(row.amount), 0)),
    rectificationAmount: centsToNumber(rectificationRows.reduce((total, row) => total + toCents(row.amount), 0)),
    issues,
  };
}

// ---------------------------------------------------------------------------------------------
// Modelo 130: pago fraccionado del IRPF (estimación directa), cálculo acumulado desde el 1 de enero.
// ---------------------------------------------------------------------------------------------

export type Modelo130QuarterInput = {
  /** Ingresos computables del trimestre (bases de facturas emitidas, sin IVA). */
  incomeCents: number;
  /** Gastos fiscalmente deducibles del trimestre. */
  expenseCents: number;
  /** Retenciones e ingresos a cuenta soportados en el trimestre (facturas emitidas con retención). */
  withholdingCents: number;
  /** Parte de los ingresos que procede de facturas con retención (regla del 70 %). */
  withheldIncomeCents?: number;
};

export type Modelo130Box = { box: string; label: string; amount: number; kind: "base" | "tax" | "settlement" | "info" };

export type Modelo130Result = {
  quarter: number;
  boxes: Modelo130Box[];
  resultCents: number;
  /** Porcentaje de ingresos con retención (si ≥ 70 % en el año anterior no hay obligación de presentar). */
  withheldIncomePct: number;
};

export const MODELO_130_RATE = 20;

/**
 * Casillas 01–19 del 130 (actividades económicas en estimación directa, sin actividades agrícolas).
 * - 01–03: ingresos, gastos y rendimiento neto acumulados desde el 1 de enero.
 * - 04: 20 % del rendimiento neto si es positivo.
 * - 05: pagos fraccionados de trimestres anteriores (importes positivos de la casilla 07).
 * - 06: retenciones e ingresos a cuenta acumulados.
 * - 12: 07 (+ 11, actividades agrícolas, que aquí no hay); nunca negativa.
 * - 15: casillas 19 negativas de trimestres anteriores. Solo nacen de la minoración de la 13, que
 *   aquí es 0, así que hoy queda a 0; el arrastre está preparado para cuando se informe la 13.
 * - 13 y 16 (deducción art. 110.3.c RIRPF y préstamo vivienda) quedan a 0: dependen de datos personales.
 */
export function computeModelo130(quarters: Modelo130QuarterInput[], quarter: number): Modelo130Result {
  const upTo = Math.min(Math.max(quarter, 1), 4);
  let income = 0;
  let expenses = 0;
  let withholding = 0;
  let withheldIncome = 0;
  let previousPayments = 0;
  let pendingNegative = 0;
  let boxes: Modelo130Box[] = [];
  let resultCents = 0;

  for (let index = 0; index < upTo; index += 1) {
    const current = quarters[index] ?? { incomeCents: 0, expenseCents: 0, withholdingCents: 0 };
    income += current.incomeCents;
    expenses += current.expenseCents;
    withholding += current.withholdingCents;
    withheldIncome += current.withheldIncomeCents ?? 0;
    const net = income - expenses;
    const c04 = net > 0 ? Math.round((net * MODELO_130_RATE) / 100) : 0;
    const c05 = previousPayments;
    const c07 = c04 - c05 - withholding;
    // Instrucciones del 130: la casilla 12 (07 + 11) se consigna a cero si resulta negativa. Un 07
    // negativo no se arrastra con la 15: como 01–06 son acumulados, ya minora el trimestre siguiente.
    const c12 = Math.max(0, c07);
    const c13 = 0;
    const c14 = c12 - c13;
    const c15 = Math.min(pendingNegative, Math.max(0, c14));
    const c16 = 0;
    const c17 = c14 - c15 - c16;
    const c19 = c17;

    if (index === upTo - 1) {
      const money = centsToNumber;
      boxes = [
        { box: "01", label: "Ingresos computables (acumulado desde el 1 de enero)", amount: money(income), kind: "base" },
        { box: "02", label: "Gastos fiscalmente deducibles (acumulado)", amount: money(expenses), kind: "base" },
        { box: "03", label: "Rendimiento neto (01 − 02)", amount: money(net), kind: "base" },
        { box: "04", label: `${MODELO_130_RATE} % del rendimiento neto positivo`, amount: money(c04), kind: "tax" },
        { box: "05", label: "Pagos fraccionados de trimestres anteriores", amount: money(c05), kind: "tax" },
        { box: "06", label: "Retenciones e ingresos a cuenta soportados (acumulado)", amount: money(withholding), kind: "tax" },
        { box: "07", label: "Pago fraccionado previo (04 − 05 − 06)", amount: money(c07), kind: "tax" },
        { box: "12", label: "Suma de pagos fraccionados previos del trimestre", amount: money(c12), kind: "tax" },
        { box: "13", label: "Minoración art. 110.3.c) RIRPF (revísala si tu rendimiento del año anterior fue ≤ 12.000 €)", amount: money(c13), kind: "info" },
        { box: "14", label: "Diferencia (12 − 13)", amount: money(c14), kind: "tax" },
        { box: "15", label: "Resultados negativos de trimestres anteriores", amount: money(c15), kind: "tax" },
        { box: "16", label: "Deducción por préstamo de vivienda habitual (si aplica)", amount: money(c16), kind: "info" },
        { box: "17", label: "Total (14 − 15 − 16)", amount: money(c17), kind: "tax" },
        { box: "19", label: c19 > 0 ? "Resultado: a ingresar" : c19 < 0 ? "Resultado: negativo (a deducir en los trimestres siguientes del año)" : "Resultado: cero", amount: money(c19), kind: "settlement" },
      ];
      resultCents = c19;
    }

    if (c07 > 0) previousPayments += c07;
    pendingNegative -= c15;
    if (c19 < 0) pendingNegative += -c19;
  }

  const withheldIncomePct = income > 0 ? Math.round((withheldIncome / income) * 10_000) / 100 : 0;
  return { quarter: upTo, boxes, resultCents, withheldIncomePct: Math.min(100, Math.max(0, withheldIncomePct)) };
}

/** Gastos deducibles en IRPF de facturas recibidas: base (sin bienes de inversión, cuentas 2xx) + IVA no deducible. */
export function computeIncomeTaxExpenseCents(lines: SupplierLineInput[], prorrataPct: number) {
  let total = 0;
  for (const line of lines) {
    const investment = Boolean(line.isInvestmentGood) || (line.expenseAccountCode ?? "").startsWith("2");
    if (investment) continue;
    const sign = line.sign ?? 1;
    const base = sign * toCents(line.subtotal);
    const selfAssessed = isSelfAssessedTreatment(line.treatment);
    const vat = sign * (selfAssessed ? toCents(reverseChargeTaxAmount(num(line.subtotal), num(line.taxAmount))) : toCents(line.taxAmount));
    const deductiblePct = Math.min(Math.max(num(line.taxDeductiblePct ?? 100), 0), 100);
    const lineProrrataPct = line.prorrataPct === null || line.prorrataPct === undefined ? prorrataPct : Math.min(Math.max(num(line.prorrataPct), 0), 100);
    const deductible = applyPct(vat, (deductiblePct * lineProrrataPct) / 100);
    total += base + (vat - deductible);
  }
  return total;
}
