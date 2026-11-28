/**
 * Piezas comunes de los ficheros de presentación de la AEAT (registros de longitud fija).
 *
 * Reglas tomadas de los diseños de registro oficiales (notas de cada diseño):
 * - Campos alfanuméricos: alineados a la izquierda y rellenos de blancos por la derecha, en
 *   mayúsculas y sin vocales acentuadas; solo letras, números y blancos.
 * - Campos numéricos: alineados a la derecha y rellenos de ceros por la izquierda, sin coma decimal
 *   (los importes llevan los dos decimales en las dos últimas posiciones).
 * - Autoliquidaciones (303, 111, 115, 130): los numéricos con signo («N») llevan una N en la primera
 *   posición del campo cuando son negativos.
 * - Informativas (347, 349): el signo va en un campo propio de una posición («N» o blanco).
 * - Codificación ISO-8859-1 (la Ñ es el byte D1 y la Ç el C7).
 *
 * Todo son funciones puras: no leen la base de datos.
 */

/** Versión del programa que se anota en la cabecera `<AUX>` de las autoliquidaciones (4 posiciones). */
export const PROGRAM_VERSION = "0100";

/** Problema que impide generar el fichero, redactado para quien no es contable. */
export class FiscalFileError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(problems.join(" "));
    this.name = "FiscalFileError";
    this.problems = problems;
  }
}

/** Datos del declarante que piden todos los diseños. */
export type Declarant = {
  /** NIF español (con o sin prefijo ES, con o sin separadores). */
  taxId: string | null | undefined;
  /** Razón social, o apellidos y nombre de la persona física. */
  name: string | null | undefined;
  /** Persona física: el 130, el 111 y el 115 separan apellidos y nombre. */
  isIndividual: boolean;
  /** Apellidos y nombre por separado, si se conocen (personas físicas). */
  surname?: string | null;
  firstName?: string | null;
  phone?: string | null;
  contactName?: string | null;
};

const ACCENTS: Record<string, string> = {
  Á: "A", À: "A", Â: "A", Ä: "A", Ã: "A", Å: "A",
  É: "E", È: "E", Ê: "E", Ë: "E",
  Í: "I", Ì: "I", Î: "I", Ï: "I",
  Ó: "O", Ò: "O", Ô: "O", Ö: "O", Õ: "O",
  Ú: "U", Ù: "U", Û: "U", Ü: "U",
};

/**
 * Texto apto para un campo alfanumérico: mayúsculas, sin acentos, solo letras (incluidas Ñ y Ç),
 * números y blancos. La puntuación pasa a blanco y los blancos repetidos se juntan.
 */
