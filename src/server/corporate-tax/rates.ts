/**
 * Tipos de gravamen del Impuesto sobre Sociedades (art. 29.1 y disposición transitoria 44.ª de la
 * Ley 27/2014, BOE-A-2014-12328).
 *
 * CONTRASTADO el 27-11-2026 con el texto consolidado del BOE (última actualización publicada el
 * 21-12-2024, Ley 7/2024, disposición final 8.ª):
 *
 * - General: 25 %.
 * - Microempresas (importe neto de la cifra de negocios del periodo anterior inferior a 1 millón):
 *   escala por tramos de base imponible. Periodos iniciados en 2025: 21 % hasta 50.000 € y 22 % el
 *   resto. En 2026: 19 % y 21 %. Desde 2027 (art. 29.1): 17 % y 20 %.
 * - Entidades de reducida dimensión (art. 101: cifra de negocios del periodo anterior inferior a
 *   10 millones): 24 % en 2025, 23 % en 2026, 22 % en 2027, 21 % en 2028 y 20 % desde 2029.
 * - Entidades de nueva creación: 15 % en el primer periodo con base imponible positiva y en el
 *   siguiente.
 * - Si el periodo dura menos de un año, el tramo de 50.000 € se prorratea por días entre 365.
 *
 * NO CONTRASTADO ese día (redacciones anteriores, de conocimiento de la norma): el 23 % de las
 * microempresas en los periodos iniciados en 2023 y 2024 (Ley 31/2022) y el 25 % de las entidades
 * de reducida dimensión hasta 2024.
 *
 * No se contemplan los tipos especiales (cooperativas, entidades sin fines lucrativos, SOCIMI,
 * entidades de crédito, ZEC…): para ellos está el tipo «personalizado».
 */

export type CorporateTaxRegime = "general" | "micro" | "reduced" | "newCompany" | "custom";

export const CORPORATE_TAX_REGIMES: readonly CorporateTaxRegime[] = ["general", "micro", "reduced", "newCompany", "custom"];

export const CORPORATE_TAX_REGIME_LABELS: Record<CorporateTaxRegime, string> = {
  general: "Tipo general",
  micro: "Microempresa (cifra de negocios del año anterior inferior a 1 millón)",
  reduced: "Entidad de reducida dimensión (inferior a 10 millones)",
  newCompany: "Entidad de nueva creación",
  custom: "Otro tipo (lo indico yo)",
};

/** Tramo de la escala: `upToCents` null = sin límite (el resto de la base). */
export type RateBracket = { upToCents: number | null; pct: number };

export type RateSchedule = {
  regime: CorporateTaxRegime;
  brackets: RateBracket[];
  /** Norma de la que sale el tipo, para enseñarla junto al cálculo. */
  source: string;
};

export const GENERAL_RATE_PCT = 25;
export const NEW_COMPANY_RATE_PCT = 15;
/** Tramo de base imponible al tipo reducido de la escala de microempresas (art. 29.1). */
export const MICRO_FIRST_BRACKET_CENTS = 50_000_00;
/** Umbrales de cifra de negocios del periodo anterior (art. 29.1 y art. 101). */
export const MICRO_REVENUE_LIMIT_CENTS = 1_000_000_00;
export const REDUCED_REVENUE_LIMIT_CENTS = 10_000_000_00;

function microRates(startYear: number): { first: number; rest: number; source: string } {
  if (startYear >= 2027) return { first: 17, rest: 20, source: "art. 29.1 de la Ley 27/2014" };
  if (startYear === 2026) return { first: 19, rest: 21, source: "disposición transitoria 44.ª.2 de la Ley 27/2014" };
  if (startYear === 2025) return { first: 21, rest: 22, source: "disposición transitoria 44.ª.1 de la Ley 27/2014" };
  if (startYear >= 2023) return { first: 23, rest: 23, source: "art. 29.1 de la Ley 27/2014 (redacción de la Ley 31/2022)" };
  return { first: GENERAL_RATE_PCT, rest: GENERAL_RATE_PCT, source: "art. 29.1 de la Ley 27/2014" };
}

