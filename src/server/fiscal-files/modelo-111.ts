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
 * Lleva los cinco apartados de la liquidación (casillas 01 a 27): trabajo, actividades económicas,
 * premios y ganancias forestales (dinerarios y en especie) y cesión de derechos de imagen. Los
 * calcula `computeModelo111` a partir de nóminas y facturas recibidas con retención.
 */

export type Modelo111Totals = { recipients: number; baseCents: number; withheldCents: number };

export type Modelo111Block = "work" | "economic" | "prizes" | "forestry" | "image";

export type Modelo111Input = {
  declarant: Declarant;
  period: FilePeriod;
  /** Apartados de la liquidación; los que falten van a cero. La cesión de imagen solo usa `cash`. */
  blocks?: Array<{ block: Modelo111Block; cash: Modelo111Totals; inKind?: Modelo111Totals }>;
  /**
   * Atajo de los modelos guardados antes de que el programa llevara nóminas: solo retenciones a
   * profesionales (actividades económicas, dinerarias).
   */
  professionals?: Modelo111Totals;
  /** Casilla 29 (solo en una complementaria). El fichero no se genera si es distinta de cero. */
  previousCents?: number;
  /** I ingreso, U domiciliación, G cuenta corriente tributaria, N negativa. Por defecto, I o N según el resultado. */
  declarationType?: "I" | "U" | "G" | "N";
  /** IBAN de la domiciliación (solo con tipo U). */
  iban?: string | null;
};

export const MODELO_111_PAGE_LENGTH = 1000;

/** Orden de los nueve tríos «perceptores (8) + percepciones (17) + retenciones (17)» desde la posición 109. */
const SLOTS: Array<{ block: Modelo111Block; kind: "cash" | "inKind"; boxes: string }> = [
  { block: "work", kind: "cash", boxes: "01-03" },
  { block: "work", kind: "inKind", boxes: "04-06" },
  { block: "economic", kind: "cash", boxes: "07-09" },
  { block: "economic", kind: "inKind", boxes: "10-12" },
  { block: "prizes", kind: "cash", boxes: "13-15" },
  { block: "prizes", kind: "inKind", boxes: "16-18" },
  { block: "forestry", kind: "cash", boxes: "19-21" },
  { block: "forestry", kind: "inKind", boxes: "22-24" },
  { block: "image", kind: "cash", boxes: "25-27" },
];

const EMPTY: Modelo111Totals = { recipients: 0, baseCents: 0, withheldCents: 0 };

export function buildModelo111File(input: Modelo111Input): FiscalFile {
  const problems = declarantProblems(input.declarant);
  if (input.period.code === "0A") problems.push("El modelo 111 es trimestral o mensual: el periodo no es válido.");

  const blocks = input.blocks ?? (input.professionals ? [{ block: "economic" as const, cash: input.professionals }] : []);
  const totalsOf = (slot: (typeof SLOTS)[number]): Modelo111Totals => {
    const block = blocks.find((entry) => entry.block === slot.block);
    return (slot.kind === "cash" ? block?.cash : block?.inKind) ?? EMPTY;
  };
  // La cesión de derechos de imagen no distingue dinerario y especie: si llega algo «en especie», se suma.
  const image = blocks.find((entry) => entry.block === "image");
  const slots = SLOTS.map((slot) => {
    const totals = totalsOf(slot);
    if (slot.block !== "image" || !image?.inKind) return { slot, totals };
    return { slot, totals: { recipients: totals.recipients + image.inKind.recipients, baseCents: totals.baseCents + image.inKind.baseCents, withheldCents: totals.withheldCents + image.inKind.withheldCents } };
  });

  let totalCents = 0;
  for (const { slot, totals } of slots) {
    totalCents += Math.round(totals.withheldCents);
    if (totals.baseCents < 0 || totals.withheldCents < 0) problems.push(`Las casillas ${slot.boxes} salen negativas (hay más abonos que percepciones): el fichero del 111 no admite importes negativos. Preséntalo a mano en la sede.`);
    if (totals.withheldCents > 0 && totals.recipients <= 0) problems.push(`Hay retenciones en las casillas ${slot.boxes} pero no se ha podido contar ningún perceptor. Revisa las nóminas y las facturas con retención del periodo.`);
  }
  const previousCents = Math.round(input.previousCents ?? 0);
  if (previousCents !== 0) problems.push("El modelo tiene importe en la casilla 29 (autoliquidación complementaria): el fichero no lleva el justificante de la declaración anterior. Presenta la complementaria directamente en la sede.");
  const resultCents = totalCents - previousCents;
  const type = input.declarationType ?? (resultCents > 0 ? "I" : "N");
  if (type === "N" && resultCents > 0) problems.push("El tipo de declaración «N» (negativa) no corresponde a un resultado a ingresar.");
  if (type !== "N" && resultCents <= 0) problems.push(`El tipo de declaración «${type}» no corresponde a un resultado sin ingreso: usa «N».`);
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
  slots.forEach(({ slot, totals }, index) => {
    const start = 109 + index * 42;
    fields.push(
      { pos: start, len: 8, value: numeric(totals.recipients, 8, "número de perceptores"), name: `perceptores ${slot.boxes}` },
      { pos: start + 8, len: 17, value: amountUnsigned(totals.baseCents, 17, "importe de las percepciones"), name: `percepciones ${slot.boxes}` },
      { pos: start + 25, len: 17, value: amountUnsigned(totals.withheldCents, 17, "importe de las retenciones"), name: `retenciones ${slot.boxes}` },
    );
  });
  fields.push(
    { pos: 487, len: 17, value: amountUnsigned(totalCents, 17), name: "[28] suma de retenciones" },
    { pos: 504, len: 17, value: amountSignedN(0, 17), name: "[29] resultado de anteriores declaraciones" },
    { pos: 521, len: 17, value: amountUnsigned(resultCents, 17), name: "[30] resultado a ingresar" },
    { pos: 553, len: 34, value: alpha(type === "U" ? input.iban : "", 34), name: "IBAN" },
    { pos: 989, len: 12, value: "</T11101000>" },
  );
  const page = buildRecord(MODELO_111_PAGE_LENGTH, fields);

  const warnings: string[] = [];
  if (!input.blocks) warnings.push("El fichero solo lleva las retenciones a profesionales de las facturas recibidas. Si pagas nóminas u otros rendimientos con retención, añádelos en la sede antes de presentar.");
  if (name.needsReview) warnings.push("Comprueba en la sede que los apellidos y el nombre del declarante quedan en su casilla (no se han podido separar).");
  return fiscalFile(`111-${input.period.year}-${input.period.code}.txt`, wrapSelfAssessment("111", input.period, [page]), warnings);
}
