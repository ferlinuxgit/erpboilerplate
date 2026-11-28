import {
  alpha, amountSignedN, amountUnsigned, blanks, buildRecord, declarantProblems, fiscalFile, FiscalFileError, normalizeSpanishNif, numeric,
  splitDeclarantName, wrapSelfAssessment, type Declarant, type FiscalFile, type RecordField,
} from "@/server/fiscal-files/fields";
import { MODELO_303_ACTIVITY_CODES } from "@/server/fiscal-files/models";

/**
 * Modelo 390 (declaración-resumen anual del IVA): fichero para importar en el formulario de la
 * sede. Diseño de registro oficial «dr390e2026.xlsx», versión 1.00 (ejercicio 2026):
 * https://sede.agenciatributaria.gob.es/static_files/Sede/Disenyo_registro/DR_300_399/archivos_26/dr390e2026.xlsx
 *
 * Páginas que se generan (todas sin indicador de página complementaria):
 * - 01 (1188): identificación, datos estadísticos de la actividad principal (A, B, C y D) y marcas
 *   del criterio de caja. Sin representante (no obligatorio en el diseño) ni declaración conjunta.
 * - 02 (1806), 02B (531), 03 (1840) y 04 (854): apartado 5, régimen general (IVA devengado,
 *   recargo de equivalencia, IVA deducible y resultado 65).
 * - 06 (862): apartados 7 (resultado de la liquidación anual), 9 (resultado de las liquidaciones:
 *   95, 97 o 98 y 662) y 10 (volumen de operaciones). El apartado 8 (tributación por territorios)
 *   va a cero: según las instrucciones solo lo rellenan quienes tributan a varias Administraciones,
 *   y el programa solo calcula territorio común.
 * - 07 (781): apartado 11 (criterio de caja, 654 a 657) y apartado 12 (prorrata general), solo si
 *   tienen contenido.
 * No se generan la 05 (régimen simplificado) ni la 08 (sectores diferenciados): el programa no
 * calcula esos datos.
 */

export const MODELO_390_FIRST_YEAR = 2026;
export const MODELO_390_PAGE_LENGTHS = { page1: 1188, page2: 1806, page2b: 531, page3: 1840, page4: 854, page6: 862, page7: 781 } as const;

type Slot = [pos: number, box: string];

