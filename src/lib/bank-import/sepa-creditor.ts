import { mod97 } from "@/lib/bank-import/iban";

/**
 * Identificador de acreedor SEPA (AT-02, EPC262-08). Funciones puras, válidas en cliente y servidor.
 *
 * Formato: país (2 letras) + dígitos de control (2) + código comercial o sufijo (3) + identificador
 * nacional. En España el identificador nacional es el NIF/CIF (9 caracteres) y el sufijo suele ser
 * "000": ES + control + 000 + B12345678 → 16 caracteres. Los dígitos de control se calculan con
 * ISO 7064 (mod 97-10) sobre el identificador nacional + país + "00", ignorando el sufijo.
 */

export function normalizeCreditorId(value: string | null | undefined) {
  return (value ?? "").toUpperCase().replace(/[\s-]+/g, "");
}

function lettersToDigits(value: string) {
  return value.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
}

/** Dígitos de control para un país e identificador nacional. */
export function creditorIdCheckDigits(countryCode: string, nationalId: string) {
  const base = lettersToDigits(`${normalizeCreditorId(nationalId).replace(/[^A-Z0-9]/g, "")}${countryCode.toUpperCase()}00`);
  return String(98 - mod97(base)).padStart(2, "0");
}

/** Construye el identificador a partir del NIF (y el sufijo que asigna el banco, "000" por defecto). */
export function buildCreditorId(nif: string, suffix = "000", countryCode = "ES") {
  const nationalId = normalizeCreditorId(nif).replace(/^ES/, "");
  const business = normalizeCreditorId(suffix).padStart(3, "0").slice(0, 3);
  return `${countryCode}${creditorIdCheckDigits(countryCode, nationalId)}${business}${nationalId}`;
}

export type CreditorIdCheck = { valid: true; creditorId: string } | { valid: false; creditorId: string; reason: string };

export function checkCreditorId(value: string | null | undefined): CreditorIdCheck {
  const creditorId = normalizeCreditorId(value);
  if (!creditorId) return { valid: false, creditorId, reason: "Falta el identificador de acreedor SEPA." };
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{3}[A-Z0-9]{1,28}$/.test(creditorId)) {
    return { valid: false, creditorId, reason: "Debe empezar por el país (ES), dos dígitos de control, el sufijo de 3 caracteres y tu NIF. Ejemplo: ES12 000 B12345678." };
  }
  if (creditorId.startsWith("ES") && creditorId.length !== 16) {
    return { valid: false, creditorId, reason: `En España tiene 16 caracteres (ES + 2 de control + 3 de sufijo + 9 del NIF) y este tiene ${creditorId.length}.` };
  }
  const expected = creditorIdCheckDigits(creditorId.slice(0, 2), creditorId.slice(7));
  if (creditorId.slice(2, 4) !== expected) {
    return { valid: false, creditorId, reason: `Los dígitos de control no cuadran con el NIF (deberían ser ${expected}). Cópialo tal cual te lo dio tu banco.` };
  }
  return { valid: true, creditorId };
}

export function isValidCreditorId(value: string | null | undefined) {
  return checkCreditorId(value).valid;
}