function reducedRate(startYear: number): { pct: number; source: string } {
  if (startYear >= 2029) return { pct: 20, source: "art. 29.1 de la Ley 27/2014" };
  if (startYear === 2028) return { pct: 21, source: "disposición transitoria 44.ª.4 de la Ley 27/2014" };
  if (startYear === 2027) return { pct: 22, source: "disposición transitoria 44.ª.3 de la Ley 27/2014" };
  if (startYear === 2026) return { pct: 23, source: "disposición transitoria 44.ª.2 de la Ley 27/2014" };
  if (startYear === 2025) return { pct: 24, source: "disposición transitoria 44.ª.1 de la Ley 27/2014" };
  return { pct: GENERAL_RATE_PCT, source: "art. 29.1 de la Ley 27/2014" };
}

/** Parte de un importe anual que corresponde a un periodo de `periodDays` días (entre 365, como dice la ley). */
export function prorateByDays(annualCents: number, periodDays: number | null | undefined): number {
  if (!periodDays || periodDays >= 365) return annualCents;
  return Math.round((annualCents * Math.max(periodDays, 0)) / 365);
}

export function corporateTaxRateSchedule(input: {
  regime: CorporateTaxRegime;
  /** Año natural en el que se inicia el periodo impositivo. */
  startYear: number;
  /** Días del periodo impositivo; menos de 365 prorratea el tramo de 50.000 €. */
  periodDays?: number | null;
  /** Solo con `regime: "custom"`. */
  customRatePct?: number | null;
}): RateSchedule {
  switch (input.regime) {
    case "micro": {
      const rates = microRates(input.startYear);
      if (rates.first === rates.rest) return { regime: "micro", brackets: [{ upToCents: null, pct: rates.first }], source: rates.source };
      return {
        regime: "micro",
        brackets: [
          { upToCents: prorateByDays(MICRO_FIRST_BRACKET_CENTS, input.periodDays), pct: rates.first },
          { upToCents: null, pct: rates.rest },
        ],
        source: rates.source,
      };
    }
    case "reduced": {
      const rate = reducedRate(input.startYear);
      return { regime: "reduced", brackets: [{ upToCents: null, pct: rate.pct }], source: rate.source };
    }
    case "newCompany":
      return { regime: "newCompany", brackets: [{ upToCents: null, pct: NEW_COMPANY_RATE_PCT }], source: "art. 29.1 de la Ley 27/2014 (entidades de nueva creación)" };
    case "custom": {
      const pct = Number.isFinite(input.customRatePct) ? Math.min(Math.max(Number(input.customRatePct), 0), 100) : GENERAL_RATE_PCT;
      return { regime: "custom", brackets: [{ upToCents: null, pct }], source: "tipo indicado por el usuario" };
    }
    default:
      return { regime: "general", brackets: [{ upToCents: null, pct: GENERAL_RATE_PCT }], source: "art. 29.1 de la Ley 27/2014" };
  }
}

export type BracketQuota = { baseCents: number; pct: number; quotaCents: number };

/** Cuota de cada tramo: base positiva repartida por la escala, redondeada al céntimo en cada tramo. */
export function applyRateSchedule(baseCents: number, brackets: readonly RateBracket[]): BracketQuota[] {
  const result: BracketQuota[] = [];
  let remaining = Math.max(baseCents, 0);
  let floor = 0;
  for (const bracket of brackets) {
    const width = bracket.upToCents === null ? remaining : Math.max(Math.min(bracket.upToCents - floor, remaining), 0);
    if (bracket.upToCents !== null) floor = bracket.upToCents;
    if (width <= 0 && result.length > 0) continue;
    result.push({ baseCents: width, pct: bracket.pct, quotaCents: Math.round((width * bracket.pct) / 100) });
    remaining -= width;
  }
  return result;
}

/**
 * Régimen que encaja con la cifra de negocios del periodo anterior. Es una propuesta: el programa
 * no sabe si la sociedad es patrimonial (art. 5.2, excluida de los tipos reducidos), si forma
 * parte de un grupo (la cifra se computa a nivel de grupo, art. 101.3) ni si es de nueva creación.
 */
export function suggestedRegime(priorYearRevenueCents: number | null | undefined): CorporateTaxRegime {
  if (priorYearRevenueCents === null || priorYearRevenueCents === undefined) return "general";
  if (priorYearRevenueCents < MICRO_REVENUE_LIMIT_CENTS) return "micro";
  if (priorYearRevenueCents < REDUCED_REVENUE_LIMIT_CENTS) return "reduced";
  return "general";
}
