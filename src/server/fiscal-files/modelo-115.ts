import {
  alpha, amountUnsigned, buildRecord, declarantProblems, fiscalFile, FiscalFileError, normalizeSpanishNif, numeric,
  splitDeclarantName, wrapSelfAssessment, type Declarant, type FilePeriod, type FiscalFile,
} from "@/server/fiscal-files/fields";

/**
 * Modelo 115 (retenciones sobre arrendamientos de inmuebles urbanos): fichero para importar en el
 * formulario de la sede. Diseño de registro oficial «DR115e15v13.xls» (Orden EHA/3435/2007,
 * ejercicios 2019 y siguientes, versión 1.3, febrero de 2019): página única de 500 posiciones.
 * https://sede.agenciatributaria.gob.es/static_files/Sede/Disenyo_registro/DR_100_199/archivos/DR115e15v13.xls
 */

export type Modelo115Input = {
  declarant: Declarant;
  period: FilePeriod;
  /** Casilla 01: número de arrendadores con retención en el periodo. */
  recipients: number;
  /** Casilla 02: base de las retenciones. */
  baseCents: number;
  /** Casilla 03: retenciones. */
  withheldCents: number;
  /** I ingreso, U domiciliación, G cuenta corriente tributaria, N negativa. */
  declarationType?: "I" | "U" | "G" | "N";
  iban?: string | null;
};

export const MODELO_115_PAGE_LENGTH = 500;

export function buildModelo115File(input: Modelo115Input): FiscalFile {
  const problems = declarantProblems(input.declarant);
  if (input.period.code === "0A") problems.push("El modelo 115 es trimestral o mensual: el periodo no es válido.");
  if (input.baseCents < 0 || input.withheldCents < 0) problems.push("Las retenciones de alquileres del periodo salen negativas: el fichero del 115 no admite importes negativos. Preséntalo a mano en la sede.");
  if (input.withheldCents > 0 && input.recipients <= 0) problems.push("Hay retenciones de alquileres pero no se ha podido contar ningún arrendador. Revisa las facturas de alquiler del periodo.");
  const type = input.declarationType ?? (input.withheldCents > 0 ? "I" : "N");
  if (type === "U" && !input.iban) problems.push("Para domiciliar el pago hace falta el IBAN de la cuenta.");
  if (problems.length > 0) throw new FiscalFileError(problems);

  const name = splitDeclarantName(input.declarant);
  const page = buildRecord(MODELO_115_PAGE_LENGTH, [
    { pos: 1, len: 2, value: "<T" },
    { pos: 3, len: 3, value: "115" },
    { pos: 6, len: 2, value: "01" },
    { pos: 8, len: 4, value: "000>" },
    { pos: 13, len: 1, value: type, name: "tipo de declaración" },
    { pos: 14, len: 9, value: alpha(normalizeSpanishNif(input.declarant.taxId), 9), name: "NIF" },
    { pos: 23, len: 60, value: alpha(name.surname, 60) },
    { pos: 83, len: 20, value: alpha(name.firstName, 20) },
    { pos: 103, len: 4, value: numeric(input.period.year, 4) },
    { pos: 107, len: 2, value: input.period.code },
    { pos: 109, len: 15, value: numeric(input.recipients, 15, "número de perceptores"), name: "[01]" },
    { pos: 124, len: 17, value: amountUnsigned(input.baseCents, 17), name: "[02]" },
    { pos: 141, len: 17, value: amountUnsigned(input.withheldCents, 17), name: "[03]" },
    { pos: 158, len: 17, value: amountUnsigned(0, 17), name: "[04]" },
    { pos: 175, len: 17, value: amountUnsigned(input.withheldCents, 17), name: "[05]" },
    { pos: 206, len: 34, value: alpha(type === "U" ? input.iban : "", 34), name: "IBAN" },
    { pos: 489, len: 12, value: "</T11501000>" },
  ]);

  const warnings: string[] = [];
  if (name.needsReview) warnings.push("Comprueba en la sede que los apellidos y el nombre del declarante quedan en su casilla (no se han podido separar).");
  return fiscalFile(`115-${input.period.year}-${input.period.code}.txt`, wrapSelfAssessment("115", input.period, [page]), warnings);
}