/** Casillas de importe (17 posiciones, con signo «N») de las páginas 02, 02B, 03 y 04, por posición. */
const PAGE2: Slot[] = [
  [13, "700"], [30, "701"], [47, "667"], [64, "668"], [81, "01"], [98, "02"], [115, "702"], [132, "703"], [149, "669"], [166, "670"],
  [183, "03"], [200, "04"], [217, "05"], [234, "06"], [251, "704"], [268, "705"], [285, "671"], [302, "672"], [319, "500"], [336, "501"],
  [353, "706"], [370, "707"], [387, "673"], [404, "674"], [421, "502"], [438, "503"], [455, "504"], [472, "505"], [489, "708"], [506, "709"],
  [523, "675"], [540, "676"], [557, "643"], [574, "644"], [591, "710"], [608, "711"], [625, "677"], [642, "678"], [659, "645"], [676, "646"],
  [693, "647"], [710, "648"], [727, "712"], [744, "713"], [761, "679"], [778, "680"], [795, "07"], [812, "08"], [829, "714"], [846, "715"],
  [863, "681"], [880, "682"], [897, "09"], [914, "10"], [931, "11"], [948, "12"], [965, "13"], [982, "14"], [999, "716"], [1016, "717"],
  [1033, "683"], [1050, "684"], [1067, "21"], [1084, "22"], [1101, "718"], [1118, "719"], [1135, "685"], [1152, "686"], [1169, "23"], [1186, "24"],
  [1203, "25"], [1220, "26"], [1237, "720"], [1254, "721"], [1271, "687"], [1288, "688"], [1305, "545"], [1322, "546"], [1339, "722"], [1356, "723"],
  [1373, "689"], [1390, "690"], [1407, "547"], [1424, "548"], [1441, "551"], [1458, "552"], [1475, "27"], [1492, "28"], [1509, "29"], [1526, "30"],
  [1543, "649"], [1560, "650"], [1577, "31"], [1594, "32"], [1611, "33"], [1628, "34"],
];
const PAGE2B: Slot[] = [
  [13, "663"], [30, "664"], [47, "691"], [64, "692"], [81, "35"], [98, "36"], [115, "665"], [132, "666"], [149, "693"], [166, "694"],
  [183, "599"], [200, "600"], [217, "601"], [234, "602"], [251, "41"], [268, "42"], [285, "43"], [302, "44"], [319, "45"], [336, "46"], [353, "47"],
];
const PAGE3: Slot[] = [
  [13, "695"], [30, "696"], [47, "190"], [64, "191"], [81, "724"], [98, "725"], [115, "697"], [132, "698"], [149, "603"], [166, "604"],
  [183, "605"], [200, "606"], [217, "48"], [234, "49"], [251, "745"], [268, "746"], [285, "506"], [302, "507"], [319, "726"], [336, "727"],
  [353, "747"], [370, "748"], [387, "607"], [404, "608"], [421, "609"], [438, "610"], [455, "512"], [472, "513"], [489, "749"], [506, "750"],
  [523, "196"], [540, "197"], [557, "728"], [574, "729"], [591, "751"], [608, "752"], [625, "611"], [642, "612"], [659, "613"], [676, "614"],
  [693, "50"], [710, "51"], [727, "753"], [744, "754"], [761, "514"], [778, "515"], [795, "730"], [812, "731"], [829, "755"], [846, "756"],
  [863, "615"], [880, "616"], [897, "617"], [914, "618"], [931, "520"], [948, "521"], [965, "757"], [982, "758"], [999, "202"], [1016, "203"],
  [1033, "732"], [1050, "733"], [1067, "759"], [1084, "760"], [1101, "619"], [1118, "620"], [1135, "621"], [1152, "622"], [1169, "52"], [1186, "53"],
  [1203, "761"], [1220, "762"], [1237, "208"], [1254, "209"], [1271, "734"], [1288, "735"], [1305, "763"], [1322, "764"], [1339, "623"], [1356, "624"],
  [1373, "625"], [1390, "626"], [1407, "54"], [1424, "55"], [1441, "765"], [1458, "766"], [1475, "214"], [1492, "215"], [1509, "736"], [1526, "737"],
  [1543, "767"], [1560, "768"], [1577, "627"], [1594, "628"], [1611, "629"], [1628, "630"], [1645, "56"], [1662, "57"],
];
const PAGE4: Slot[] = [
  [13, "769"], [30, "770"], [47, "220"], [64, "221"], [81, "738"], [98, "739"], [115, "771"], [132, "772"], [149, "631"], [166, "632"],
  [183, "633"], [200, "634"], [217, "58"], [234, "59"], [251, "773"], [268, "774"], [285, "587"], [302, "588"], [319, "740"], [336, "741"],
  [353, "775"], [370, "776"], [387, "635"], [404, "636"], [421, "637"], [438, "638"], [455, "597"], [472, "598"], [489, "60"], [506, "61"],
  [523, "660"], [540, "661"], [557, "639"], [574, "62"], [591, "651"], [608, "652"], [625, "63"], [642, "522"], [659, "64"], [676, "65"],
];

/** Página 06: apartado 7 (resultado de la liquidación anual). Las sin signo («Num») van marcadas. */
const PAGE6_RESULT: Array<[number, string, boolean]> = [[13, "658", true], [30, "84", true], [47, "659", false], [64, "85", false], [81, "112", false], [98, "86", true]];
/** Página 06: apartado 9 (resultado de las liquidaciones), todas sin signo. */
const PAGE6_SETTLEMENTS: Slot[] = [[259, "95"], [276, "96"], [293, "524"], [310, "97"], [327, "98"], [344, "662"], [361, "525"], [378, "526"]];
/** Página 06: apartado 10 (volumen de operaciones), con signo. */
const PAGE6_VOLUME: Slot[] = [
  [395, "99"], [412, "653"], [429, "103"], [446, "104"], [463, "105"], [480, "110"], [497, "125"], [514, "126"], [531, "127"], [548, "128"],
  [565, "100"], [582, "101"], [599, "102"], [616, "227"], [633, "228"], [650, "106"], [667, "107"], [684, "108"],
];
/** Página 07: apartado 11 (operaciones específicas), con signo. */
const PAGE7_SPECIFIC: Slot[] = [[13, "230"], [30, "109"], [47, "231"], [64, "232"], [81, "111"], [98, "113"], [115, "523"], [132, "654"], [149, "655"], [166, "656"], [183, "657"]];

