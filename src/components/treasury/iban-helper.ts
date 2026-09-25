import { checkIban, formatIban } from "@/lib/bank-import/iban";

/** Ayuda bajo el campo IBAN: confirma el IBAN o explica qué falla (sin bloquear el guardado). */
export function ibanHelperText(value: string) {
  if (!value.trim()) return "Lo encontrarás en la web de tu banco o en el extracto (24 caracteres en España).";
  const check = checkIban(value);
  return check.valid ? `IBAN correcto: ${formatIban(check.iban)}` : `Revisa el IBAN: ${check.reason}`;
}
