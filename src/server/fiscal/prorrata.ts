/**
 * Prorrata general del IVA (arts. 102 a 110 LIVA). Módulo puro.
 *
 * - Porcentaje definitivo (art. 104): operaciones con derecho a deducción / total de operaciones
 *   del año natural, redondeado a la unidad superior.
 * - Regularización anual (art. 105.Cuatro): en el último periodo se recalculan con el porcentaje
 *   definitivo las deducciones practicadas durante el año con el provisional (casilla 44 del 303).
 * - Bienes de inversión (arts. 107 a 109): durante los cuatro años siguientes al de la compra
 *   (nueve en terrenos y edificaciones) se regulariza una quinta (o décima) parte de la deducción si
 *   la prorrata definitiva del año difiere en más de diez puntos de la del año de compra (casilla 43).
 */
import { applyPct, centsToNumber } from "@/server/accounting/money";
import { computeSupplierVat, type IssuedVatResult, type SupplierLineInput } from "@/server/fiscal/spain-calc";

export type FinalProrrata = {
  /** Denominador: total de operaciones del año (con y sin derecho a deducción). */
  totalCents: number;
  /** Numerador: operaciones que dan derecho a deducir. */
  deductibleCents: number;
  /** Operaciones exentas sin derecho a deducción y líneas nacionales sin IVA. */
  exemptCents: number;
  /** Porcentaje definitivo (0-100, redondeado por exceso); null si no hubo operaciones. */
  pct: number | null;
};

function sumBases(result: IssuedVatResult) {
  let base = 0;
  for (const bucket of result.vat.values()) base += bucket.base;
  return base;
}

/**
 * Prorrata definitiva del año a partir de las facturas emitidas (por la regla general de devengo).
 *
 * Con derecho a deducción: operaciones con IVA, entregas intracomunitarias, exportaciones,
 * operaciones con inversión del sujeto pasivo y no sujetas por reglas de localización (art. 94.Uno).
 * Sin derecho: las de tratamiento «Exenta» (art. 20) y las líneas sin IVA de facturas nacionales.
 *
 * No se pueden excluir, porque el programa no las distingue, las operaciones que el art. 104.Tres
 * deja fuera de numerador y denominador (entregas de bienes de inversión, operaciones inmobiliarias
 * o financieras no habituales): por eso el porcentaje es una propuesta que el usuario confirma.
 */
export function computeFinalProrrata(...years: IssuedVatResult[]): FinalProrrata {
  let deductible = 0;
  let exempt = 0;
  for (const year of years) {
    deductible += sumBases(year) + year.zeroRated.INTRA_EU + year.zeroRated.INTRA_EU_SERVICES + year.zeroRated.EXPORT + year.zeroRated.REVERSE_CHARGE + year.zeroRated.NOT_SUBJECT;
    exempt += year.zeroRated.EXEMPT + year.zeroRated.DOMESTIC;
  }
  const total = deductible + exempt;
  // Art. 104.Dos: «se redondeará en la unidad superior». Se trabaja en céntimos enteros.
  const pct = total > 0 && deductible >= 0 ? Math.min(100, Math.max(0, Math.ceil((deductible * 100) / total - 1e-9))) : null;
  return { totalCents: total, deductibleCents: deductible, exemptCents: exempt, pct };
}

/**
 * Regularización de las deducciones del año por el porcentaje definitivo (casilla 44): lo que se
 * habría deducido con el definitivo menos lo deducido con el provisional de cada factura.
 * Positiva = más deducción; negativa = hay que devolver deducción.
 */
export function computeProrrataRegularization(lines: SupplierLineInput[], provisionalPct: number, finalPct: number, selfAssessmentRate = 21) {
  const deducted = computeSupplierVat(lines, provisionalPct, selfAssessmentRate).deductibleCents;
  const definitive = computeSupplierVat(lines.map((line) => ({ ...line, prorrataPct: finalPct })), finalPct, selfAssessmentRate).deductibleCents;
  return definitive - deducted;
}

/** Art. 108.Dos.5.º LIVA: no son bienes de inversión los de valor de adquisición inferior a 3.005,06 €. */
export const INVESTMENT_GOOD_MIN_BASE_CENTS = 300_506;

