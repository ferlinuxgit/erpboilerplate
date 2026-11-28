import type { Modelo190ExtraData } from "@/server/fiscal/withholdings";
import {
  amountUnsigned, amountWithSignField, blanks, buildRecord, declarantProblems, defaultDeclarationNumber, fiscalFile, FiscalFileError, hasSpanishNifShape,
  informativeDeclarantFields, informativeRecipientFields, listProblems, MISSING_PROVINCE_HELP, nifField, normalizeSpanishNif, numeric, resolveRecipientProvince,
  sanitizeText, type Declarant, type FiscalFile, type RecordField,
} from "@/server/fiscal-files/fields";

/**
 * Modelo 190 (resumen anual de retenciones e ingresos a cuenta del IRPF: trabajo, actividades
 * económicas, premios…): registros de 500 posiciones, uno de tipo 1 (declarante) y uno de tipo 2
 * por perceptor, clave y subclave. Diseños de registro oficiales «Modelo 190 (2025)», con las
 * modificaciones de la Orden HAC/1431/2025, de 3 de diciembre:
 * https://sede.agenciatributaria.gob.es/static_files/Sede/Disenyo_registro/DR_100_199/archivos_25/DISENOS_LOGICOS_190_2025.pdf
 *
 * Claves que genera el programa: A (empleados), E (consejeros y administradores), G
 * (profesionales) y L.05 (indemnizaciones por despido o cese exentas, art. 7.e LIRPF). De los
 * «datos adicionales» (153-254) de la clave A viajan el año de nacimiento, la situación familiar,
 * el NIF del cónyuge, la discapacidad, el contrato y los datos de la ficha del trabajador para el
 * ejercicio (`Modelo190ExtraData`): movilidad geográfica (170), reducciones (171-183), gastos
 * deducibles (184-196), pensiones compensatorias (197-209), anualidades por alimentos (210-222),
 * descendientes (223-240), ascendientes (241-250), cómputo de los tres primeros hijos (251-253) y
 * comunicación de préstamo de vivienda (254). Si la ficha no trae gastos deducibles, van las
 * cotizaciones a la Seguridad Social a cargo del trabajador de sus nóminas (art. 19.2.a LIRPF).
 * Según el diseño, en las claves E, G y L esos campos van a cero (salvo reducciones en E y G, que
 * el programa no calcula, y gastos deducibles en E.01 y E.02).
 * No se generan percepciones por incapacidad laboral, ni el reparto entre Administraciones de las
 * retenciones de la clave E (solo para quien ingresa en proporción al volumen de operaciones).
 */

export const MODELO_190_RECORD_LENGTH = 500;
export const MODELO_190_FIRST_YEAR = 2025;

/** Claves con subclave obligatoria (posiciones 79-80) entre las que genera el programa. */
const KEYS_WITH_SUBKEY = new Set(["E", "G", "L"]);
const SUPPORTED_KEYS = new Set(["A", "E", "G", "L"]);
/** Subclaves de la clave L que genera el programa. */
const L_SUBKEYS = new Set(["05"]);

/** Número de un recuento del diseño (descendientes, ascendientes), acotado a sus posiciones. */
function countField(value: number | undefined, length: number, label: string) {
  const count = Math.round(value ?? 0);
  if (count < 0 || count >= 10 ** length) throw new FiscalFileError([`El dato «${label}» de un empleado (${count}) no cabe en el diseño del 190.`]);
  return numeric(count, length, label);
}

/**
 * Datos adicionales 170 y 223-254 de la clave A (diseños lógicos del 190 de 2025): movilidad,
 * descendientes (223 y 224 de una posición; 225-240 de dos), ascendientes (241-250, una posición),
 * cómputo de los tres primeros hijos (1 por entero, 2 por mitad, 0 sin dato) y vivienda (254).
 */
