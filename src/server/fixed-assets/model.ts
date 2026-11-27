/**
 * Reglas del inmovilizado (funciones puras): correspondencia de cuentas del PGC, validación de la
 * ficha, líneas del asiento de baja y filas del libro registro de bienes de inversión.
 */

import { applyPct, toCents } from "@/server/accounting/money";

export type AssetCategory = "intangible" | "tangible" | "investment";

export type AssetStatus = "active" | "fully_depreciated" | "disposed";

export type DepreciationMethod = "percent" | "years";

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  active: "En uso",
  fully_depreciated: "Totalmente amortizado",
  disposed: "Baja",
};

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  intangible: "Inmovilizado intangible",
  tangible: "Inmovilizado material",
  investment: "Inversiones inmobiliarias",
};

/** Origen (`journal_entry.sourceType`) de los asientos del módulo. */
export const FIXED_ASSET_SOURCE = {
  depreciation: "fixedAssetDepreciation",
  disposal: "fixedAssetDisposal",
} as const;

/** Tipo de documento de los apuntes (`journal_line.documentType`). */
export const FIXED_ASSET_DOCUMENT_TYPE = "fixedAsset";

/** Grupo de la cuenta de inmovilizado: 20 intangible, 21 material, 22 inversiones inmobiliarias. */
export function assetCategoryForCode(code: string): AssetCategory | null {
  if (code.startsWith("20")) return "intangible";
  if (code.startsWith("21")) return "tangible";
  if (code.startsWith("22")) return "investment";
  return null;
}

const CATEGORY_ACCOUNTS: Record<AssetCategory, { expense: string; loss: string; gain: string }> = {
  intangible: { expense: "680", loss: "670", gain: "770" },
  tangible: { expense: "681", loss: "671", gain: "771" },
  investment: { expense: "682", loss: "672", gain: "772" },
};

export function categoryAccounts(category: AssetCategory) {
  return CATEGORY_ACCOUNTS[category];
}

export type AccountSuggestion = {
  category: AssetCategory;
  /** false: terrenos y anticipos, que no se amortizan. */
  depreciable: boolean;
  /** Amortización acumulada (280x, 281x o 282); null si no se amortiza. */
  accumulatedCode: string | null;
  /** Dotación (680, 681 o 682); null si no se amortiza. */
  expenseCode: string | null;
};

/**
 * Cuentas que corresponden a un inmovilizado según el PGC: 200→2800 … 206→2806, 211→2811 … 219→2819,
 * 22x→282. No se amortizan los terrenos (210 y 220) ni los anticipos (209). Devuelve null si la
 * cuenta no es de los grupos 20, 21 o 22.
 */
export function suggestAssetAccounts(assetAccountCode: string): AccountSuggestion | null {
  const code = assetAccountCode.trim();
  const category = assetCategoryForCode(code);
  if (!category || code.length < 3 || !/^\d+$/.test(code)) return null;
  const base = code.slice(0, 3);
  const none: AccountSuggestion = { category, depreciable: false, accumulatedCode: null, expenseCode: null };
  if (base === "209" || base === "210" || base === "220") return none;
  const expenseCode = CATEGORY_ACCOUNTS[category].expense;
  if (category === "intangible") {
    // El PGC no tiene 207 ni 208; se proponen igualmente 2807/2808 por si la empresa las ha creado.
    return { category, depreciable: true, accumulatedCode: `280${base[2]}`, expenseCode };
  }
  if (category === "tangible") return { category, depreciable: true, accumulatedCode: `281${base[2]}`, expenseCode };
  return { category, depreciable: true, accumulatedCode: "282", expenseCode };
}

/** Porcentaje anual efectivo: el indicado, o 100 ÷ años de vida útil. */
export function effectiveAnnualPct(input: { method: DepreciationMethod; annualPct?: number | null; usefulLifeYears?: number | null }): number | null {
  if (input.method === "years") {
    const years = Number(input.usefulLifeYears);
    return Number.isFinite(years) && years > 0 ? 100 / years : null;
  }
  const pct = Number(input.annualPct);
  return Number.isFinite(pct) && pct > 0 ? pct : null;
}

export const MIN_ANNUAL_PCT = 0.5;
export const MAX_ANNUAL_PCT = 100;

