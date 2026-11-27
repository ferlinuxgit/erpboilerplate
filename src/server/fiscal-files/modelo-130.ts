import {
  alpha, amountSignedN, amountUnsigned, buildRecord, declarantProblems, fiscalFile, FiscalFileError, normalizeSpanishNif, numeric,
  splitDeclarantName, wrapSelfAssessment, type Declarant, type FilePeriod, type FiscalFile, type RecordField,
} from "@/server/fiscal-files/fields";

/**
 * Modelo 130 (pago fraccionado del IRPF, estimación directa): fichero para importar en el
 * formulario de la sede. Diseño de registro oficial «DR130e15v12.xls» (Orden HAP/258/2015,
 * ejercicios 2019 y siguientes, versión 1.2, marzo de 2019): página única de 600 posiciones.
 * https://sede.agenciatributaria.gob.es/static_files/Sede/Disenyo_registro/DR_100_199/archivos/DR130e15v12.xls
 *
 * Las casillas 01 a 19 van seguidas desde la posición 109, 17 posiciones cada una. Llevan signo
 * (tipo «N» del diseño) la 03, 07, 11, 14, 17 y 19; el resto no admite negativos.
 */

export type Modelo130Input = {
  declarant: Declarant;
  period: FilePeriod;
  /** Importe en céntimos de cada casilla ("01"…"19"); las que falten van a cero. */
  boxes: Record<string, number>;
  /** I ingreso, U domiciliación, G cuenta corriente tributaria, N negativa, B resultado a deducir. */
  declarationType?: "I" | "U" | "G" | "N" | "B";
  iban?: string | null;
};

export const MODELO_130_PAGE_LENGTH = 600;
const SIGNED_BOXES = new Set(["03", "07", "11", "14", "17", "19"]);

export function buildModelo130File(input: Modelo130Input): FiscalFile {
  const problems = declarantProblems(input.declarant);
  if (!/^[1-4]T$/.test(input.period.code)) problems.push("El modelo 130 es trimestral: el periodo no es válido.");
  if (!input.declarant.isIndividual) problems.push("El modelo 130 es de personas físicas (autónomos): la empresa figura como sociedad en Configuración › Fiscalidad.");
  const result = input.boxes["19"] ?? 0;
  const type = input.declarationType ?? (result > 0 ? "I" : result < 0 ? "B" : "N");
  if (type === "U" && !input.iban) problems.push("Para domiciliar el pago hace falta el IBAN de la cuenta.");
  for (let box = 1; box <= 19; box += 1) {
    const key = String(box).padStart(2, "0");
    if (!SIGNED_BOXES.has(key) && (input.boxes[key] ?? 0) < 0) problems.push(`La casilla ${key} del 130 sale negativa y el diseño de la AEAT no lo admite. Revisa el cálculo del modelo.`);
  }
  if (problems.length > 0) throw new FiscalFileError(problems);

  const name = splitDeclarantName(input.declarant);
  const fields: RecordField[] = [
    { pos: 1, len: 2, value: "<T" },
    { pos: 3, len: 3, value: "130" },
    { pos: 6, len: 2, value: "01" },
    { pos: 8, len: 4, value: "000>" },
    { pos: 13, len: 1, value: type, name: "tipo de declaración" },
    { pos: 14, len: 9, value: alpha(normalizeSpanishNif(input.declarant.taxId), 9), name: "NIF" },
    { pos: 23, len: 60, value: alpha(name.surname, 60) },
    { pos: 83, len: 20, value: alpha(name.firstName, 20) },
    { pos: 103, len: 4, value: numeric(input.period.year, 4) },
    { pos: 107, len: 2, value: input.period.code },
  ];
  for (let box = 1; box <= 19; box += 1) {
    const key = String(box).padStart(2, "0");
    const cents = input.boxes[key] ?? 0;
    fields.push({
      pos: 109 + (box - 1) * 17,
      len: 17,
      value: SIGNED_BOXES.has(key) ? amountSignedN(cents, 17, `casilla ${key}`) : amountUnsigned(cents, 17, `casilla ${key}`),
      name: `[${key}]`,
    });
  }
  fields.push(
    { pos: 446, len: 34, value: alpha(type === "U" ? input.iban : "", 34), name: "IBAN" },
    { pos: 589, len: 12, value: "</T13001000>" },
  );
  const page = buildRecord(MODELO_130_PAGE_LENGTH, fields);

  const warnings: string[] = [];
  if (name.needsReview) warnings.push("Comprueba en la sede que los apellidos y el nombre quedan cada uno en su casilla (no se han podido separar: escribe el nombre de la empresa como «APELLIDOS, NOMBRE» para que salga bien).");
  return fiscalFile(`130-${input.period.year}-${input.period.code}.txt`, wrapSelfAssessment("130", input.period, [page]), warnings);
}
