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
  const digits = taxId.slice(1, 8).split("").map(Number);
  const control = taxId[8];
  const evenSum = digits[1] + digits[3] + digits[5];
  const oddSum = [digits[0], digits[2], digits[4], digits[6]]
    .map((digit) => digit * 2)
    .map((value) => Math.floor(value / 10) + (value % 10))
    .reduce((total, value) => total + value, 0);
  const controlDigit = (10 - ((evenSum + oddSum) % 10)) % 10;
  const expectedDigit = cifControlDigits[controlDigit];
  const expectedLetter = cifControlLetters[controlDigit];

  if ("KPQS".includes(organizationType)) return control === expectedLetter;
  if ("ABEH".includes(organizationType)) return control === expectedDigit;
  return control === expectedDigit || control === expectedLetter;
}
