const nifLetters = "TRWAGMYFPDXBNJZSQVHLCKE";
const cifControlLetters = "JABCDEFGHI";
const cifControlDigits = "0123456789";

export function normalizeSpanishTaxId(value: string | null | undefined) {
  return (value ?? "").toUpperCase().replace(/[\s.-]/g, "");
}

export function isValidSpanishTaxId(value: string | null | undefined) {
  const taxId = normalizeSpanishTaxId(value);
  if (!taxId) return false;

  if (/^\d{8}[A-Z]$/.test(taxId)) return isValidNif(taxId);
  if (/^[XYZ]\d{7}[A-Z]$/.test(taxId)) return isValidNie(taxId);
  if (/^[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]$/.test(taxId)) return isValidCif(taxId);

  return false;
}

export function hasSpanishTaxIdFormat(value: string | null | undefined) {
  const normalized = normalizeSpanishTaxId(value);
  const taxId = normalized.startsWith("ES") ? normalized.slice(2) : normalized;
  if (!taxId) return false;

  return /^\d{8}[A-Z]$/.test(taxId)
    || /^[XYZ]\d{7}[A-Z]$/.test(taxId)
    || /^[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]$/.test(taxId);
}

const TAX_ID_FORMAT_HELP =
  "Un CIF tiene 9 caracteres: letra + 7 dígitos + carácter de control (p. ej. B12345674). Un NIF: 8 dígitos + letra (12345678Z). Un NIE: X, Y o Z + 7 dígitos + letra.";

/**
 * Explains in plain Spanish why a value is not a recognisable Spanish tax id, suggesting the
 * complete id when only the trailing control character is missing (a very common typo).
 * Returns null when the format is valid.
 */
export function describeSpanishTaxIdProblem(value: string | null | undefined): string | null {
  if (hasSpanishTaxIdFormat(value)) return null;
  const normalized = normalizeSpanishTaxId(value);
  const taxId = normalized.startsWith("ES") ? normalized.slice(2) : normalized;
  if (!taxId) return "Indica el CIF/NIF.";

  if (/^[ABCDEFGHJKLMNPQRSUVW]\d{7}$/.test(taxId)) {
    return `Al CIF le falta el carácter de control final (debe tener 9 caracteres). Si es ${taxId}, el CIF completo sería ${completeCif(taxId)}.`;
  }
  if (/^\d{8}$/.test(taxId)) {
    return `Al NIF le falta la letra final. Si es ${taxId}, el NIF completo sería ${taxId}${nifLetters[Number(taxId) % 23]}.`;
  }
  if (/^[XYZ]\d{7}$/.test(taxId)) {
    const prefix = { X: "0", Y: "1", Z: "2" }[taxId[0] as "X" | "Y" | "Z"];
    return `Al NIE le falta la letra final. Si es ${taxId}, el NIE completo sería ${taxId}${nifLetters[Number(`${prefix}${taxId.slice(1)}`) % 23]}.`;
  }
  if (/^\d{7}[A-Z]$/.test(taxId)) {
    return `El NIF debe tener 8 dígitos antes de la letra. ¿Quizá falta un 0 inicial: 0${taxId}?`;
  }
  return `El CIF/NIF no tiene un formato español reconocible. ${TAX_ID_FORMAT_HELP}`;
}

/** CIF with its computed control character (digit or letter depending on the entity type). */
function completeCif(withoutControl: string) {
  const controlDigit = cifControlIndex(withoutControl.slice(1, 8).split("").map(Number));
  return `${withoutControl}${"KPQS".includes(withoutControl[0]) ? cifControlLetters[controlDigit] : cifControlDigits[controlDigit]}`;
}

function cifControlIndex(digits: number[]) {
  const evenSum = digits[1] + digits[3] + digits[5];
  const oddSum = [digits[0], digits[2], digits[4], digits[6]]
    .map((digit) => digit * 2)
    .map((value) => Math.floor(value / 10) + (value % 10))
    .reduce((total, value) => total + value, 0);
  return (10 - ((evenSum + oddSum) % 10)) % 10;
}

function isValidNif(taxId: string) {
  const number = Number(taxId.slice(0, 8));
  return taxId[8] === nifLetters[number % 23];
}

function isValidNie(taxId: string) {
  const prefix = { X: "0", Y: "1", Z: "2" }[taxId[0] as "X" | "Y" | "Z"];
  return isValidNif(`${prefix}${taxId.slice(1)}`);
}

function isValidCif(taxId: string) {
  const organizationType = taxId[0];
  const control = taxId[8];
  const controlDigit = cifControlIndex(taxId.slice(1, 8).split("").map(Number));
  const expectedDigit = cifControlDigits[controlDigit];
  const expectedLetter = cifControlLetters[controlDigit];

  if ("KPQS".includes(organizationType)) return control === expectedLetter;
  if ("ABEH".includes(organizationType)) return control === expectedDigit;
  return control === expectedDigit || control === expectedLetter;
}