/** Casillas que el diseño obliga a dejar a cero (tipos del 0 %, 2 %, 5 % y 7,5 %, sin vigencia). */
const MUST_BE_ZERO = new Set([
  "700", "701", "667", "668", "702", "703", "669", "670", "704", "705", "671", "672", "706", "707", "673", "674", "708", "709", "675", "676",
  "710", "711", "677", "678", "712", "713", "679", "680", "714", "715", "681", "682", "716", "717", "683", "684", "718", "719", "685", "686",
  "720", "721", "687", "688", "722", "723", "689", "690",
]);
/** Casillas de la prorrata (página 07): se colocan aparte, junto con el CNAE y el porcentaje. */
const PRORRATA_BOXES = new Set(["115", "116"]);
const VOLUME_PARTS = ["99", "653", "103", "104", "105", "110", "125", "126", "127", "128", "100", "101", "102", "227", "228"];
const VOLUME_MINUS = ["106", "107"];

const KNOWN = new Set<string>([
  ...[PAGE2, PAGE2B, PAGE3, PAGE4, PAGE6_SETTLEMENTS, PAGE6_VOLUME, PAGE7_SPECIFIC].flatMap((slots) => slots.map(([, box]) => box)),
  ...PAGE6_RESULT.map(([, box]) => box),
  ...PRORRATA_BOXES,
]);

export type Modelo390Input = {
  declarant: Declarant;
  year: number;
  /** Importe en céntimos por casilla del resumen anual (numeración oficial del 390). */
  boxes: Record<string, number>;
  /** Datos estadísticos de la actividad principal (apartado 3: A descripción, B código, C epígrafe del IAE). */
  activity: { description: string | null | undefined; code: string | null | undefined; iaeCode?: string | null };
  /** D: ha hecho operaciones por las que debe presentar el 347. */
  has347Operations?: boolean;
  /**
   * Qué se hizo con el resultado negativo del último 303 del año: «compensar» → casilla 97;
   * «devolver» → casilla 98. Obligatorio si hay importe en la 97 del resumen.
   */
  lastPeriodResult?: "compensar" | "devolver" | null;
  /** Marcas del criterio de caja (página 01, posiciones 131 y 132). */
  cashAccounting?: { ownRegime: boolean; recipient: boolean } | null;
  /** Prorrata general del año (apartado 12): CNAE-2025 y porcentaje definitivo. */
  prorrata?: { cnae: string | null | undefined; activityDescription?: string | null; pct: number } | null;
};

