/**
 * Libro registro de bienes de inversión para el SII (`SuministroLRBienesInversion`). Código puro.
 *
 * QUIÉN Y CUÁNDO. Lo llevan los sujetos pasivos que deben regularizar las deducciones por bienes
 * de inversión (art. 65 RIVA), es decir, los que aplican prorrata. Se suministra una vez al año,
 * dentro del plazo de presentación del último periodo de liquidación (art. 69 bis.1.d RIVA: hasta
 * el 30 de enero), con el periodo «0A» (validación 3.1.1 del documento de la AEAT). Por eso el
 * programa solo genera el libro de un ejercicio cuando su prorrata DEFINITIVA está confirmada en
 * Configuración › Fiscalidad: sin ella no hay nada que regularizar ni dato que suministrar.
 *
 * QUÉ BIENES. Las líneas de facturas recibidas marcadas como bien de inversión (o con cuenta del
 * grupo 2), de base no inferior a 3.005,06 € (art. 108.Dos.5.º LIVA) y con cuota, durante su
 * periodo de regularización: el año de compra y los cuatro siguientes (nueve en terrenos y
 * edificaciones). El importe sale de la misma función que la casilla 43 del 303
 * (`computeInvestmentGoodsRegularization`).
 *
 * SUPUESTOS Y LÍMITES
 * - Inicio de utilización: la fecha de puesta en servicio de la ficha de inmovilizado enlazada a la
 *   factura; si no hay ficha, la fecha de registro de la factura.
 * - Transmisión del bien (art. 110 LIVA): el programa no calcula esa regularización. El apunte del
 *   ejercicio en que se da de baja el bien queda bloqueado con el motivo a la vista, y en los
 *   ejercicios posteriores no se genera apunte.
 * - Identificación del bien: código y descripción de la ficha de inmovilizado o, sin ficha, la
 *   descripción de la línea; si se repite dentro de una factura se numera.
 */
import { nextBusinessDay } from "@/lib/fiscal-spain";
import { computeInvestmentGoodsRegularization, INVESTMENT_GOOD_MIN_BASE_CENTS, type InvestmentGoodInput } from "@/server/fiscal/prorrata";
import type { SiiInvestmentGood, SiiParty } from "@/server/sii/types";
import { formatAeatAmount } from "@/server/verifactu/format";

export type SiiInvestmentGoodSource = InvestmentGoodInput & {
  /** Id estable de la línea de la factura. */
  lineId: string;
  issuer: SiiParty | null;
  /** Número de la factura del proveedor y fecha de expedición dd-mm-aaaa. */
  invoiceNumber: string;
  invoiceIssueDate: string;
  /** Fecha de registro de la factura dd-mm-aaaa (inicio de utilización si no hay ficha). */
  accountingDate: string;
  asset?: {
    code: string;
    description: string;
    /** Puesta en servicio dd-mm-aaaa. */
    inServiceDate: string;
    /** Año de la baja o venta del bien, si se ha transmitido. */
    disposalYear: number | null;
  } | null;
};

export type MappedInvestmentGood = { sourceId: string; good: SiiInvestmentGood; problems: string[] };

/** Último día para suministrar el libro de un ejercicio: 30 de enero del año siguiente, trasladado si es inhábil. */
export function investmentGoodsDueDate(year: number) {
  return nextBusinessDay(new Date(Date.UTC(year + 1, 0, 30))).toISOString().slice(0, 10);
}

/** Apuntes del libro de bienes de inversión del ejercicio `year`, con la prorrata definitiva `finalPct`. */
export function mapInvestmentGoods(goods: SiiInvestmentGoodSource[], options: { year: number; finalPct: number; finalByYear?: Record<string, number> }): MappedInvestmentGood[] {
  const regularized = computeInvestmentGoodsRegularization(goods, options).goods;
  const regularizationByLine = new Map<string, number>();
  for (const entry of regularized) regularizationByLine.set((entry as typeof entry & { lineId: string }).lineId, entry.regularizationCents);

  const usedIds = new Map<string, number>();
  const result: MappedInvestmentGood[] = [];
  for (const good of [...goods].sort((left, right) => left.lineId.localeCompare(right.lineId))) {
    if (Math.abs(good.baseCents) < INVESTMENT_GOOD_MIN_BASE_CENTS || good.vatCents === 0) continue;
    const years = good.realEstate ? 10 : 5;
    const yearNumber = options.year - good.purchaseYear + 1;
    if (yearNumber < 1 || yearNumber > years) continue;
    const disposalYear = good.asset?.disposalYear ?? null;
    if (disposalYear !== null && disposalYear < options.year) continue;

    const problems: string[] = [];
    if (!good.issuer) problems.push("El proveedor no tiene NIF: complétalo en su ficha para poder suministrar el bien de inversión.");
    if (disposalYear === options.year) {
      problems.push("El bien se dio de baja o se vendió en este ejercicio: la regularización por transmisión (art. 110 de la Ley del IVA) no la calcula el programa. Suministra este apunte desde la sede de la AEAT.");
    }
    const base = (good.asset ? `${good.asset.code} ${good.asset.description}` : good.description).trim().replace(/\s+/g, " ") || "Bien de inversión";
    const invoiceKey = `${good.invoiceId}|${base.slice(0, 40)}`;
    const repeat = (usedIds.get(invoiceKey) ?? 0) + 1;
    usedIds.set(invoiceKey, repeat);
    const goodId = repeat === 1 ? base.slice(0, 40) : `${base.slice(0, 36)} (${repeat})`;
    // En el año de compra no hay regularización de bienes de inversión (la del año va por la general, casilla 44).
    const regularization = yearNumber >= 2 ? regularizationByLine.get(good.lineId) ?? 0 : null;

    result.push({
      sourceId: `${good.lineId}:${options.year}`,
      problems,
      good: {
        invoiceSourceId: good.invoiceId,
        year: String(options.year),
        issuer: good.issuer ?? { name: "", nif: "" },
        number: good.invoiceNumber,
        issueDate: good.invoiceIssueDate,
        goodId,
        startOfUseDate: good.asset?.inServiceDate ?? good.accountingDate,
        finalProrrata: formatAeatAmount(options.finalPct),
        annualRegularization: regularization === null ? null : formatAeatAmount(regularization / 100),
      },
    });
  }
  return result;
}
