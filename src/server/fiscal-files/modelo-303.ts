import {
  alpha, amountSignedN, amountUnsigned, buildRecord, declarantProblems, fiscalFile, FiscalFileError, normalizeSpanishNif, numeric,
  wrapSelfAssessment, type Declarant, type FilePeriod, type FiscalFile, type RecordField,
} from "@/server/fiscal-files/fields";

/**
 * Modelo 303 (autoliquidación del IVA): fichero para importar en el formulario de la sede.
 * Diseño de registro oficial «DR303e26v101.xlsx», versión 1.01, «Ejercicio 2026 y siguientes»
 * (actualizado el 28/01/2026):
 * https://sede.agenciatributaria.gob.es/static_files/Sede/Disenyo_registro/DR_300_399/archivos_26/DR303e26v101.xlsx
 *
 * Páginas que se generan:
 * - 01 (1581 posiciones): identificación y régimen general (casillas 01 a 46).
 * - 03 (1017 posiciones): información adicional y resultado (59 a 71).
 * - DID (823 posiciones): cuenta de domiciliación o devolución.
 * No se generan la 02 (régimen simplificado), la 04 (volumen de operaciones de los exonerados del
 * 390) ni la 05 (prorratas y sectores diferenciados): el programa no calcula esos datos y, según el
 * diseño, una página sin contenido no debe incluirse.
 */

export const MODELO_303_FIRST_YEAR = 2026;
export const MODELO_303_PAGE_LENGTHS = { page1: 1581, page3: 1017, did: 823 } as const;

type BoxLayout = { box: string; pos: number; signed?: boolean };

/** Grupos «base (17) + tipo (5, constante) + cuota (17)» de la página 1. */
const RATE_GROUPS: Array<{ pos: number; base: string; tax: string; rate: string }> = [
  { pos: 131, base: "150", tax: "152", rate: "00000" },
  { pos: 170, base: "165", tax: "167", rate: "00000" },
  { pos: 209, base: "01", tax: "03", rate: "00400" },
  { pos: 248, base: "153", tax: "155", rate: "00000" },
  { pos: 287, base: "04", tax: "06", rate: "01000" },
  { pos: 326, base: "07", tax: "09", rate: "02100" },
  { pos: 467, base: "156", tax: "158", rate: "00175" },
  { pos: 506, base: "168", tax: "170", rate: "00050" },
  { pos: 545, base: "16", tax: "18", rate: "00000" },
  { pos: 584, base: "19", tax: "21", rate: "00140" },
  { pos: 623, base: "22", tax: "24", rate: "00520" },
];

/** Resto de casillas de importe de la página 1 (17 posiciones cada una). */
const PAGE1_BOXES: BoxLayout[] = [
  { box: "10", pos: 365 }, { box: "11", pos: 382 }, { box: "12", pos: 399 }, { box: "13", pos: 416 },
  { box: "14", pos: 433, signed: true }, { box: "15", pos: 450, signed: true },
  { box: "25", pos: 662, signed: true }, { box: "26", pos: 679, signed: true }, { box: "27", pos: 696, signed: true },
  { box: "28", pos: 713 }, { box: "29", pos: 730 }, { box: "30", pos: 747 }, { box: "31", pos: 764 },
  { box: "32", pos: 781 }, { box: "33", pos: 798 }, { box: "34", pos: 815 }, { box: "35", pos: 832 },
  { box: "36", pos: 849 }, { box: "37", pos: 866 }, { box: "38", pos: 883 }, { box: "39", pos: 900 },
  { box: "40", pos: 917, signed: true }, { box: "41", pos: 934, signed: true }, { box: "42", pos: 951, signed: true },
  { box: "43", pos: 968, signed: true }, { box: "44", pos: 985, signed: true }, { box: "45", pos: 1002, signed: true },
  { box: "46", pos: 1019, signed: true },
];

