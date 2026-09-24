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
  outputVatBoxesByRate,
  reverseChargeTaxAmount,
  surchargeBoxesByRate,
  type SalesVatTreatment,
  type SupplierVatTreatment,
  type VatBucket,
} from "@/lib/fiscal-spain";
import { applyPct, centsToNumber, toCents } from "@/server/accounting/money";

export type Modelo303Box = {
  box: string;
  label: string;
  amount: number;
  kind: "base" | "tax" | "settlement" | "info";
};

export type FiscalSourceDocument = {
  id: string;
  number: string;
  issueDate: string;
  totalAmount: number;
  taxBase: number;
  taxAmount: number;
  withholdingAmount?: number;
  status?: string;
  vatTreatment?: string;
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
  totalAmount: string | number;
  status?: string | null;
  treatment: SalesVatTreatment;
  quantity: string | number;
  unitPrice: string | number;
  discountPct?: string | number | null;
  taxRate?: string | number | null;
  retentionRate?: string | number | null;
  taxes?: TaxInput[] | null;
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
};

type CentsBucket = { rate: number; base: number; tax: number };
type BaseTax = { base: number; tax: number };

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

function addBaseTax(target: BaseTax, base: number, tax: number) {
  target.base += base;
  target.tax += tax;
}

function emptyBaseTax(): BaseTax {
  return { base: 0, tax: 0 };
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
  const zeroRated: Record<SalesVatTreatment, number> = { DOMESTIC: 0, EXEMPT: 0, INTRA_EU: 0, EXPORT: 0, REVERSE_CHARGE: 0, NOT_SUBJECT: 0 };
  let otherTaxCents = 0;
  const documents = new Map<string, { doc: FiscalSourceDocument; base: number; tax: number; withholding: number }>();
  const drafts = new Set<string>();

  for (const line of lines) {
    const fallbackBase = lineBaseCents(line);
    let lineBase = fallbackBase;
    let lineTax = 0;
    let lineWithholding = 0;
    let hasVat = false;

    if (line.taxes && line.taxes.length > 0) {
      for (const tax of line.taxes) {
        const base = tax.baseAmount !== undefined && tax.baseAmount !== null ? toCents(tax.baseAmount) : fallbackBase;
        const amount = tax.amount !== undefined && tax.amount !== null ? toCents(tax.amount) : toCents((centsToNumber(base) * num(tax.rate)) / 100);
        lineBase = base;
        const rate = rateKey(tax.rate);
        if (tax.operation === "SUBTRACT") {
          addBucket(withholdings, rate, base, amount);
          lineWithholding += amount;
        } else if (tax.kind === "SURCHARGE") {
          addBucket(surcharge, rate, base, amount);
          lineTax += amount;
        } else if (tax.kind === "VAT" || !tax.kind) {
          if (rate > 0) {
            addBucket(vat, rate, base, amount);
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
      const tax = toCents((centsToNumber(fallbackBase) * rate) / 100);
      if (rate > 0) {
        addBucket(vat, rate, fallbackBase, tax);
        hasVat = true;
        lineTax += tax;
      }
      const retentionRate = rateKey(line.retentionRate);
      if (retentionRate > 0) {
        const withholding = toCents((centsToNumber(fallbackBase) * retentionRate) / 100);
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

/** IVA soportado/deducible, autorepercusiones y retenciones practicadas de facturas recibidas. */
export function computeSupplierVat(lines: SupplierLineInput[], prorrataPct: number) {
  const input = new Map<number, CentsBucket>();
  const deductible = {
    domesticCurrent: emptyBaseTax(),
    domesticInvestment: emptyBaseTax(),
    importCurrent: emptyBaseTax(),
    importInvestment: emptyBaseTax(),
    intraEuCurrent: emptyBaseTax(),
    intraEuInvestment: emptyBaseTax(),
  };
  const selfAssessed = { intraEu: emptyBaseTax(), reverseCharge: emptyBaseTax() };
  const professional = new Map<number, CentsBucket>();
  const rent = new Map<number, CentsBucket>();
  let totalTax = 0;
  let deductibleTotal = 0;
  let defaultRateLines = 0;
  // Autorepercusión: el total a pagar al proveedor debe ser base − retención (el IVA no se le paga).
  const selfAssessedInvoices = new Map<string, { totalCents: number; baseCents: number; withholdingCents: number }>();
  const documents = new Map<string, { doc: FiscalSourceDocument; base: number; tax: number; withholding: number }>();

  for (const line of lines) {
    const base = toCents(line.subtotal);
    const charged = toCents(line.taxAmount);
    const selfAssessedLine = isSelfAssessedTreatment(line.treatment);
    const vat = selfAssessedLine ? toCents(reverseChargeTaxAmount(num(line.subtotal), num(line.taxAmount))) : charged;
    const rate = selfAssessedLine && charged === 0 ? 21 : rateKey(line.taxRate);
    if (selfAssessedLine && charged === 0 && base !== 0) defaultRateLines += 1;
    if (selfAssessedLine) {
      const selfAssessedInvoice = selfAssessedInvoices.get(line.invoiceId) ?? { totalCents: toCents(line.totalAmount), baseCents: 0, withholdingCents: 0 };
      selfAssessedInvoice.baseCents += base;
      selfAssessedInvoice.withholdingCents += toCents(line.retentionAmount ?? 0);
      selfAssessedInvoices.set(line.invoiceId, selfAssessedInvoice);
    }

    const lineDeductiblePct = Math.min(Math.max(num(line.taxDeductiblePct ?? 100), 0), 100);
    const effectivePct = (lineDeductiblePct * prorrataPct) / 100;
    const lineDeductible = applyPct(vat, effectivePct);
    const deductibleBase = vat !== 0 ? applyPct(base, effectivePct) : 0;
    const investment = (line.expenseAccountCode ?? "").startsWith("2");

    if (vat !== 0 || base !== 0) addBucket(input, rate, base, vat);
    totalTax += vat;
    deductibleTotal += lineDeductible;

    if (line.treatment === "INTRA_EU") {
      addBaseTax(selfAssessed.intraEu, base, vat);
      addBaseTax(investment ? deductible.intraEuInvestment : deductible.intraEuCurrent, deductibleBase, lineDeductible);
    } else if (line.treatment === "REVERSE_CHARGE") {
      addBaseTax(selfAssessed.reverseCharge, base, vat);
      addBaseTax(investment ? deductible.domesticInvestment : deductible.domesticCurrent, deductibleBase, lineDeductible);
    } else if (line.treatment === "IMPORT") {
      addBaseTax(investment ? deductible.importInvestment : deductible.importCurrent, deductibleBase, lineDeductible);
    } else {
      addBaseTax(investment ? deductible.domesticInvestment : deductible.domesticCurrent, deductibleBase, lineDeductible);
    }

    const withholding = toCents(line.retentionAmount ?? 0);
    if (withholding > 0) {
      const retentionRate = rateKey(line.retentionRate) || (base !== 0 ? Math.round((withholding / base) * 10_000) / 100 : 0);
      // Arrendamientos (cuenta 621) → modelo 115; resto (profesionales) → modelo 111.
      addBucket((line.expenseAccountCode ?? "").startsWith("621") ? rent : professional, retentionRate, base, withholding);
    }

    const entry = documents.get(line.invoiceId) ?? {
      doc: {
        id: line.invoiceId,
        number: line.number,
        issueDate: line.issueDate.toISOString(),
        totalAmount: centsToNumber(toCents(line.totalAmount)),
        taxBase: 0,
        taxAmount: 0,
        withholdingAmount: 0,
        vatTreatment: line.treatment,
      },
      base: 0,
      tax: 0,
      withholding: 0,
    };
    entry.base += base;
    entry.tax += lineDeductible;
    entry.withholding += withholding;
    documents.set(line.invoiceId, entry);
  }

  return {
    input,
    deductible,
    selfAssessed,
    professional,
    rent,
    totalTaxCents: totalTax,
    deductibleCents: deductibleTotal,
    defaultRateLines,
    invoicesWithChargedSelfAssessedVat: countSelfAssessedTotalMismatches(selfAssessedInvoices),
    invoiceIds: new Set(documents.keys()),
    documents: [...documents.values()]
      .map(({ doc, base, tax, withholding }) => ({ ...doc, taxBase: centsToNumber(base), taxAmount: centsToNumber(tax), withholdingAmount: centsToNumber(withholding) }))
      .sort((left, right) => right.issueDate.localeCompare(left.issueDate)),
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

export function computeModelo303Totals(issued: IssuedVatResult, supplier: SupplierVatResult): Modelo303Totals {
  const domesticOutput = sumMap(issued.vat).tax;
  const surcharge = sumMap(issued.surcharge).tax;
  const selfAssessed = supplier.selfAssessed.intraEu.tax + supplier.selfAssessed.reverseCharge.tax;
  const accrued = domesticOutput + surcharge + selfAssessed;
  return {
    accruedCents: accrued,
    deductibleCents: supplier.deductibleCents,
    resultCents: accrued - supplier.deductibleCents,
    domesticOutputCents: domesticOutput,
    surchargeCents: surcharge,
    selfAssessedCents: selfAssessed,
  };
}

/**
 * Casillas del modelo 303 (diseño AEAT vigente). Solo casillas de importe; los tipos (02, 05…)
 * se indican en la etiqueta. Las que no aplican a este MVP (regularizaciones, compensaciones,
 * régimen simplificado) no se muestran.
 */
export function buildModelo303Boxes(issued: IssuedVatResult, supplier: SupplierVatResult, options: { periodYear: number }): Modelo303Box[] {
  const boxes: Modelo303Box[] = [];
  const money = (cents: number) => centsToNumber(cents);
  const zeroDomestic = issued.zeroRated.DOMESTIC;

  const outputRates = new Set<number>([4, 10, 21, ...issued.vat.keys()]);
  if (zeroDomestic !== 0 && options.periodYear <= 2024) outputRates.add(0);
  for (const rate of [...outputRates].sort((left, right) => left - right)) {
    const mapping = outputVatBoxesByRate[String(rate)];
    const bucket = issued.vat.get(rate) ?? { rate, base: rate === 0 ? zeroDomestic : 0, tax: 0 };
    if (!mapping) {
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

  for (const bucket of [...issued.surcharge.values()].sort((left, right) => left.rate - right.rate)) {
    const mapping = surchargeBoxesByRate[String(bucket.rate)];
    if (!mapping) {
      boxes.push({ box: "REV", label: `Revisar: recargo de equivalencia al ${bucket.rate}% sin casilla`, amount: money(bucket.tax), kind: "tax" });
      continue;
    }
    boxes.push({ box: mapping.base, label: `Base recargo de equivalencia ${bucket.rate}%`, amount: money(bucket.base), kind: "base" });
    boxes.push({ box: mapping.tax, label: `Cuota recargo de equivalencia ${bucket.rate}%`, amount: money(bucket.tax), kind: "tax" });
  }

  const totals = computeModelo303Totals(issued, supplier);
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
    if (!always && values.base === 0 && values.tax === 0) continue;
    boxes.push({ box: baseBox, label: `Base deducible · ${label}`, amount: money(values.base), kind: "base" });
    boxes.push({ box: taxBox, label: `Cuota deducible · ${label}`, amount: money(values.tax), kind: "tax" });
  }
  boxes.push({ box: "45", label: "Total a deducir", amount: money(totals.deductibleCents), kind: "tax" });
  boxes.push({ box: "46", label: "Resultado régimen general (27 − 45)", amount: money(totals.resultCents), kind: "settlement" });
  boxes.push({ box: "71", label: "Resultado de la liquidación (sin compensaciones de periodos anteriores)", amount: money(totals.resultCents), kind: "settlement" });

  const informative: Array<[string, string, number]> = [
    ["59", "Entregas intracomunitarias exentas", issued.zeroRated.INTRA_EU],
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

  return boxes;
}

// ---------------------------------------------------------------------------------------------
// Modelo 349: declaración recapitulativa de operaciones intracomunitarias.
// ---------------------------------------------------------------------------------------------

/** Claves del 349: E entregas de bienes, A adquisiciones de bienes, S servicios prestados, I servicios adquiridos. */
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

export type Modelo349Rectification = Modelo349Operator & { originalPeriod: string };

export type Modelo349Result = {
  operators: Modelo349Operator[];
  rectifications: Modelo349Rectification[];
  operatorCount: number;
  totalAmount: number;
  rectificationAmount: number;
  issues: Array<{ code: string; message: string }>;
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
 * - 15: resultados negativos de trimestres anteriores pendientes de deducir.
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
    const c12 = c07;
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
        { box: "19", label: c19 > 0 ? "Resultado: a ingresar" : c19 < 0 ? "Resultado: negativo (se descuenta en el siguiente trimestre)" : "Resultado: cero", amount: money(c19), kind: "settlement" },
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
    const investment = (line.expenseAccountCode ?? "").startsWith("2");
    if (investment) continue;
    const base = toCents(line.subtotal);
    const selfAssessed = isSelfAssessedTreatment(line.treatment);
    const vat = selfAssessed ? toCents(reverseChargeTaxAmount(num(line.subtotal), num(line.taxAmount))) : toCents(line.taxAmount);
    const deductiblePct = Math.min(Math.max(num(line.taxDeductiblePct ?? 100), 0), 100);
    const deductible = applyPct(vat, (deductiblePct * prorrataPct) / 100);
    total += base + (vat - deductible);
  }
  return total;
}