export type AssetRulesInput = {
  assetAccountCode: string;
  accumulatedAccountCode?: string | null;
  expenseAccountCode?: string | null;
  isDepreciable: boolean;
  method: DepreciationMethod;
  annualPct?: number | null;
  usefulLifeYears?: number | null;
  acquisitionDate: string;
  inServiceDate: string;
  depreciationStartDate?: string | null;
  acquisitionCostCents: number;
  residualValueCents: number;
  priorAccumulatedCents: number;
};

/** Reglas de coherencia de la ficha. Devuelve el primer mensaje de error o null. */
export function validateAssetRules(input: AssetRulesInput): string | null {
  if (!assetCategoryForCode(input.assetAccountCode)) {
    return "La cuenta del bien debe ser de inmovilizado intangible (20), material (21) o inversiones inmobiliarias (22).";
  }
  if (input.acquisitionCostCents <= 0) return "Indica el valor de adquisición del bien.";
  if (input.residualValueCents < 0 || input.residualValueCents >= input.acquisitionCostCents) {
    return "El valor residual debe ser menor que el valor de adquisición.";
  }
  if (input.inServiceDate < input.acquisitionDate) return "La puesta en funcionamiento no puede ser anterior a la fecha de adquisición.";
  if (!input.isDepreciable) {
    if (input.priorAccumulatedCents > 0) return "Un bien que no se amortiza no puede tener amortización acumulada anterior.";
    return null;
  }
  if (!input.accumulatedAccountCode?.startsWith("28")) return "La cuenta de amortización acumulada debe ser del subgrupo 28 (280, 281 o 282).";
  if (!input.expenseAccountCode?.startsWith("68")) return "La cuenta de gasto de la amortización debe ser del subgrupo 68 (680, 681 o 682).";
  const pct = effectiveAnnualPct(input);
  if (pct === null) {
    return input.method === "years" ? "Indica los años de vida útil del bien." : "Indica el porcentaje anual de amortización.";
  }
  if (pct < MIN_ANNUAL_PCT - 1e-9 || pct > MAX_ANNUAL_PCT + 1e-9) {
    return input.method === "years" ? "La vida útil debe estar entre 1 y 200 años." : "El porcentaje anual debe estar entre el 0,5 % y el 100 %.";
  }
  if (input.depreciationStartDate && input.depreciationStartDate < input.inServiceDate) {
    return "El inicio de la amortización en el programa no puede ser anterior a la puesta en funcionamiento.";
  }
  if (input.priorAccumulatedCents < 0 || input.priorAccumulatedCents > input.acquisitionCostCents - input.residualValueCents) {
    return "La amortización acumulada anterior no puede superar el valor amortizable (adquisición menos residual).";
  }
  if (input.priorAccumulatedCents > 0 && !input.depreciationStartDate) {
    return "Si el bien ya llevaba amortización acumulada, indica desde qué fecha debe amortizarlo el programa.";
  }
  return null;
}

/** Estado que corresponde al bien según lo amortizado (la baja manda sobre todo lo demás). */
export function assetStatusFor(input: { disposed: boolean; isDepreciable: boolean; depreciableCents: number; accumulatedCents: number }): AssetStatus {
  if (input.disposed) return "disposed";
  if (input.isDepreciable && input.depreciableCents > 0 && input.accumulatedCents >= input.depreciableCents) return "fully_depreciated";
  return "active";
}

export type DisposalLine = { role: "accumulated" | "proceeds" | "loss" | "asset" | "gain"; debitCents: number; creditCents: number };

/**
 * Asiento de baja o venta: se da de baja el valor de adquisición (haber) y su amortización acumulada
 * (debe); lo cobrado va al debe de la cuenta indicada y la diferencia es la pérdida (671/670/672, debe)
 * o el beneficio (771/770/772, haber).
 */
export function buildDisposalLines(input: { costCents: number; accumulatedCents: number; proceedsCents: number }): { lines: DisposalLine[]; resultCents: number } {
  const accumulated = Math.min(Math.max(0, input.accumulatedCents), input.costCents);
  const proceeds = Math.max(0, input.proceedsCents);
  const netBookValue = input.costCents - accumulated;
  const resultCents = proceeds - netBookValue;
  const lines: DisposalLine[] = [];
  if (accumulated > 0) lines.push({ role: "accumulated", debitCents: accumulated, creditCents: 0 });
  if (proceeds > 0) lines.push({ role: "proceeds", debitCents: proceeds, creditCents: 0 });
  if (resultCents < 0) lines.push({ role: "loss", debitCents: -resultCents, creditCents: 0 });
  lines.push({ role: "asset", debitCents: 0, creditCents: input.costCents });
  if (resultCents > 0) lines.push({ role: "gain", debitCents: 0, creditCents: resultCents });
  return { lines, resultCents };
}