function extraFamilyFields(extra: Modelo190ExtraData | null | undefined): RecordField[] {
  const pair = (pos: number, len: number, value: { total: number; whole: number } | undefined, label: string): RecordField[] => {
    if (value && value.whole > value.total) throw new FiscalFileError([`En «${label}» hay más computados por entero que en total.`]);
    return [
      { pos, len, value: countField(value?.total, len, `${label} (total)`), name: `${label} total` },
      { pos: pos + len, len, value: countField(value?.whole, len, `${label} (por entero)`), name: `${label} por entero` },
    ];
  };
  const children = extra?.firstThreeChildren ?? [0, 0, 0];
  return [
    { pos: 170, len: 1, value: extra?.geographicMobility ? "1" : "0", name: "movilidad geográfica" },
    ...pair(223, 1, extra?.descendantsUnder3, "descendientes menores de 3 años"),
    ...pair(225, 2, extra?.descendantsRest, "resto de descendientes"),
    ...pair(229, 2, extra?.descendantsDisability?.from33, "descendientes con discapacidad del 33 %"),
    ...pair(233, 2, extra?.descendantsDisability?.reducedMobility, "descendientes con movilidad reducida"),
    ...pair(237, 2, extra?.descendantsDisability?.from65, "descendientes con discapacidad del 65 %"),
    ...pair(241, 1, extra?.ascendantsUnder75, "ascendientes menores de 75 años"),
    ...pair(243, 1, extra?.ascendantsFrom75, "ascendientes de 75 o más años"),
    ...pair(245, 1, extra?.ascendantsDisability?.from33, "ascendientes con discapacidad del 33 %"),
    ...pair(247, 1, extra?.ascendantsDisability?.reducedMobility, "ascendientes con movilidad reducida"),
    ...pair(249, 1, extra?.ascendantsDisability?.from65, "ascendientes con discapacidad del 65 %"),
    ...children.map((value, index): RecordField => {
      if (![0, 1, 2].includes(value)) throw new FiscalFileError([`El cómputo del hijo ${index + 1}.º solo admite 1 (por entero) o 2 (por mitad).`]);
      return { pos: 251 + index, len: 1, value: String(value), name: `cómputo del hijo ${index + 1}` };
    }),
    { pos: 254, len: 1, value: extra?.housingLoanCommunication ? "1" : "0", name: "comunicación de préstamos para vivienda habitual" },
  ];
}

export type Modelo190FileRecipient = {
  taxId: string | null;
  name: string;
  /** Clave de percepción: A, E o G. */
  key: string;
  /** Subclave de dos dígitos (claves E y G). */
  subkey: string | null;
  /** Percepciones dinerarias: íntegro y retenciones practicadas. */
  cashCents: number;
  withheldCents: number;
  /** Percepciones en especie: valoración e ingresos a cuenta efectuados. */
  inKindCents: number;
  inKindWithheldCents: number;
  /**
   * Gastos deducibles (posiciones 184-196): cotizaciones a la Seguridad Social a cargo del
   * perceptor. Solo viaja en las claves A y E (subclaves 01 y 02), como indica el diseño.
   */
  deductibleExpensesCents?: number;
  /** Datos adicionales de la clave A (y, en `extra`, los del ejercicio de la ficha del trabajador). */
  personal?: { birthYear?: number | null; familySituation?: number | null; disability?: number | null; contractType?: number | null; spouseTaxId?: string | null; extra?: Modelo190ExtraData | null };
};

export type Modelo190Input = {
  declarant: Declarant;
  year: number;
  recipients: Modelo190FileRecipient[];
  /** Código postal de la ficha de tercero de cada perceptor, por NIF normalizado. */
  postalCodes?: Map<string, string | null>;
  /** Provincia (dos dígitos) de los perceptores sin ficha de tercero con código postal. */
  defaultProvince?: string | null;
  declarationNumber?: string;
};