export function buildModelo390File(input: Modelo390Input): FiscalFile {
  const { year } = input;
  const problems = declarantProblems(input.declarant);
  if (year < MODELO_390_FIRST_YEAR) problems.push(`El fichero se genera con el diseño de registro del 390 de ${MODELO_390_FIRST_YEAR} en adelante; para ejercicios anteriores presenta el modelo directamente en la sede.`);

  const boxes = new Map<string, number>();
  for (const [box, cents] of Object.entries(input.boxes)) {
    const value = Math.round(cents);
    if (box === "REV") {
      if (value !== 0) problems.push("Hay IVA a un tipo que no tiene casilla en el 390 vigente (aparece como «Revisar» en el resumen). Corrige esas facturas o presenta el modelo a mano en la sede.");
      continue;
    }
    if (!box) continue;
    if (!KNOWN.has(box)) {
      if (value !== 0) problems.push(`La casilla ${box} no existe en el diseño de registro del 390 de ${MODELO_390_FIRST_YEAR}.`);
      continue;
    }
    boxes.set(box, (boxes.get(box) ?? 0) + value);
  }
  const get = (box: string) => boxes.get(box) ?? 0;
  for (const box of MUST_BE_ZERO) if (get(box) !== 0) problems.push(`La casilla ${box} corresponde a un tipo sin vigencia y el diseño obliga a dejarla a cero.`);

  // Cuadres de las fórmulas de las instrucciones del 390: si no cuadran, el fichero no se genera.
  if (!boxes.has("84")) problems.push("Al resumen le faltan los resultados del ejercicio (casillas 84 a 98): vuelve a abrir el modelo para recalcularlo.");
  if (get("47") - get("64") !== get("65")) problems.push("La casilla 65 no es la 47 menos la 64. Revisa el resumen antes de generar el fichero.");
  if (get("65") + get("658") !== get("84")) problems.push("La casilla 84 no es la suma de la 65 y la 658. Revisa el resumen antes de generar el fichero.");
  if (get("84") + get("659") - get("85") !== get("86")) problems.push("La casilla 86 no es 84 + 659 − 85. Revisa el resumen antes de generar el fichero.");
  const volume = VOLUME_PARTS.reduce((total, box) => total + get(box), 0) - VOLUME_MINUS.reduce((total, box) => total + get(box), 0);
  if (volume !== get("108")) problems.push("El total del volumen de operaciones (casilla 108) no coincide con la suma de sus casillas. Revisa el resumen antes de generar el fichero.");

  // 97 o 98: el resumen deja el resultado negativo del último periodo en la 97; si se pidió la devolución va en la 98.
  const lastResult = get("97") + get("98");
  if (lastResult !== 0 && !input.lastPeriodResult) problems.push("El último 303 del año salió negativo: indica al descargar si lo dejaste a compensar (casilla 97) o pediste la devolución (casilla 98).");
  if (input.lastPeriodResult === "devolver") {
    boxes.set("98", lastResult);
    boxes.set("97", 0);
  } else if (input.lastPeriodResult === "compensar") {
    boxes.set("97", lastResult);
    boxes.set("98", 0);
  }

  const activityCode = (input.activity.code ?? "").trim().toUpperCase();
  const iaeCode = (input.activity.iaeCode ?? "").replace(/[.\s]/g, "");
  const description = input.activity.description ?? "";
  if (!alpha(description, 40).trim()) problems.push("Indica al descargar la descripción de la actividad principal (apartado 3.A del 390).");
  if (!(MODELO_303_ACTIVITY_CODES as readonly string[]).includes(activityCode)) problems.push(`Indica al descargar el código de la actividad principal (${MODELO_303_ACTIVITY_CODES.join(", ")}), como figura en las instrucciones del 390.`);
  if (iaeCode && !/^[0-9]{1,4}$/.test(iaeCode)) problems.push("El epígrafe del IAE son hasta cuatro dígitos (por ejemplo, 8499).");
  if (!iaeCode && activityCode && !["B06", "C"].includes(activityCode)) problems.push("Indica al descargar el epígrafe del IAE de la actividad principal.");

  const hasProrrata = get("115") !== 0 || get("116") !== 0;
  const prorrata = hasProrrata ? input.prorrata ?? null : null;
  const cnae = (prorrata?.cnae ?? "").trim();
  if (hasProrrata) {
    if (!prorrata) problems.push("Aplicas prorrata y no está confirmado el porcentaje definitivo del año: confírmalo en el modelo antes de generar el fichero.");
    else {
      if (!/^[0-9]{4}$/.test(cnae)) problems.push("Aplicas prorrata: indica al descargar el código CNAE-2025 de la actividad (cuatro dígitos, casilla 114).");
      if (!(prorrata.pct >= 0 && prorrata.pct <= 100)) problems.push("El porcentaje de prorrata tiene que estar entre 0 y 100.");
    }
  }
  if (problems.length > 0) throw new FiscalFileError(problems);

  const name = splitDeclarantName(input.declarant);
  const yesNo = (value: boolean) => (value ? "1" : "2");
  const signed = (box: string): string => amountSignedN(get(box), 17, `casilla ${box}`);
  const unsigned = (box: string): string => amountUnsigned(get(box), 17, `casilla ${box}`);
  const slots = (list: Slot[], format: (box: string) => string = signed): RecordField[] => list.map(([pos, box]) => ({ pos, len: 17, value: format(box), name: `[${box}]` }));
  const page = (code: string, length: number, fields: RecordField[]) => buildRecord(length, [
    { pos: 1, len: 2, value: "<T" },
    { pos: 3, len: 3, value: "390" },
    { pos: 6, len: 5, value: code },
    { pos: 11, len: 1, value: ">" },
    { pos: length - 11, len: 12, value: `</T390${code}>` },
    ...fields,
  ]);

  const cash = input.cashAccounting;
  const pages = [
    page("01000", MODELO_390_PAGE_LENGTHS.page1, [
      { pos: 14, len: 9, value: alpha(normalizeSpanishNif(input.declarant.taxId), 9), name: "NIF" },
      { pos: 23, len: 60, value: alpha(name.surname, 60), name: "apellidos o razón social" },
      { pos: 83, len: 20, value: alpha(name.firstName, 20), name: "nombre" },
      { pos: 103, len: 4, value: numeric(year, 4) },
      { pos: 109, len: 1, value: "0", name: "registro de devolución mensual" },
      { pos: 110, len: 1, value: "0", name: "régimen especial del grupo de entidades" },
      { pos: 118, len: 1, value: "0", name: "entidad dominante" },
      { pos: 119, len: 1, value: "0", name: "entidad dependiente" },
      { pos: 120, len: 1, value: "0", name: "tipo de régimen del grupo" },
      { pos: 130, len: 1, value: "2", name: "concurso de acreedores" },
      { pos: 131, len: 1, value: yesNo(cash?.ownRegime ?? false), name: "régimen especial del criterio de caja" },
      { pos: 132, len: 1, value: yesNo(cash?.recipient ?? false), name: "destinatario del criterio de caja" },
      { pos: 133, len: 1, value: "2", name: "pago a cuenta de carburantes" },
      { pos: 134, len: 1, value: "0", name: "sustitutiva" },
      { pos: 135, len: 1, value: "0", name: "sustitutiva por rectificación de cuotas" },
      { pos: 136, len: 13, value: blanks(13), name: "justificante anterior" },
      { pos: 149, len: 40, value: alpha(description, 40), name: "actividad principal" },
      { pos: 189, len: 3, value: alpha(activityCode, 3), name: "código de actividad" },
      { pos: 192, len: 4, value: alpha(iaeCode, 4), name: "epígrafe IAE" },
      { pos: 431, len: 1, value: input.has347Operations ? "1" : "0", name: "operaciones con terceras personas" },
    ]),
    page("02000", MODELO_390_PAGE_LENGTHS.page2, slots(PAGE2)),
    page("02B00", MODELO_390_PAGE_LENGTHS.page2b, slots(PAGE2B)),
    page("03000", MODELO_390_PAGE_LENGTHS.page3, slots(PAGE3)),
    page("04000", MODELO_390_PAGE_LENGTHS.page4, slots(PAGE4)),
    page("06000", MODELO_390_PAGE_LENGTHS.page6, [
      ...PAGE6_RESULT.map(([pos, box, isSigned]): RecordField => ({ pos, len: 17, value: isSigned ? signed(box) : unsigned(box), name: `[${box}]` })),
      // Apartado 8 (115-258): porcentajes e importes a cero; solo para quien tributa a varias Administraciones.
      { pos: 115, len: 25, value: numeric(0, 25), name: "[87] a [91]" },
      { pos: 140, len: 119, value: numeric(0, 119), name: "apartado 8" },
      ...slots(PAGE6_SETTLEMENTS, unsigned),
      ...slots(PAGE6_VOLUME),
    ]),
  ];

  const hasSpecific = PAGE7_SPECIFIC.some(([, box]) => get(box) !== 0);
  if (hasSpecific || prorrata) {
    const fields: RecordField[] = [...slots(PAGE7_SPECIFIC)];
    if (prorrata) {
      fields.push(
        { pos: 200, len: 40, value: alpha(prorrata.activityDescription ?? description, 40), name: "actividad de la prorrata" },
        { pos: 240, len: 4, value: cnae, name: "[114]" },
        { pos: 244, len: 17, value: unsigned("115"), name: "[115]" },
        { pos: 261, len: 17, value: unsigned("116"), name: "[116]" },
        { pos: 278, len: 1, value: "G", name: "[117]" },
        { pos: 279, len: 5, value: numeric(Math.round(prorrata.pct * 100), 5, "porcentaje de prorrata"), name: "[118]" },
      );
    }
    // Prorratas 2.ª a 5.ª: importes y porcentaje a cero (actividad, CNAE y tipo en blanco).
    for (let block = 1; block < 5; block += 1) {
      const start = 200 + block * 84;
      fields.push(
        { pos: start + 44, len: 34, value: numeric(0, 34) },
        { pos: start + 79, len: 5, value: numeric(0, 5) },
      );
    }
    if (!prorrata) fields.push({ pos: 244, len: 34, value: numeric(0, 34) }, { pos: 279, len: 5, value: numeric(0, 5) });
    pages.push(page("07000", MODELO_390_PAGE_LENGTHS.page7, fields));
  }

  const warnings = [
    "El fichero lleva la identificación sin representante, sin régimen de grupo de entidades y sin concurso de acreedores, y solo la actividad principal: complétalo en la sede si te afecta.",
    "Comprueba antes de presentar que la casilla 95 (suma de lo ingresado en los 303) y la 97 o la 98 coinciden con tus 303 presentados: la AEAT cruza esos importes.",
  ];
  if (name.needsReview) warnings.push("Comprueba en la sede que los apellidos y el nombre del declarante quedan en su casilla (no se han podido separar).");
  return fiscalFile(`390-${year}.txt`, wrapSelfAssessment("390", { year, code: "0A", isLastOfYear: true, isMonthly: false }, pages), warnings);
}
