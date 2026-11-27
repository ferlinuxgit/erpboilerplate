/**
 * Menciones legales de la factura (código puro, también usable en cliente).
 *
 * El art. 6.1 del Reglamento de facturación (RD 1619/2012) obliga a imprimir, según el caso:
 * j) la referencia a la norma que declara exenta la operación; l) «facturación por el
 * destinatario»; m) «inversión del sujeto pasivo»; n) el régimen especial de bienes usados, objetos
 * de arte o antigüedades; ñ) «régimen especial de las agencias de viajes»; p) «régimen especial
 * del criterio de caja». Las de m) y p) y las del tratamiento de IVA ya salen solas; el resto se
 * escribe en el campo «menciones legales» de la factura, con estas plantillas como ayuda.
 *
 * Los ordinales del art. 20.Uno de la Ley 37/1992 proceden del texto de la ley tal y como lo
 * conocemos; no se han contrastado en línea al escribir este archivo.
 */

export type LegalMentionPreset = { id: string; label: string; text: string };

export const LEGAL_MENTION_PRESETS: LegalMentionPreset[] = [
  { id: "used-goods", label: "Régimen especial de los bienes usados", text: "Régimen especial de los bienes usados." },
  { id: "art-objects", label: "Régimen especial de los objetos de arte", text: "Régimen especial de los objetos de arte." },
  { id: "antiques", label: "Régimen especial de las antigüedades y objetos de colección", text: "Régimen especial de las antigüedades y objetos de colección." },
  { id: "travel-agencies", label: "Régimen especial de las agencias de viajes", text: "Régimen especial de las agencias de viajes." },
  { id: "self-billing", label: "Facturación por el destinatario", text: "Facturación por el destinatario." },
  { id: "exempt-health", label: "Exenta: asistencia sanitaria (art. 20.Uno.3.º)", text: "Operación exenta de IVA: asistencia a personas físicas por profesionales médicos o sanitarios (art. 20.Uno.3.º de la Ley 37/1992)." },
  { id: "exempt-hospital", label: "Exenta: hospitalización y asistencia en centros sanitarios (art. 20.Uno.2.º)", text: "Operación exenta de IVA: servicios de hospitalización o asistencia sanitaria (art. 20.Uno.2.º de la Ley 37/1992)." },
  { id: "exempt-education", label: "Exenta: enseñanza y formación (art. 20.Uno.9.º)", text: "Operación exenta de IVA: educación, enseñanza y formación (art. 20.Uno.9.º de la Ley 37/1992)." },
  { id: "exempt-private-lessons", label: "Exenta: clases particulares (art. 20.Uno.10.º)", text: "Operación exenta de IVA: clases a título particular sobre materias de los planes de estudios (art. 20.Uno.10.º de la Ley 37/1992)." },
  { id: "exempt-insurance", label: "Exenta: seguros (art. 20.Uno.16.º)", text: "Operación exenta de IVA: operaciones de seguro, reaseguro y capitalización (art. 20.Uno.16.º de la Ley 37/1992)." },
  { id: "exempt-financial", label: "Exenta: operaciones financieras (art. 20.Uno.18.º)", text: "Operación exenta de IVA: operaciones financieras (art. 20.Uno.18.º de la Ley 37/1992)." },
  { id: "exempt-housing-rent", label: "Exenta: alquiler de vivienda (art. 20.Uno.23.º)", text: "Operación exenta de IVA: arrendamiento de vivienda (art. 20.Uno.23.º de la Ley 37/1992)." },
  { id: "exempt-authors", label: "Exenta: servicios de autores y artistas (art. 20.Uno.26.º)", text: "Operación exenta de IVA: servicios profesionales de artistas plásticos, escritores y demás autores (art. 20.Uno.26.º de la Ley 37/1992)." },
  { id: "disbursements", label: "Suplidos (gastos pagados por cuenta del cliente)", text: "Los suplidos son gastos pagados en nombre y por cuenta del cliente y no forman parte de la base imponible (art. 78.Tres.3.º de la Ley 37/1992)." },
];

/** Añade una mención al texto existente, en línea aparte y sin repetirla. */
export function appendLegalMention(current: string | null | undefined, mention: string) {
  const text = (current ?? "").trim();
  if (!text) return mention;
  if (text.includes(mention)) return text;
  return `${text}\n${mention}`;
}

/** Menciones escritas por el usuario, una por renglón no vacío. */
export function legalMentionLines(value: string | null | undefined): string[] {
  return (value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

type Bucket = { kind?: string | null; operation?: string | null; rate: number; baseAmount: number; amount: number };

/**
 * ¿Hay base sin IVA en la factura (líneas sin impuesto o al 0 %)? Mismo criterio que el registro
 * VERI*FACTU, que declara esa base como exenta (`buildBreakdown`).
 */
export function hasUntaxedBase(totals: { subtotal: number; taxBuckets: Bucket[] }): boolean {
  const cents = (value: number) => Math.round(value * 100);
  const covered = totals.taxBuckets
    .filter((bucket) => (bucket.operation ?? "ADD") === "ADD" && (bucket.kind ?? "VAT").toUpperCase() === "VAT")
    .filter((bucket) => bucket.rate !== 0 || cents(bucket.amount) !== 0)
    .reduce((sum, bucket) => sum + cents(bucket.baseAmount), 0);
  return cents(totals.subtotal) - covered !== 0;
}

const EXEMPTION_ARTICLE_NOTES: Record<string, string> = {
  E1: "Incluye operaciones exentas de IVA (art. 20 de la Ley 37/1992).",
  E2: "Incluye operaciones exentas de IVA por exportación (art. 21 de la Ley 37/1992).",
  E3: "Incluye operaciones exentas de IVA asimiladas a las exportaciones (art. 22 de la Ley 37/1992).",
  E4: "Incluye operaciones exentas de IVA (arts. 23 y 24 de la Ley 37/1992).",
  E5: "Incluye entregas intracomunitarias exentas de IVA (art. 25 de la Ley 37/1992).",
  E6: "Incluye operaciones exentas de IVA.",
};

/**
 * Mención que explica las bases sin IVA de una factura NACIONAL del territorio común del IVA
 * (art. 6.1.j). Es la misma causa que se declara a la AEAT: la elegida en la factura o, si no se
 * eligió, E1. No se añade si el usuario ya escribió sus propias menciones (se supone que lo
 * explican mejor: artículo concreto, suplidos…).
 */
export function untaxedBaseLegalNote(input: {
  vatTreatment: string;
  /** Territorio fiscal del emisor: solo «ES» (península y Baleares). En Canarias el tipo cero existe. */
  territory: string | null | undefined;
  exemptionCode: string | null | undefined;
  legalMentions: string | null | undefined;
  totals: { subtotal: number; taxBuckets: Bucket[] };
}): string | null {
  if (input.vatTreatment !== "DOMESTIC" || (input.territory ?? "ES") !== "ES") return null;
  if (legalMentionLines(input.legalMentions).length > 0) return null;
  if (!hasUntaxedBase(input.totals)) return null;
  return EXEMPTION_ARTICLE_NOTES[input.exemptionCode ?? "E1"] ?? EXEMPTION_ARTICLE_NOTES.E1;
}