/** Casillas de importe de la página 3 (17 posiciones cada una; la 65 es un porcentaje y va aparte). */
const PAGE3_BOXES: BoxLayout[] = [
  { box: "59", pos: 12, signed: true }, { box: "60", pos: 29, signed: true }, { box: "120", pos: 46, signed: true },
  { box: "122", pos: 63, signed: true }, { box: "123", pos: 80, signed: true }, { box: "124", pos: 97, signed: true },
  { box: "62", pos: 114, signed: true }, { box: "63", pos: 131, signed: true }, { box: "74", pos: 148, signed: true },
  { box: "75", pos: 165, signed: true }, { box: "76", pos: 182, signed: true }, { box: "64", pos: 199, signed: true },
  { box: "66", pos: 221, signed: true }, { box: "77", pos: 238 }, { box: "110", pos: 255 }, { box: "78", pos: 272 },
  { box: "87", pos: 289 }, { box: "68", pos: 306, signed: true }, { box: "108", pos: 323, signed: true },
  { box: "69", pos: 340, signed: true }, { box: "70", pos: 357 }, { box: "109", pos: 374 }, { box: "112", pos: 391 },
  { box: "71", pos: 408, signed: true }, { box: "111", pos: 441 },
];

/** Cuotas que suman la casilla 27 y la 45 según el propio diseño. */
const ACCRUED_TAX_BOXES = ["152", "167", "03", "155", "06", "09", "11", "13", "15", "158", "170", "18", "21", "24", "26"];
const DEDUCTIBLE_TAX_BOXES = ["29", "31", "33", "35", "37", "39", "41", "42", "43", "44"];

/**
 * Casillas que el programa calcula como información pero que no viajan en este fichero: el volumen
 * de operaciones (página 04, solo para exonerados del 390) y las filas sin casilla oficial.
 */
const IGNORED_BOXES = new Set(["80", "93", "94", "83", "84", "125", "88", "EXE", ""]);

export type Modelo303Input = {
  declarant: Declarant;
  period: FilePeriod;
  /** Importe en céntimos por número de casilla; las que falten van a cero. */
  boxes: Record<string, number>;
  /** Régimen especial del criterio de caja (casilla de identificación). */
  cashAccounting?: boolean;
  /** Inscrito en el registro de devolución mensual (REDEME). */
  monthlyRefundRegister?: boolean;
  /** Sin operaciones en el periodo: marca «sin actividad». */
  noActivity?: boolean;
  /**
   * C compensación, D devolución, G/V cuenta corriente tributaria, I ingreso, N resultado cero,
   * U domiciliación del ingreso, X devolución por transferencia al extranjero.
   * Por defecto: I si sale a ingresar, C si sale a compensar y N si es cero.
   */
  declarationType?: "C" | "D" | "G" | "I" | "N" | "V" | "U" | "X";
  /** IBAN de la domiciliación (U) o de la devolución (D). */
  iban?: string | null;
};

const TYPES_BY_RESULT = { positive: ["I", "U", "G"], negative: ["C", "D", "V", "X"], zero: ["N"] } as const;

