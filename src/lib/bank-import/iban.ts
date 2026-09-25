/**
 * IBAN (ISO 13616) y BIC (ISO 9362). Funciones puras, válidas en cliente y servidor.
 */

/** Longitud del IBAN por país (los de la zona SEPA más habituales). */
const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24, FI: 18,
  FR: 27, GB: 22, GI: 23, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20,
  LV: 21, MC: 27, MT: 31, NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27,
  VA: 22,
};

/** Quita espacios, guiones y el prefijo "IBAN" y pasa a mayúsculas. */
export function normalizeIban(value: string | null | undefined) {
  return (value ?? "").toUpperCase().replace(/^IBAN/, "").replace(/[\s-]+/g, "");
}

/** Resto módulo 97 de un número decimal arbitrariamente largo (procesado en bloques). */
export function mod97(digits: string) {
  let remainder = 0;
  for (let index = 0; index < digits.length; index += 7) {
    remainder = Number(`${remainder}${digits.slice(index, index + 7)}`) % 97;
  }
  return remainder;
}

export type IbanCheck = { valid: true; iban: string } | { valid: false; iban: string; reason: string };

/** Valida formato, longitud por país y dígitos de control (mod 97 = 1). */
export function checkIban(value: string | null | undefined): IbanCheck {
  const iban = normalizeIban(value);
  if (!iban) return { valid: false, iban, reason: "Falta el IBAN." };
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(iban)) {
    return { valid: false, iban, reason: "El IBAN debe empezar por el código de país (p. ej. ES) y dos dígitos de control." };
  }
  const expected = IBAN_LENGTHS[iban.slice(0, 2)];
  if (expected && iban.length !== expected) {
    return { valid: false, iban, reason: `Un IBAN de ${iban.slice(0, 2)} tiene ${expected} caracteres y este tiene ${iban.length}.` };
  }
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  const digits = rearranged.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
  if (mod97(digits) !== 1) return { valid: false, iban, reason: "Los dígitos de control no cuadran: revisa que no falte ni sobre ningún número." };
  return { valid: true, iban };
}

export function isValidIban(value: string | null | undefined) {
  return checkIban(value).valid;
}

/** "ES9121000418450200051332" → "ES91 2100 0418 4502 0005 1332". */
export function formatIban(value: string | null | undefined) {
  return normalizeIban(value).replace(/(.{4})/g, "$1 ").trim();
}

export function normalizeBic(value: string | null | undefined) {
  return (value ?? "").toUpperCase().replace(/\s+/g, "");
}

/** BIC de 8 u 11 caracteres: entidad (4 letras) + país (2) + localidad (2) + sucursal opcional (3). */
export function isValidBic(value: string | null | undefined) {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(normalizeBic(value));
}
