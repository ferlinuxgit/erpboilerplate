/**
 * Regímenes del IGIC (Canarias) que cambian cómo se factura. Código puro, también en cliente.
 *
 * - Comerciante minorista (arts. 68 a 70 del texto refundido, D. Leg. 1/2025): personas físicas que
 *   venden al por menor sin transformar. Sus entregas están exentas (art. 50.Uno.27º Ley 4/2012):
 *   no repercuten IGIC ni deducen el soportado; no presentan el 420 por esas operaciones.
 * - Pequeño empresario o profesional (REPEP, arts. 106 a 110 Ley 4/2012): volumen anual de
 *   operaciones por debajo del umbral legal; operaciones exentas (art. 110.1 Ley 4/2012), sin
 *   deducción del soportado; solo declaran su volumen en el 425 (apartado III).
 * - Criterio de caja: devengo al cobro; a efectos de facturación es el régimen general.
 */

export const IGIC_REGIMES = ["general", "comerciante_minorista", "pequeno_empresario", "cash_accounting"] as const;
export type IgicRegime = (typeof IGIC_REGIMES)[number];

export const igicRegimeLabels: Record<IgicRegime, string> = {
  general: "General",
  comerciante_minorista: "Comerciante minorista",
  pequeno_empresario: "Pequeño empresario o profesional (REPEP)",
  cash_accounting: "Criterio de caja",
};

export const igicRegimeHelp: Record<IgicRegime, string> = {
  general: "Repercutes IGIC en tus facturas y deduces el que pagas. Presentas el 420 cada trimestre y el 425 en enero.",
  comerciante_minorista: "Vendes al por menor sin transformar (persona física). Tus ventas van exentas de IGIC y no deduces el soportado.",
  pequeno_empresario: "Tu volumen de operaciones está por debajo del umbral del REPEP. Facturas sin IGIC, no deduces el soportado y solo declaras tu volumen en el 425.",
  cash_accounting: "Como el general, pero el IGIC se devenga cuando cobras y se deduce cuando pagas.",
};

export function isIgicRegime(value: unknown): value is IgicRegime {
  return typeof value === "string" && (IGIC_REGIMES as readonly string[]).includes(value);
}

/** Regímenes del IGIC en los que las ventas van exentas y el IGIC soportado no se deduce. */
export function igicExemptRegime(territory: string | null | undefined, fiscalRegime: string | null | undefined) {
  return territory === "ES-CN" && (fiscalRegime === "comerciante_minorista" || fiscalRegime === "pequeno_empresario");
}

/** Mención obligatoria en las facturas de los regímenes exentos del IGIC. */
export const igicRegimeLegalNotes: Partial<Record<IgicRegime, string>> = {
  comerciante_minorista: "Comerciante minorista. Operación exenta del IGIC (art. 50.Uno.27º Ley 4/2012).",
  pequeno_empresario: "Operación exenta del IGIC por aplicación del régimen especial del pequeño empresario o profesional (art. 110 Ley 4/2012).",
};

/**
 * Tipos del AIEM (Arbitrio sobre Importaciones y Entregas de Mercancías, art. 3 Ley 4/2014): cada
 * mercancía sujeta tributa al 5, 10, 15 o 25 % según el anexo de la ley (los derivados del
 * petróleo tienen tipo específico y no se gestionan aquí).
 */
export const AIEM_RATES = [5, 10, 15, 25] as const;