export type RegisterAsset = {
  code: string;
  description: string;
  assetAccountCode: string;
  acquisitionDate: string;
  inServiceDate: string;
  costCents: number;
  residualCents: number;
  annualPct: number | null;
  priorAccumulatedCents: number;
  disposalDate: string | null;
  disposalProceedsCents: number | null;
  /** Dotaciones contabilizadas: fecha del asiento (fin de periodo) e importe. */
  postings: ReadonlyArray<{ periodEnd: string; amountCents: number }>;
};

export type RegisterRow = {
  code: string;
  description: string;
  assetAccountCode: string;
  acquisitionDate: string;
  inServiceDate: string;
  costCents: number;
  annualPct: number | null;
  /** Amortización contabilizada dentro del ejercicio. */
  yearDepreciationCents: number;
  /** Amortización acumulada al cierre del ejercicio (o en la fecha de baja). */
  accumulatedCents: number;
  netBookValueCents: number;
  disposalDate: string | null;
  disposalProceedsCents: number | null;
};

/**
 * Libro registro de bienes de inversión de un ejercicio: bienes adquiridos hasta su cierre y no dados
 * de baja antes de su inicio. La baja solo se muestra si ocurre dentro del ejercicio (o antes de su cierre).
 */
export function buildRegisterRows(assets: readonly RegisterAsset[], year: { start: string; end: string }): RegisterRow[] {
  return assets
    .filter((asset) => asset.acquisitionDate <= year.end && (!asset.disposalDate || asset.disposalDate >= year.start))
    .map((asset) => {
      const disposedInYear = asset.disposalDate !== null && asset.disposalDate <= year.end;
      const yearDepreciationCents = asset.postings.filter((posting) => posting.periodEnd >= year.start && posting.periodEnd <= year.end).reduce((sum, posting) => sum + posting.amountCents, 0);
      const accumulatedCents = asset.priorAccumulatedCents + asset.postings.filter((posting) => posting.periodEnd <= year.end).reduce((sum, posting) => sum + posting.amountCents, 0);
      return {
        code: asset.code,
        description: asset.description,
        assetAccountCode: asset.assetAccountCode,
        acquisitionDate: asset.acquisitionDate,
        inServiceDate: asset.inServiceDate,
        costCents: asset.costCents,
        annualPct: asset.annualPct,
        yearDepreciationCents,
        accumulatedCents,
        netBookValueCents: disposedInYear ? 0 : asset.costCents - accumulatedCents,
        disposalDate: disposedInYear ? asset.disposalDate : null,
        disposalProceedsCents: disposedInYear ? asset.disposalProceedsCents : null,
      };
    })
    .sort((left, right) => left.acquisitionDate.localeCompare(right.acquisitionDate) || left.code.localeCompare(right.code));
}

/** Siguiente código correlativo (BI-0001, BI-0002…) a partir de los existentes. */
export function nextAssetCode(existingCodes: Iterable<string>): string {
  let max = 0;
  for (const code of existingCodes) {
    const match = /^BI-(\d+)$/.exec(code);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `BI-${String(max + 1).padStart(4, "0")}`;
}

/**
 * Precio de adquisición (céntimos) de un bien a partir de su línea de factura de compra: base +
 * recargo de equivalencia + la parte del IVA que no se puede deducir. En operaciones con IVA
 * autorrepercutido (intracomunitaria, inversión del sujeto pasivo) o no sujetas, la línea no lleva
 * IVA del proveedor y el precio es la base.
 */
export function assetCostFromInvoiceLineCents(line: {
  subtotalAmount: string | number;
  taxAmount: string | number;
  taxDeductiblePct: string | number;
  surchargeAmount?: string | number | null;
  vatTreatment?: string | null;
}) {
  const base = toCents(line.subtotalAmount) + toCents(line.surchargeAmount ?? 0);
  const suppliedVat = !line.vatTreatment || line.vatTreatment === "DOMESTIC" || line.vatTreatment === "IMPORT";
  if (!suppliedVat) return base;
  const deductiblePct = Math.min(Math.max(Number(line.taxDeductiblePct), 0), 100);
  const vat = toCents(line.taxAmount);
  return base + (vat - applyPct(vat, Number.isFinite(deductiblePct) ? deductiblePct : 100));
}