export type InvestmentGoodInput = {
  invoiceId: string;
  number: string;
  description: string;
  /** Año de compra (el de registro de la factura): primer año del periodo de regularización. */
  purchaseYear: number;
  baseCents: number;
  /** Cuota soportada (autorepercutida si procede). */
  vatCents: number;
  /** % deducible propio de la línea (afectación parcial). */
  deductiblePct: number;
  /** Prorrata aplicada al contabilizar la factura (provisional de aquel año). */
  appliedProrrataPct: number;
  /** Terrenos y edificaciones: diez años en vez de cinco. */
  realEstate: boolean;
};

export type InvestmentGoodRegularization = InvestmentGoodInput & {
  /** Prorrata del año de compra usada: la definitiva confirmada o, si no la hay, la aplicada en la factura. */
  purchasePct: number;
  purchasePctConfirmed: boolean;
  /** Años de regularización (5 o 10) y cuál es el año en curso dentro de ellos (2 a 5 o 2 a 10). */
  years: number;
  yearNumber: number;
  /** Diferencia en puntos entre la prorrata definitiva del año y la del año de compra. */
  differencePoints: number;
  /** Importe a regularizar este año (0 si la diferencia no supera diez puntos). */
  regularizationCents: number;
};

/**
 * Regularización de bienes de inversión del año `year` (arts. 107 y 109 LIVA): para cada bien
 * comprado en los cuatro (o nueve) años anteriores, si la prorrata definitiva del año difiere en
 * más de diez puntos de la del año de compra, la diferencia entre la deducción que correspondería
 * con una y otra se divide entre cinco (o diez) y el cociente se ingresa o se deduce.
 *
 * Supuestos (el programa no guarda estos datos): el bien entró en funcionamiento el año de la
 * compra y sigue en el patrimonio (no se ha transmitido, art. 110). Devuelve todos los bienes
 * todavía en periodo de regularización, también los que este año no se regularizan.
 */
export function computeInvestmentGoodsRegularization(
  goods: InvestmentGoodInput[],
  options: { year: number; finalPct: number; finalByYear?: Record<string, number> },
): { goods: InvestmentGoodRegularization[]; totalCents: number } {
  const result: InvestmentGoodRegularization[] = [];
  for (const good of goods) {
    if (Math.abs(good.baseCents) < INVESTMENT_GOOD_MIN_BASE_CENTS || good.vatCents === 0) continue;
    const years = good.realEstate ? 10 : 5;
    const yearNumber = options.year - good.purchaseYear + 1;
    if (yearNumber < 2 || yearNumber > years) continue;
    const confirmed = options.finalByYear?.[String(good.purchaseYear)];
    const purchasePct = confirmed ?? good.appliedProrrataPct;
    const differencePoints = options.finalPct - purchasePct;
    const now = applyPct(good.vatCents, (good.deductiblePct * options.finalPct) / 100);
    const then = applyPct(good.vatCents, (good.deductiblePct * purchasePct) / 100);
    const regularizationCents = Math.abs(differencePoints) > 10 ? Math.round((now - then) / years) : 0;
    result.push({ ...good, purchasePct, purchasePctConfirmed: confirmed !== undefined, years, yearNumber, differencePoints, regularizationCents });
  }
  return { goods: result, totalCents: result.reduce((total, good) => total + good.regularizationCents, 0) };
}

/** Porcentajes definitivos confirmados por ejercicio: solo años de cuatro cifras y enteros de 0 a 100. */
export function normalizeVatProrataFinal(value: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  if (!value || typeof value !== "object") return result;
  for (const [year, pct] of Object.entries(value as Record<string, unknown>)) {
    if (pct === null || pct === "") continue;
    const parsed = Number(pct);
    if (/^20\d{2}$/.test(year) && Number.isInteger(parsed) && parsed >= 0 && parsed <= 100) result[year] = parsed;
  }
  return result;
}

export function describeProrrata(prorrata: FinalProrrata) {
  return `${centsToNumber(prorrata.deductibleCents).toFixed(2)} € con derecho a deducción sobre ${centsToNumber(prorrata.totalCents).toFixed(2)} € de operaciones`;
}
