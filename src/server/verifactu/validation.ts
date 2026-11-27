import { HttpError } from "@/lib/http";
import type { VerifactuAltaContent } from "@/server/verifactu/mapping";

/**
 * Validaciones previas a la emisión (código puro). Reproducen reglas del documento de validaciones
 * de la AEAT (v1.2.2) cuyo incumplimiento provoca un rechazo NO subsanable: es mejor impedir la
 * emisión con un mensaje claro que emitir una factura cuyo registro nunca será admitido.
 */

const FORBIDDEN_SERIES_CHARACTERS = new Set(['"', "'", "<", ">", "="]);
/** Longitud máxima de NumSerieFactura en el esquema de la AEAT. */
export const MAX_SERIES_NUMBER_LENGTH = 60;

/**
 * Caracteres de un número de factura (serie + número) que la AEAT no admite en NumSerieFactura:
 * solo ASCII imprimible (32 a 126) y, dentro de él, nunca `"`, `'`, `<`, `>` ni `=`.
 * Devuelve los caracteres no admitidos, sin repetir (vacío si el número es válido).
 */
export function invalidSeriesNumberCharacters(value: string): string[] {
  const invalid = new Set<string>();
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 || code > 126 || FORBIDDEN_SERIES_CHARACTERS.has(character)) invalid.add(character);
  }
  return [...invalid];
}

export function isValidVerifactuSeriesNumber(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_SERIES_NUMBER_LENGTH && invalidSeriesNumberCharacters(trimmed).length === 0;
}

/** Falla (422) si el número de factura no es admisible como NumSerieFactura. */
export function assertVerifactuSeriesNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new HttpError(422, "La factura no tiene número: no se puede registrar en VERI*FACTU.");
  if (trimmed.length > MAX_SERIES_NUMBER_LENGTH) {
    throw new HttpError(422, `El número de factura «${trimmed}» tiene más de ${MAX_SERIES_NUMBER_LENGTH} caracteres, el máximo que admite la AEAT. Acorta el prefijo de la serie en Configuración › Series.`);
  }
  const invalid = invalidSeriesNumberCharacters(trimmed);
  if (invalid.length > 0) {
    const shown = invalid.map((character) => (character.trim() ? `«${character}»` : "espacio o carácter de control")).join(", ");
    throw new HttpError(
      422,
      `El número de factura «${trimmed}» contiene caracteres que la AEAT no admite (${shown}). `
        + "Solo valen letras sin tilde, números, espacios y signos básicos (por ejemplo, - / . _), y nunca comillas, <, > ni =. "
        + "Cambia el prefijo de la serie en Configuración › Series y vuelve a emitir.",
    );
  }
}

/**
 * Códigos de la AEAT que una subsanación no resuelve: volver a remitir el mismo registro daría el
 * mismo resultado. 2004: fecha y hora de generación fuera del margen admitido. 2009: IPSI sin clave
 * de régimen.
 */
export const NON_SUBSANABLE_ERROR_CODES: ReadonlySet<string> = new Set(["2004", "2009"]);

/**
 * Códigos que señalan la identificación del destinatario (NIF, nombre o documento). Esos datos son
 * parte de la factura emitida: si están mal, lo que procede es una factura rectificativa.
 */
export const RECIPIENT_ERROR_CODES: ReadonlySet<string> = new Set(["1121", "1193", "1239", "1283", "1289", "2001"]);

export type SubsanacionBlock = { kind: "not-subsanable" | "recipient"; message: string };

/** ¿Por qué no se puede subsanar un registro con este error de la AEAT? null si sí se puede. */
export function subsanacionBlockFor(error: { code: string | null | undefined; message?: string | null }): SubsanacionBlock | null {
  const code = error.code?.trim() ?? "";
  if (NON_SUBSANABLE_ERROR_CODES.has(code)) {
    return {
      kind: "not-subsanable",
      message: `El error ${code} de la AEAT no se corrige con una subsanación (volver a enviar el registro daría el mismo resultado). Contacta con soporte para revisarlo.`,
    };
  }
  if (RECIPIENT_ERROR_CODES.has(code) || /destinatari|contraparte/i.test(error.message ?? "")) {
    return {
      kind: "recipient",
      message: "La AEAT no admite la identificación del destinatario (NIF o nombre). Esos datos forman parte de la factura emitida y no se cambian con una subsanación: "
        + "corrige la ficha del cliente y emite una factura rectificativa de esta factura.",
    };
  }
  return null;
}

/** dd-mm-aaaa → número comparable (aaaammdd); null si el texto no es una fecha con ese formato. */
function aeatDateKey(value: string | null | undefined) {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value ?? "");
  return match ? Number(`${match[3]}${match[2]}${match[1]}`) : null;
}

/**
 * Coherencia del contenido de un alta antes de emitir:
 * - FechaOperacion no puede ser posterior a la de expedición (solo se admite con las claves de
 *   régimen 14 y 15, que este sistema no emite) ni anterior en más de veinte años.
 * - Con IVA o IGIC y ClaveRegimen 01 (régimen general) no caben las exenciones E2 y E3.
 * - Con IVA, la exención E5 (entrega intracomunitaria) exige que el destinatario, si se informa,
 *   esté identificado con un documento no español (IDOtro).
 */
export function assertAltaContentSendable(content: Pick<VerifactuAltaContent, "breakdown" | "recipient" | "operationDate">, invoiceIssueDate: string) {
  const issued = aeatDateKey(invoiceIssueDate);
  const operation = aeatDateKey(content.operationDate);
  if (issued !== null && operation !== null) {
    if (operation > issued) {
      throw new HttpError(422, "La fecha de la operación no puede ser posterior a la fecha de expedición de la factura: la AEAT rechazaría el registro. Corrige la fecha de operación (o la de la factura) antes de emitir.");
    }
    if (operation < issued - 20_0000) {
      throw new HttpError(422, "La fecha de la operación es anterior en más de veinte años a la de la factura: la AEAT rechazaría el registro. Revísala antes de emitir.");
    }
  }
  for (const line of content.breakdown) {
    const exemption = line.OperacionExenta;
    if (!exemption) continue;
    const vatOrIgic = line.Impuesto === "01" || line.Impuesto === "03" || !line.Impuesto;
    if (vatOrIgic && line.ClaveRegimen === "01" && (exemption === "E2" || exemption === "E3")) {
      throw new HttpError(
        422,
        `La causa de exención ${exemption} (exportaciones y operaciones asimiladas) no es compatible con el tratamiento de IVA de esta factura: la AEAT rechazaría el registro. `
          + "Si es una exportación, elige el tratamiento «Exportación»; si no, elige otra causa de exención.",
      );
    }
    if ((line.Impuesto === "01" || !line.Impuesto) && exemption === "E5" && content.recipient && !content.recipient.idType) {
      throw new HttpError(
        422,
        "La causa de exención E5 (entrega intracomunitaria) exige un cliente de otro Estado miembro identificado con su NIF-IVA: este cliente figura con NIF español. "
          + "Corrige el país y el NIF-IVA en la ficha del cliente o elige otra causa de exención.",
      );
    }
  }
}