export function buildModelo190File(input: Modelo190Input): FiscalFile {
  const { year } = input;
  const problems = declarantProblems(input.declarant);
  if (year < MODELO_190_FIRST_YEAR) problems.push(`El fichero se genera con el diseño del 190 del ejercicio ${MODELO_190_FIRST_YEAR} en adelante.`);
  if (input.recipients.length === 0) problems.push("No hay ningún perceptor con retenciones en el año: no hay nada que declarar en el 190.");
  const declarationNumber = input.declarationNumber ?? defaultDeclarationNumber("190", year);
  if (!/^190\d{10}$/.test(declarationNumber)) problems.push("El número identificativo de la declaración tiene que tener 13 dígitos y empezar por 190.");

  const withoutNif: string[] = [];
  const withoutProvince: string[] = [];
  const withoutPersonal: string[] = [];
  const negative: string[] = [];
  const badKey: string[] = [];
  const withheldExempt: string[] = [];
  const provinces: string[] = [];
  for (const recipient of input.recipients) {
    const label = sanitizeText(recipient.name) || "(sin nombre)";
    if (!hasSpanishNifShape(normalizeSpanishNif(recipient.taxId))) withoutNif.push(label);
    const province = resolveRecipientProvince(recipient.taxId, input.postalCodes, input.defaultProvince);
    if (!province) withoutProvince.push(label);
    provinces.push(province ?? "00");
    if (!SUPPORTED_KEYS.has(recipient.key) || (KEYS_WITH_SUBKEY.has(recipient.key) && !/^\d{2}$/.test(recipient.subkey ?? "")) || (recipient.key === "L" && !L_SUBKEYS.has(recipient.subkey ?? ""))) badKey.push(`${label} (clave ${recipient.key}${recipient.subkey ? `.${recipient.subkey}` : ""})`);
    if ([recipient.cashCents, recipient.withheldCents, recipient.inKindCents, recipient.inKindWithheldCents, recipient.deductibleExpensesCents ?? 0].some((cents) => cents < 0)) negative.push(label);
    // Rentas exentas: no llevan retención.
    if (recipient.key === "L" && (recipient.withheldCents !== 0 || recipient.inKindWithheldCents !== 0)) withheldExempt.push(label);
    if (recipient.key === "A") {
      const personal = recipient.personal;
      const birthYear = personal?.birthYear ?? 0;
      if (!(birthYear >= 1900 && birthYear <= year) || ![1, 2, 3].includes(personal?.familySituation ?? 0) || ![1, 2, 3, 4].includes(personal?.contractType ?? 0)) withoutPersonal.push(label);
    }
  }
  problems.push(
    ...listProblems("Estos perceptores no tienen un NIF español válido (el 190 solo admite contribuyentes del IRPF identificados):", withoutNif),
    ...listProblems(`Falta la provincia del domicilio de estos perceptores: ${MISSING_PROVINCE_HELP} Perceptores:`, withoutProvince),
    ...listProblems("Faltan el año de nacimiento, la situación familiar o el tipo de contrato de estos empleados (clave A); complétalos en su ficha de trabajador:", withoutPersonal),
    ...listProblems("Estos perceptores tienen percepciones o retenciones negativas en el año; el fichero no las admite sin indicar el ejercicio del reintegro, preséntalos a mano en la sede:", negative),
    ...listProblems("El programa no sabe generar el registro de estas claves o les falta la subclave:", badKey),
    ...listProblems("Estas indemnizaciones exentas (clave L.05) tienen retención; si están sujetas en parte, la parte sujeta va en la clave A. Revisa:", withheldExempt),
  );
  if (problems.length > 0) throw new FiscalFileError(problems);

  const totalIncome = input.recipients.reduce((sum, row) => sum + Math.round(row.cashCents) + Math.round(row.inKindCents), 0);
  const totalWithheld = input.recipients.reduce((sum, row) => sum + Math.round(row.withheldCents) + Math.round(row.inKindWithheldCents), 0);
  const zeros = (pos: number, len: number, name: string): RecordField => ({ pos, len, value: numeric(0, len), name });

  const records = [buildRecord(MODELO_190_RECORD_LENGTH, [
    ...informativeDeclarantFields("190", year, input.declarant, declarationNumber),
    { pos: 136, len: 9, value: numeric(input.recipients.length, 9), name: "número total de percepciones" },
    { pos: 145, len: 16, value: amountWithSignField(totalIncome, 15), name: "importe total de las percepciones" },
    { pos: 161, len: 15, value: amountUnsigned(totalWithheld, 15), name: "importe total de las retenciones" },
  ])];

  let spouseMissing = 0;
  input.recipients.forEach((recipient, index) => {
    const isEmployee = recipient.key === "A";
    const personal = isEmployee ? recipient.personal : undefined;
    const married = personal?.familySituation === 2;
    const spouse = married ? normalizeSpanishNif(personal?.spouseTaxId) : "";
    if (married && !hasSpanishNifShape(spouse)) spouseMissing += 1;
    const withExpenses = isEmployee || (recipient.key === "E" && (recipient.subkey === "01" || recipient.subkey === "02"));
    const extra = personal?.extra ?? null;
    // Gastos deducibles: los de la ficha del trabajador para el ejercicio y, si no hay, sus cotizaciones de las nóminas.
    const expenses = withExpenses ? (isEmployee && extra?.deductibleExpensesCents !== undefined ? extra.deductibleExpensesCents : recipient.deductibleExpensesCents ?? 0) : 0;
    for (const [label, cents] of [["reducciones", extra?.reductionsCents], ["gastos deducibles", expenses], ["pensiones compensatorias", extra?.compensatoryPensionCents], ["anualidades por alimentos", extra?.childSupportCents]] as const) {
      if ((cents ?? 0) < 0) throw new FiscalFileError([`Las ${label} de ${sanitizeText(recipient.name)} son negativas: corrígelas en su ficha.`]);
    }
    records.push(buildRecord(MODELO_190_RECORD_LENGTH, [
      ...informativeRecipientFields("190", year, input.declarant, recipient),
      { pos: 76, len: 2, value: provinces[index], name: "provincia" },
      { pos: 78, len: 1, value: recipient.key, name: "clave de percepción" },
      { pos: 79, len: 2, value: KEYS_WITH_SUBKEY.has(recipient.key) ? (recipient.subkey as string) : "00", name: "subclave" },
      { pos: 81, len: 14, value: amountWithSignField(recipient.cashCents, 13), name: "percepción íntegra dineraria" },
      { pos: 95, len: 13, value: amountUnsigned(recipient.withheldCents, 13), name: "retenciones practicadas" },
      { pos: 108, len: 14, value: amountWithSignField(recipient.inKindCents, 13), name: "valoración en especie" },
      { pos: 122, len: 13, value: amountUnsigned(recipient.inKindWithheldCents, 13), name: "ingresos a cuenta efectuados" },
      zeros(135, 13, "ingresos a cuenta repercutidos"),
      zeros(148, 4, "ejercicio de devengo"),
      zeros(152, 1, "Ceuta o Melilla"),
      // Datos adicionales (153-254): año de nacimiento, situación familiar, discapacidad y contrato solo en la clave A.
      { pos: 153, len: 4, value: numeric(isEmployee ? (personal?.birthYear ?? 0) : 0, 4), name: "año de nacimiento" },
      { pos: 157, len: 1, value: numeric(isEmployee ? (personal?.familySituation ?? 0) : 0, 1), name: "situación familiar" },
      { pos: 158, len: 9, value: married && hasSpanishNifShape(spouse) ? nifField(spouse) : blanks(9), name: "NIF del cónyuge" },
      { pos: 167, len: 1, value: numeric(isEmployee ? Math.min(3, Math.max(0, personal?.disability ?? 0)) : 0, 1), name: "discapacidad" },
      { pos: 168, len: 1, value: numeric(isEmployee ? (personal?.contractType ?? 0) : 0, 1), name: "contrato o relación" },
      zeros(169, 1, "titular de la unidad de convivencia"),
      ...(isEmployee ? extraFamilyFields(extra) : [zeros(170, 1, "movilidad geográfica"), zeros(223, 32, "descendientes, ascendientes, hijos y vivienda")]),
      { pos: 171, len: 13, value: amountUnsigned(isEmployee ? extra?.reductionsCents ?? 0 : 0, 13, "reducciones"), name: "reducciones aplicables" },
      { pos: 184, len: 13, value: amountUnsigned(expenses, 13, "gastos deducibles"), name: "gastos deducibles" },
      { pos: 197, len: 13, value: amountUnsigned(isEmployee ? extra?.compensatoryPensionCents ?? 0 : 0, 13, "pensiones compensatorias"), name: "pensiones compensatorias" },
      { pos: 210, len: 13, value: amountUnsigned(isEmployee ? extra?.childSupportCents ?? 0 : 0, 13, "anualidades por alimentos"), name: "anualidades por alimentos" },
      // Percepciones derivadas de incapacidad laboral (255-321): signo en blanco e importes a cero.
      zeros(256, 13, "percepción dineraria por incapacidad"),
      zeros(269, 13, "retenciones por incapacidad"),
      zeros(283, 13, "percepción en especie por incapacidad"),
      zeros(296, 13, "ingresos a cuenta por incapacidad"),
      zeros(309, 13, "ingresos a cuenta repercutidos por incapacidad"),
      zeros(322, 1, "complemento de ayuda para la infancia"),
      // Reparto entre el Estado y las Haciendas forales (solo clave E con ingreso proporcional al volumen de operaciones).
      zeros(323, 65, "retenciones ingresadas en el Estado y las Haciendas forales"),
      zeros(388, 1, "excesos de acciones de empresas emergentes"),
      zeros(389, 1, "gestión de fondos vinculados al emprendimiento"),
      zeros(390, 5, "tipos de prestación de la clave B.01"),
    ]));
  });

  const warnings: string[] = [];
  const employees = input.recipients.filter((row) => row.key === "A");
  if (employees.length > 0) {
    const withoutExtra = employees.filter((row) => !row.personal?.extra).length;
    warnings.push(withoutExtra > 0
      ? `${withoutExtra} empleado(s) no tienen en su ficha los datos del 190 del ejercicio (hijos, ascendientes, reducciones, pensiones, vivienda): van a cero y, como gastos deducibles, sus cotizaciones a la Seguridad Social de las nóminas. Complétalos en su ficha o en la sede.`
      : "De los empleados (clave A) el fichero lleva los datos personales y familiares de su ficha para el ejercicio: compruébalos antes de presentar.");
  }
  if (input.recipients.some((row) => row.key === "L")) warnings.push("Las indemnizaciones exentas por despido o cese van en la clave L.05 sin retención; la parte que exceda del límite exento va en la clave A con las demás percepciones del trabajador.");
  if (spouseMissing > 0) warnings.push(`${spouseMissing} empleado(s) con situación familiar 2 no tienen el NIF del cónyuge: añádelo en su ficha o en la sede.`);
  if (input.recipients.some((row) => row.key === "E")) warnings.push("Los consejeros y administradores (clave E) van sin reducciones ni reparto entre Administraciones forales: revísalo si te afecta.");
  if (phoneMissing(input.declarant)) warnings.push("Falta el teléfono de contacto de la empresa (va a ceros): añádelo en Configuración › Empresa o complétalo en la sede.");
  return fiscalFile(`190-${year}.txt`, `${records.join("\r\n")}\r\n`, warnings);
}

function phoneMissing(declarant: Declarant) {
  return !(declarant.phone ?? "").replace(/\D/g, "");
}