export function sanitizeText(value: string | null | undefined) {
  return (value ?? "")
    .toUpperCase()
    .replace(/[ÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜ]/g, (char) => ACCENTS[char] ?? char)
    .replace(/[^A-Z0-9ÑÇ ]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

/** Campo alfanumérico: texto saneado, cortado a la longitud y relleno de blancos por la derecha. */
export function alpha(value: string | null | undefined, length: number) {
  return sanitizeText(value).slice(0, length).padEnd(length, " ");
}

export function blanks(length: number) {
  return " ".repeat(length);
}

/** Importe en céntimos a partir de un número con decimales (evita arrastrar errores de coma flotante). */
export function toCents(amount: number | null | undefined) {
  const value = Number(amount ?? 0);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

/** Campo numérico entero sin signo, relleno de ceros por la izquierda. Falla si no cabe o es negativo. */
export function numeric(value: number, length: number, fieldLabel = "campo numérico") {
  if (!Number.isInteger(value) || value < 0) throw new FiscalFileError([`El ${fieldLabel} no admite valores negativos ni decimales (${value}).`]);
  const text = String(value);
  if (text.length > length) throw new FiscalFileError([`El ${fieldLabel} no cabe en las ${length} posiciones del diseño de registro.`]);
  return text.padStart(length, "0");
}

/** Importe sin signo (céntimos): parte entera + dos decimales, sin coma. Falla si es negativo. */
export function amountUnsigned(cents: number, length: number, fieldLabel = "importe") {
  if (cents < 0) throw new FiscalFileError([`El ${fieldLabel} es negativo y el diseño de registro no admite signo en ese campo.`]);
  return numeric(Math.round(cents), length, fieldLabel);
}

/**
 * Importe con signo de las autoliquidaciones (tipo «N» del diseño): si es negativo, una N en la
 * primera posición del campo y el valor absoluto a continuación, relleno de ceros.
 */
export function amountSignedN(cents: number, length: number, fieldLabel = "importe") {
  const rounded = Math.round(cents);
  if (rounded >= 0) return numeric(rounded, length, fieldLabel);
  return `N${numeric(-rounded, length - 1, fieldLabel)}`;
}

/**
 * Importe de las declaraciones informativas: un campo de signo («N» si es negativo, blanco si no)
 * seguido del importe en valor absoluto. `length` es la longitud del importe, sin contar el signo.
 */
export function amountWithSignField(cents: number, length: number, fieldLabel = "importe") {
  const rounded = Math.round(cents);
  return `${rounded < 0 ? "N" : " "}${numeric(Math.abs(rounded), length, fieldLabel)}`;
}

/** NIF español sin prefijo de país ni separadores. */
export function normalizeSpanishNif(value: string | null | undefined) {
  const cleaned = (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.startsWith("ES") && cleaned.length === 11 ? cleaned.slice(2) : cleaned;
}

/** ¿Tiene forma de NIF español (NIF, NIE o NIF de entidad)? No comprueba el dígito de control. */
export function hasSpanishNifShape(value: string) {
  return /^\d{8}[A-Z]$/.test(value) || /^[XYZKLM]\d{7}[A-Z]$/.test(value) || /^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(value);
}

/** NIF en 9 posiciones, ajustado a la derecha y relleno de ceros por la izquierda (informativas). */
export function nifField(value: string | null | undefined) {
  return normalizeSpanishNif(value).slice(-9).padStart(9, "0");
}

export type FilePeriod = {
  year: number;
  /** Periodo con el código de la AEAT: "1T"…"4T", "01"…"12" o "0A" (anual). */
  code: string;
  isLastOfYear: boolean;
  isMonthly: boolean;
};

/** Periodo del programa ("2026-Q1", "2026-04", "2026") al código de la AEAT. null si no se reconoce. */
export function parseFilePeriod(period: string): FilePeriod | null {
  const text = period.trim();
  const quarter = /^(\d{4})-Q([1-4])$/.exec(text);
  if (quarter) return { year: Number(quarter[1]), code: `${quarter[2]}T`, isLastOfYear: quarter[2] === "4", isMonthly: false };
  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(text);
  if (month) return { year: Number(month[1]), code: month[2], isLastOfYear: month[2] === "12", isMonthly: true };
  const year = /^(\d{4})$/.exec(text);
  if (year) return { year: Number(year[1]), code: "0A", isLastOfYear: true, isMonthly: false };
  return null;
}

/**
 * Comprueba los datos del declarante que exige cualquier fichero (NIF y nombre). Devuelve los
 * problemas encontrados, en lenguaje llano; vacío si todo está bien.
 */
export function declarantProblems(declarant: Declarant): string[] {
  const problems: string[] = [];
  const nif = normalizeSpanishNif(declarant.taxId);
  if (!nif) problems.push("Falta el NIF de la empresa. Añádelo en Configuración › Empresa.");
  else if (!hasSpanishNifShape(nif)) problems.push(`El NIF de la empresa («${nif}») no tiene forma de NIF español (9 caracteres). Corrígelo en Configuración › Empresa.`);
  if (!sanitizeText(declarant.name)) problems.push("Falta la razón social (o los apellidos y el nombre) de la empresa. Añádela en Configuración › Empresa.");
  return problems;
}

/**
 * Apellidos y nombre del declarante para los diseños que los separan (111, 115 y 130).
 * - Entidades: toda la denominación va en el primer campo.
 * - Personas físicas: si no vienen separados, se parte por la coma («APELLIDOS, NOMBRE»); sin coma
 *   va todo en el campo de apellidos y `needsReview` avisa de que hay que comprobarlo.
 */
export function splitDeclarantName(declarant: Declarant): { surname: string; firstName: string; needsReview: boolean } {
  if (!declarant.isIndividual) return { surname: sanitizeText(declarant.name), firstName: "", needsReview: false };
  if (declarant.surname && declarant.firstName) return { surname: sanitizeText(declarant.surname), firstName: sanitizeText(declarant.firstName), needsReview: false };
  const raw = declarant.name ?? "";
  const comma = raw.indexOf(",");
  if (comma > 0) return { surname: sanitizeText(raw.slice(0, comma)), firstName: sanitizeText(raw.slice(comma + 1)), needsReview: false };
  return { surname: sanitizeText(raw), firstName: "", needsReview: true };
}

export type RecordField = {
  /** Posición inicial en el diseño (la primera es la 1). */
  pos: number;
  len: number;
  value: string;
  /** Casilla o nombre del campo, para los mensajes de error. */
  name?: string;
};

/**
 * Monta un registro de longitud fija. Las posiciones que no cubre ningún campo quedan en blanco
 * (reservadas para la Administración). Falla si un campo no mide lo que dice el diseño, si dos
 * campos se pisan o si alguno se sale del registro: así un error de transcripción del diseño se
 * detecta en los tests y no en la sede.
 */
export function buildRecord(length: number, fields: RecordField[]) {
  const chars = new Array<string>(length).fill(" ");
  const used = new Array<boolean>(length).fill(false);
  for (const field of fields) {
    const label = field.name ?? `posición ${field.pos}`;
    if (field.value.length !== field.len) throw new Error(`Campo ${label}: mide ${field.value.length} y el diseño pide ${field.len}.`);
    if (field.pos < 1 || field.pos + field.len - 1 > length) throw new Error(`Campo ${label}: se sale del registro de ${length} posiciones.`);
    for (let index = 0; index < field.len; index += 1) {
      const at = field.pos - 1 + index;
      if (used[at]) throw new Error(`Campo ${label}: pisa la posición ${at + 1}, ya ocupada por otro campo.`);
      used[at] = true;
      chars[at] = field.value[index];
    }
  }
  return chars.join("");
}

/** Texto del fichero a bytes ISO-8859-1. Falla si queda algún carácter fuera de ese juego. */
export function encodeLatin1(text: string) {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code > 255) throw new Error(`Carácter fuera de ISO-8859-1 en la posición ${index + 1}.`);
    bytes[index] = code;
  }
  return bytes;
}

/**
 * Envoltura común de las autoliquidaciones presentadas mediante fichero (hoja «00» de los diseños
 * del 303, 111, 115 y 130): `<T` + modelo + `0` + ejercicio + periodo + `0000>`, bloque `<AUX>` de
 * 300 posiciones (versión del programa en 93-96; NIF de la empresa de desarrollo en 101-109, que
 * aquí queda en blanco), las páginas y el cierre `</T…>`.
 */
export function wrapSelfAssessment(model: string, period: FilePeriod, pages: string[]) {
  const id = `${model}0${String(period.year).padStart(4, "0")}${period.code}0000`;
  const header = buildRecord(328, [
    { pos: 1, len: 2, value: "<T" },
    { pos: 3, len: 3, value: model },
    { pos: 6, len: 1, value: "0" },
    { pos: 7, len: 4, value: String(period.year).padStart(4, "0") },
    { pos: 11, len: 2, value: period.code },
    { pos: 13, len: 5, value: "0000>" },
    { pos: 18, len: 5, value: "<AUX>" },
    { pos: 93, len: 4, value: PROGRAM_VERSION },
    { pos: 323, len: 6, value: "</AUX>" },
  ]);
  return `${header}${pages.join("")}</T${id}>`;
}

export type FiscalFile = {
  fileName: string;
  /** Contenido en texto (un carácter por posición), para tests y vista previa. */
  text: string;
  bytes: Uint8Array;
  /** Avisos que no impiden generar el fichero pero conviene revisar en la sede. */
  warnings: string[];
};

export function fiscalFile(fileName: string, text: string, warnings: string[] = []): FiscalFile {
  return { fileName, text, bytes: encodeLatin1(text), warnings };
}

// ---------------------------------------------------------------------------------------------
// Declaraciones informativas de retenciones (190, 180 y 193)
// ---------------------------------------------------------------------------------------------

/**
 * Código de provincia de los diseños del 190 (2025), 180 (2023) y 193 (2025) a partir del código
 * postal: los dos primeros dígitos, salvo la isla de La Palma (códigos postales 387xx), que en
 * esos tres diseños tiene código propio, el 53. null si el código postal no es español.
 */
export function informativeProvinceCode(postalCode: string | null | undefined) {
  const match = /^(\d{2})(\d)\d{2}$/.exec((postalCode ?? "").replace(/\s/g, ""));
  if (!match) return null;
  const province = Number(match[1]);
  if (province < 1 || province > 52) return null;
  return match[1] === "38" && match[2] === "7" ? "53" : match[1];
}

/** ¿Es un código de provincia de esos diseños (01 a 53, o 98: residentes en el extranjero del art. 10 LIRPF)? */
export function isInformativeProvinceCode(value: string) {
  return /^\d{2}$/.test(value) && ((Number(value) >= 1 && Number(value) <= 53) || value === "98");
}

/** Porcentaje en cuatro posiciones (dos enteros y dos decimales), como piden el 180 y el 193. */
export function percent4(rate: number, fieldLabel = "porcentaje de retención") {
  const hundredths = Math.round(rate * 100);
  if (!Number.isFinite(hundredths) || hundredths < 0 || hundredths > 9999) throw new FiscalFileError([`El ${fieldLabel} (${rate}) no cabe en el diseño de registro.`]);
  return String(hundredths).padStart(4, "0");
}

/** Teléfono de contacto en nueve dígitos (los últimos nueve; ceros si falta). */
export function phone9(phone: string | null | undefined) {
  return (phone ?? "").replace(/\D/g, "").slice(-9).padStart(9, "0");
}

/** Número identificativo por defecto de una informativa: modelo + ejercicio + secuencial. */
export function defaultDeclarationNumber(model: string, year: number) {
  return `${model}${String(year).padStart(4, "0")}000001`;
}

/**
 * Campos comunes del registro de tipo 1 (declarante) de las informativas 190, 180 y 193: las
 * posiciones 1 a 135 son idénticas en los tres diseños (tipo, modelo, ejercicio, NIF, nombre, tipo
 * de soporte «T», persona de contacto, número identificativo y declaración anterior a ceros).
 */
export function informativeDeclarantFields(model: "190" | "180" | "193", year: number, declarant: Declarant, declarationNumber: string): RecordField[] {
  return [
    { pos: 1, len: 1, value: "1" },
    { pos: 2, len: 3, value: model },
    { pos: 5, len: 4, value: numeric(year, 4) },
    { pos: 9, len: 9, value: nifField(declarant.taxId), name: "NIF del declarante" },
    { pos: 18, len: 40, value: alpha(declarant.name, 40) },
    { pos: 58, len: 1, value: "T", name: "tipo de soporte" },
    { pos: 59, len: 9, value: phone9(declarant.phone), name: "teléfono" },
    { pos: 68, len: 40, value: alpha(declarant.contactName ?? declarant.name, 40) },
    { pos: 108, len: 13, value: declarationNumber, name: "número identificativo" },
    { pos: 123, len: 13, value: numeric(0, 13), name: "declaración anterior" },
  ];
}

/** Campos comunes del arranque del registro de tipo 2 (perceptor) de esas informativas (posiciones 1 a 75). */
export function informativeRecipientFields(model: "190" | "180" | "193", year: number, declarant: Declarant, recipient: { taxId: string | null; name: string }): RecordField[] {
  return [
    { pos: 1, len: 1, value: "2" },
    { pos: 2, len: 3, value: model },
    { pos: 5, len: 4, value: numeric(year, 4) },
    { pos: 9, len: 9, value: nifField(declarant.taxId) },
    { pos: 18, len: 9, value: nifField(recipient.taxId), name: "NIF del perceptor" },
    { pos: 36, len: 40, value: alpha(recipient.name, 40) },
  ];
}

/** Junta en un solo problema los perceptores a los que les falta un dato (los primeros, y cuántos más). */
export function listProblems(intro: string, items: string[], limit = 8) {
  if (items.length === 0) return [];
  return [`${intro} ${items.slice(0, limit).join("; ")}${items.length > limit ? ` (y ${items.length - limit} más)` : ""}.`];
}

/**
 * Provincia del domicilio de un perceptor: la de su ficha de tercero (código postal) y, si no hay,
 * la que se indique al descargar. null si no se puede saber.
 */
export function resolveRecipientProvince(
  taxId: string | null,
  postalCodes: Map<string, string | null> | undefined,
  defaultProvince: string | null | undefined,
) {
  const fromCard = informativeProvinceCode(postalCodes?.get(normalizeSpanishNif(taxId)));
  if (fromCard) return fromCard;
  const fallback = (defaultProvince ?? "").trim();
  return isInformativeProvinceCode(fallback) ? fallback : null;
}

export const MISSING_PROVINCE_HELP = "Añade el código postal en su ficha de cliente o proveedor, o indica al descargar la provincia (dos dígitos) de los perceptores que no tienen ficha, como los trabajadores.";
