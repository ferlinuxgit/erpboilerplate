import {
  alpha, amountUnsigned, buildRecord, declarantProblems, fiscalFile, FiscalFileError, normalizeSpanishNif, numeric,
  wrapSelfAssessment, type Declarant, type FilePeriod, type FiscalFile,
} from "@/server/fiscal-files/fields";

/**
 * Modelo 123 (retenciones sobre rendimientos del capital mobiliario: dividendos e intereses):
 * fichero para importar en el formulario de la sede. Diseño de registro oficial «DR123e24.xls»,
 * versión 2.0 (ejercicio 2024 y siguientes, Orden HAC/56/2024): página única de 600 posiciones.
 * https://sede.agenciatributaria.gob.es/static_files/Sede/Disenyo_registro/DR_100_199/archivos_24/DR123e24.xls
 *
 * Las casillas 10 y 11 (periodificación de rendimientos de ejercicios anteriores) no las calcula
 * el programa y van a cero.
 */

export const MODELO_123_PAGE_LENGTH = 600;
export const MODELO_123_FIRST_YEAR = 2024;

export type Modelo123Totals = { count: number; baseCents: number; withheldCents: number };

export type Modelo123Input = {
  declarant: Declarant;
  period: FilePeriod;
  /** Dividendos y otras rentas de participación en fondos propios (casillas 01, 04 y 07). */
  dividends: Modelo123Totals;
  /** Resto de rentas (casillas 02, 05 y 08). */
  other: Modelo123Totals;
  /** Casilla 13 (solo en una complementaria). El fichero no se genera si es distinta de cero. */
  previousCents?: number;
  /** I ingreso, U domiciliación, G cuenta corriente tributaria, N negativa. */
  declarationType?: "I" | "U" | "G" | "N";
  iban?: string | null;
};

export function buildModelo123File(input: Modelo123Input): FiscalFile {
  const problems = declarantProblems(input.declarant);
  const { period, dividends, other } = input;
  if (period.code === "0A") problems.push("El modelo 123 es trimestral o mensual: el periodo no es válido.");
  if (period.year < MODELO_123_FIRST_YEAR) problems.push(`El fichero se genera con el diseño de registro del 123 de ${MODELO_123_FIRST_YEAR} en adelante; para ejercicios anteriores presenta el modelo directamente en la sede.`);
  for (const [label, totals] of [["dividendos", dividends], ["resto de rentas", other]] as const) {
    if (totals.baseCents < 0 || totals.withheldCents < 0 || totals.count < 0) problems.push(`Los importes de ${label} salen negativos y el diseño del 123 no admite signo. Preséntalo a mano en la sede.`);
    if (totals.withheldCents > 0 && totals.count <= 0) problems.push(`Hay retenciones de ${label} pero ninguna renta contada. Revisa los rendimientos del capital pagados en el periodo.`);
  }
  const withheldCents = Math.round(dividends.withheldCents) + Math.round(other.withheldCents);
  const previousCents = Math.round(input.previousCents ?? 0);
  if (previousCents !== 0) problems.push("El modelo tiene importe en la casilla 13 (autoliquidación complementaria): el fichero no lleva el justificante de la declaración anterior. Presenta la complementaria directamente en la sede.");
  const resultCents = withheldCents - previousCents;
  const type = input.declarationType ?? (resultCents > 0 ? "I" : "N");
  if (type === "N" && resultCents > 0) problems.push("El tipo de declaración «N» (negativa) no corresponde a un resultado a ingresar.");
  if (type !== "N" && resultCents <= 0) problems.push(`El tipo de declaración «${type}» no corresponde a un resultado sin ingreso: usa «N».`);
  if (type === "U" && !input.iban) problems.push("Para domiciliar el pago hace falta el IBAN de la cuenta.");
  if (problems.length > 0) throw new FiscalFileError(problems);

  const count = (value: number, box: string) => ({ len: 15, value: numeric(Math.round(value), 15, "número de rentas"), name: `[${box}]` });
  const money = (cents: number, box: string) => ({ len: 17, value: amountUnsigned(cents, 17, `casilla ${box}`), name: `[${box}]` });
  const page = buildRecord(MODELO_123_PAGE_LENGTH, [
    { pos: 1, len: 2, value: "<T" },
    { pos: 3, len: 3, value: "123" },
    { pos: 6, len: 2, value: "01" },
    { pos: 8, len: 4, value: "000>" },
    { pos: 13, len: 1, value: type, name: "tipo de declaración" },
    { pos: 14, len: 9, value: alpha(normalizeSpanishNif(input.declarant.taxId), 9), name: "NIF" },
    { pos: 23, len: 80, value: alpha(input.declarant.name, 80), name: "razón social" },
    { pos: 103, len: 4, value: numeric(period.year, 4) },
    { pos: 107, len: 2, value: period.code },
    { pos: 109, ...count(dividends.count, "01") },
    { pos: 124, ...count(other.count, "02") },
    { pos: 139, ...count(dividends.count + other.count, "03") },
    { pos: 154, ...money(dividends.baseCents, "04") },
    { pos: 171, ...money(other.baseCents, "05") },
    { pos: 188, ...money(dividends.baseCents + other.baseCents, "06") },
    { pos: 205, ...money(dividends.withheldCents, "07") },
    { pos: 222, ...money(other.withheldCents, "08") },
    { pos: 239, ...money(withheldCents, "09") },
    { pos: 256, ...money(0, "10") },
    { pos: 273, ...money(0, "11") },
    { pos: 290, ...money(withheldCents, "12") },
    { pos: 307, ...money(0, "13") },
    { pos: 324, ...money(resultCents, "14") },
    { pos: 355, len: 34, value: alpha(type === "U" ? input.iban : "", 34), name: "IBAN" },
    { pos: 589, len: 12, value: "</T12301000>" },
  ]);

  const warnings = ["Las casillas 10 y 11 (periodificación de rendimientos de ejercicios anteriores) van a cero: complétalas en la sede si te afectan."];
  return fiscalFile(`123-${period.year}-${period.code}.txt`, wrapSelfAssessment("123", period, [page]), warnings);
}