export function buildModelo303File(input: Modelo303Input): FiscalFile {
  const { period } = input;
  const problems = declarantProblems(input.declarant);
  if (period.code === "0A") problems.push("El modelo 303 es trimestral o mensual: el periodo no es válido.");
  if (period.year < MODELO_303_FIRST_YEAR) problems.push(`El fichero se genera con el diseño de registro del 303 de ${MODELO_303_FIRST_YEAR} en adelante; para ejercicios anteriores presenta el modelo directamente en la sede.`);

  const boxes = new Map<string, number>();
  const known = new Set<string>([...RATE_GROUPS.flatMap((group) => [group.base, group.tax]), ...PAGE1_BOXES.map((entry) => entry.box), ...PAGE3_BOXES.map((entry) => entry.box)]);
  for (const [box, cents] of Object.entries(input.boxes)) {
    if (IGNORED_BOXES.has(box)) continue;
    if (!known.has(box)) {
      if (Math.round(cents) !== 0) problems.push(box === "REV"
        ? "Hay IVA o recargo a un tipo que no tiene casilla en el 303 vigente (aparece como «Revisar» en el modelo). Corrige esas facturas o presenta el modelo a mano en la sede."
        : `La casilla ${box} no existe en el diseño de registro del 303 de ${MODELO_303_FIRST_YEAR}.`);
      continue;
    }
    boxes.set(box, Math.round(cents));
  }
  const get = (box: string) => boxes.get(box) ?? 0;
  const sum = (list: string[]) => list.reduce((total, box) => total + get(box), 0);

  // Cuadre con las fórmulas que el propio diseño indica: si no cuadra, la sede rechazaría el fichero.
  if (sum(ACCRUED_TAX_BOXES) !== get("27")) problems.push("La casilla 27 (total de cuotas devengadas) no coincide con la suma de sus casillas. Revisa el modelo antes de generar el fichero.");
  if (sum(DEDUCTIBLE_TAX_BOXES) !== get("45")) problems.push("La casilla 45 (total a deducir) no coincide con la suma de sus casillas. Revisa el modelo antes de generar el fichero.");
  if (get("27") - get("45") !== get("46")) problems.push("La casilla 46 no es la 27 menos la 45. Revisa el modelo antes de generar el fichero.");
  if (!boxes.has("64")) boxes.set("64", get("46") + get("76"));
  if (!boxes.has("66")) boxes.set("66", get("64"));
  if (get("64") !== get("46") + get("76")) problems.push("La casilla 64 (suma de resultados) no coincide con la 46.");
  if (!boxes.has("69")) boxes.set("69", get("66") + get("77") - get("78") + get("68") + get("108"));
  if (get("69") !== get("66") + get("77") - get("78") + get("68") + get("108")) problems.push("La casilla 69 no coincide con la 66 menos las cuotas compensadas (78).");
  if (!boxes.has("87")) boxes.set("87", get("110") - get("78"));
  if (get("87") !== get("110") - get("78")) problems.push("La casilla 87 no es la 110 menos la 78.");
  if (!boxes.has("71")) boxes.set("71", get("69") - get("70") + get("109") - get("112"));
  if (get("71") !== get("69") - get("70") + get("109") - get("112")) problems.push("La casilla 71 (resultado) no coincide con la 69.");
  for (const entry of [...PAGE1_BOXES, ...PAGE3_BOXES]) {
    if (!entry.signed && get(entry.box) < 0) problems.push(`La casilla ${entry.box} sale negativa y el diseño de la AEAT no admite signo en ella. Revisa las facturas rectificativas del periodo.`);
  }
  for (const group of RATE_GROUPS) {
    if (get(group.base) < 0 || get(group.tax) < 0) problems.push(`Las casillas ${group.base}-${group.tax} salen negativas y el diseño de la AEAT no admite signo en ellas. Revisa las facturas rectificativas del periodo.`);
  }
  if (input.cashAccounting) problems.push("La empresa está en el régimen especial del criterio de caja y el programa todavía no calcula el 303 por cobros y pagos: no se puede generar el fichero.");

  const result = get("71");
  const allowed: readonly string[] = result > 0 ? TYPES_BY_RESULT.positive : result < 0 ? TYPES_BY_RESULT.negative : TYPES_BY_RESULT.zero;
  const type = input.declarationType ?? allowed[0];
  if (!allowed.includes(type)) problems.push(`El tipo de declaración «${type}» no corresponde a un resultado ${result > 0 ? "a ingresar" : result < 0 ? "negativo" : "cero"}.`);
  if (type === "D" && !period.isLastOfYear && !input.monthlyRefundRegister) problems.push("La devolución solo se puede pedir en el último periodo del año (o estando en el registro de devolución mensual). En el resto, el saldo se deja a compensar.");
  const needsIban = type === "U" || type === "D";
  const iban = (input.iban ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (needsIban && !iban) problems.push("Hace falta el IBAN de la cuenta para domiciliar el pago o pedir la devolución.");
  if (problems.length > 0) throw new FiscalFileError(problems);

  const last = period.isLastOfYear;
  const yesNo = (value: boolean | undefined) => (value ? "1" : "2");
  const page1: RecordField[] = [
    { pos: 1, len: 2, value: "<T" },
    { pos: 3, len: 3, value: "303" },
    { pos: 6, len: 5, value: "01000" },
    { pos: 11, len: 1, value: ">" },
    { pos: 13, len: 1, value: type, name: "tipo de declaración" },
    { pos: 14, len: 9, value: alpha(normalizeSpanishNif(input.declarant.taxId), 9), name: "NIF" },
    { pos: 23, len: 80, value: alpha(input.declarant.name, 80), name: "razón social" },
    { pos: 103, len: 4, value: numeric(period.year, 4) },
    { pos: 107, len: 2, value: period.code },
    { pos: 109, len: 1, value: "2", name: "tributación exclusivamente foral" },
    { pos: 110, len: 1, value: yesNo(input.monthlyRefundRegister), name: "registro de devolución mensual" },
    // «3»: no tributa en régimen simplificado (solo régimen general).
    { pos: 111, len: 1, value: "3", name: "régimen simplificado" },
    { pos: 112, len: 1, value: "2", name: "autoliquidación conjunta" },
    { pos: 113, len: 1, value: yesNo(input.cashAccounting), name: "criterio de caja" },
    { pos: 114, len: 1, value: "2", name: "destinatario de operaciones en criterio de caja" },
    // Nota 6 del diseño: «2» = sin marcar (periodos intermedios) o NO (último periodo).
    { pos: 115, len: 1, value: "2", name: "opción prorrata especial" },
    { pos: 116, len: 1, value: "2", name: "revocación prorrata especial" },
    { pos: 117, len: 1, value: "2", name: "concurso de acreedores" },
    { pos: 127, len: 1, value: "2", name: "SII voluntario" },
    // Notas 3 y 4: «0» en los periodos intermedios; en el último, no exonerado del 390 («2») y,
    // por tanto, sin informar el volumen de operaciones en este modelo («0»).
    { pos: 128, len: 1, value: last ? "2" : "0", name: "exonerado del 390" },
    { pos: 129, len: 1, value: "0", name: "volumen anual de operaciones" },
    // Nota 8: «0» en los trimestres y en enero; en el resto de meses, «2» (sin pagos a cuenta de carburantes).
    { pos: 130, len: 1, value: period.isMonthly && period.code !== "01" ? "2" : "0", name: "pago a cuenta de carburantes" },
    { pos: 1570, len: 12, value: "</T30301000>" },
  ];
  for (const group of RATE_GROUPS) {
    page1.push(
      { pos: group.pos, len: 17, value: amountUnsigned(get(group.base), 17, `casilla ${group.base}`), name: `[${group.base}]` },
      { pos: group.pos + 17, len: 5, value: group.rate },
      { pos: group.pos + 22, len: 17, value: amountUnsigned(get(group.tax), 17, `casilla ${group.tax}`), name: `[${group.tax}]` },
    );
  }
  const amountField = (entry: BoxLayout): RecordField => ({
    pos: entry.pos,
    len: 17,
    value: entry.signed ? amountSignedN(get(entry.box), 17, `casilla ${entry.box}`) : amountUnsigned(get(entry.box), 17, `casilla ${entry.box}`),
    name: `[${entry.box}]`,
  });
  page1.push(...PAGE1_BOXES.map(amountField));

  const page3: RecordField[] = [
    { pos: 1, len: 2, value: "<T" },
    { pos: 3, len: 3, value: "303" },
    { pos: 6, len: 5, value: "03000" },
    { pos: 11, len: 1, value: ">" },
    // Casilla 65: 100,00 % atribuible a la Administración del Estado (sin tributación foral).
    { pos: 216, len: 5, value: "10000", name: "[65]" },
    { pos: 425, len: 1, value: input.noActivity ? "X" : " ", name: "sin actividad" },
    { pos: 1006, len: 12, value: "</T30303000>" },
    ...PAGE3_BOXES.map(amountField),
  ];

  const did: RecordField[] = [
    { pos: 1, len: 2, value: "<T" },
    { pos: 3, len: 3, value: "303" },
    { pos: 6, len: 5, value: "DID00" },
    { pos: 11, len: 1, value: ">" },
    { pos: 23, len: 34, value: alpha(needsIban ? iban : "", 34), name: "IBAN" },
    // Marca SEPA de la devolución: 0 vacía, 1 cuenta en España, 2 resto de la zona SEPA.
    { pos: 194, len: 1, value: type === "D" ? (iban.startsWith("ES") ? "1" : "2") : "0", name: "marca SEPA" },
    { pos: 812, len: 12, value: "</T303DID00>" },
  ];

  const text = wrapSelfAssessment("303", period, [
    buildRecord(MODELO_303_PAGE_LENGTHS.page1, page1),
    buildRecord(MODELO_303_PAGE_LENGTHS.page3, page3),
    buildRecord(MODELO_303_PAGE_LENGTHS.did, did),
  ]);

  const warnings = ["Las marcas de identificación (devolución mensual, prorrata especial, concurso, SII, tributación foral) van como «No»: cámbialas en la sede si alguna te aplica."];
  if (result < 0 && type === "C") warnings.push(last ? "El resultado negativo va «a compensar». Si prefieres pedir la devolución, cámbialo en la sede e indica tu cuenta." : "El resultado negativo va «a compensar» en los periodos siguientes.");
  if (last) warnings.push("En el último periodo del año la sede puede pedir datos que el programa no tiene (por ejemplo, la prorrata o las actividades): complétalos allí.");
  return fiscalFile(`303-${period.year}-${period.code}.txt`, text, warnings);
}
