import {
  alpha, amountSignedN, amountUnsigned, buildRecord, declarantProblems, fiscalFile, FiscalFileError, normalizeSpanishNif, numeric,
  splitDeclarantName, wrapSelfAssessment, type Declarant, type FilePeriod, type FiscalFile, type RecordField,
} from "@/server/fiscal-files/fields";

/**
 * Modelo 111 (retenciones e ingresos a cuenta del IRPF): fichero para importar en el formulario de
 * la sede. Diseño de registro oficial «dr111e16v18.xls» (Orden EHA/3127/2009, ejercicios 2019 y
 * siguientes, actualizado en mayo de 2021): página única de 1000 posiciones.
 * https://sede.agenciatributaria.gob.es/static_files/Sede/Disenyo_registro/DR_100_199/archivos/dr111e16v18.xls
 *
 * El programa solo conoce las retenciones practicadas en facturas recibidas de profesionales
 * (rendimientos de actividades económicas, dinerarios). El resto de apartados (nóminas, premios,
 * forestales, imagen) van a cero: quien tenga trabajadores debe completarlos en la sede.
 */

export type Modelo111Input = {
  declarant: Declarant;
  period: FilePeriod;
  /** Rendimientos de actividades económicas, dinerarios: perceptores, percepciones y retenciones. */
  professionals: { recipients: number; baseCents: number; withheldCents: number };
  /** I ingreso, U domiciliación, G cuenta corriente tributaria, N negativa. Por defecto, I o N según el resultado. */
  declarationType?: "I" | "U" | "G" | "N";
  /** IBAN de la domiciliación (solo con tipo U). */
  iban?: string | null;
};

export const MODELO_111_PAGE_LENGTH = 1000;

export function buildModelo111File(input: Modelo111Input): FiscalFile {
  const problems = declarantProblems(input.declarant);
  if (input.period.code === "0A") problems.push("El modelo 111 es trimestral o mensual: el periodo no es válido.");
  const { recipients, baseCents, withheldCents } = input.professionals;
  if (baseCents < 0 || withheldCents < 0) problems.push("Las retenciones del periodo salen negativas (hay más abonos que facturas): el fichero del 111 no admite importes negativos. Preséntalo a mano en la sede.");
  if (withheldCents > 0 && recipients <= 0) problems.push("Hay retenciones pero no se ha podido contar ningún perceptor. Revisa las facturas recibidas con retención del periodo.");
  const type = input.declarationType ?? (withheldCents > 0 ? "I" : "N");
  if (type === "U" && !input.iban) problems.push("Para domiciliar el pago hace falta el IBAN de la cuenta.");
  if (problems.length > 0) throw new FiscalFileError(problems);

  const name = splitDeclarantName(input.declarant);
  const fields: RecordField[] = [
    { pos: 1, len: 2, value: "<T" },
    { pos: 3, len: 3, value: "111" },
    { pos: 6, len: 2, value: "01" },
    { pos: 8, len: 4, value: "000>" },
    { pos: 13, len: 1, value: type, name: "tipo de declaración" },
    { pos: 14, len: 9, value: alpha(normalizeSpanishNif(input.declarant.taxId), 9), name: "NIF" },
    { pos: 23, len: 60, value: alpha(name.surname, 60) },
    { pos: 83, len: 20, value: alpha(name.firstName, 20) },
    { pos: 103, len: 4, value: numeric(input.period.year, 4) },
    { pos: 107, len: 2, value: input.period.code },
  ];
  // Nueve bloques de «nº de perceptores (8) + percepciones (17) + retenciones (17)» desde la 109:
  // trabajo (dinerarios, especie), actividades económicas (dinerarios, especie), premios (ídem),
  // ganancias forestales (ídem) y cesión de derechos de imagen. Solo se rellena el tercero.
  for (let block = 0; block < 9; block += 1) {
    const start = 109 + block * 42;
    const own = block === 2;
    fields.push(
      { pos: start, len: 8, value: numeric(own ? recipients : 0, 8, "número de perceptores") },
      { pos: start + 8, len: 17, value: amountUnsigned(own ? baseCents : 0, 17, "importe de las percepciones") },
      { pos: start + 25, len: 17, value: amountUnsigned(own ? withheldCents : 0, 17, "importe de las retenciones") },
    );
  }
  fields.push(
    { pos: 487, len: 17, value: amountUnsigned(withheldCents, 17), name: "suma de retenciones" },
    { pos: 504, len: 17, value: amountSignedN(0, 17), name: "resultado de anteriores declaraciones" },
    { pos: 521, len: 17, value: amountUnsigned(withheldCents, 17), name: "resultado a ingresar" },
    { pos: 553, len: 34, value: alpha(type === "U" ? input.iban : "", 34), name: "IBAN" },
    { pos: 989, len: 12, value: "</T11101000>" },
  );
  const page = buildRecord(MODELO_111_PAGE_LENGTH, fields);

  const warnings = ["El fichero solo lleva las retenciones a profesionales de las facturas recibidas. Si pagas nóminas u otros rendimientos con retención, añádelos en la sede antes de presentar."];
  if (name.needsReview) warnings.push("Comprueba en la sede que los apellidos y el nombre del declarante quedan en su casilla (no se han podido separar).");
  return fiscalFile(`111-${input.period.year}-${input.period.code}.txt`, wrapSelfAssessment("111", input.period, [page]), warnings);
}
