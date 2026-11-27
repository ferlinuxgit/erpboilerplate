/**
 * EXPORTACIÓN DEL DIARIO A PROGRAMAS DE DESPACHO (funciones puras).
 *
 * 1) Wolters Kluwer A3 — fichero `SUENLACE.DAT`, formato 4 (registros de 256 bytes: 254 de datos +
 *    CR LF). Diseño del registro tipo «0» (apuntes sin IVA) según el documento del fabricante
 *    «Enlace contable de entrada. Descripción de registros»
 *    (media.a3software.com/a3responde/files/5081-Enlace_contable_descripcion_registros_WEB.pdf):
 *      1      tipo de formato «4»          2-6    código de empresa (5 dígitos)
 *      7-14   fecha del apunte aaaammdd    15     tipo de registro «0»
 *      16-27  cuenta (12)                  28-57  descripción de la cuenta (30)
 *      58     D = debe, H = haber          59-68  referencia del documento (10)
 *      69     I, M o U (inicio, medio, último apunte del asiento)
 *      70-99  descripción del apunte (30)  100-113 importe «+0000001000.00»
 *      114-251 reserva (espacios)          252    analítica (espacio)
 *      253    moneda «E»                   254    indicador de generado «N»
 *    Solo se generan apuntes: A3 da de alta las cuentas que no existen con la descripción del
 *    registro. No se exportan las facturas con su detalle de IVA (registros 1, 2 y 9): los libros de
 *    IVA de A3 no se alimentan con este fichero.
 *
 * 2) Sage ContaPlus — `XDiario.txt` (38 campos, 347 caracteres) y `XSubCta.txt` (12 campos, 161
 *    caracteres), en ASCII de ancho fijo. Campos, orden y longitudes del «Protocolo de comunicación
 *    de programas de gestión con ContaPlus» de Sage; posiciones iniciales del diario confirmadas por
 *    el documento «Importador de asientos Sage 50c».
 *
 * LO QUE LA DOCUMENTACIÓN NO FIJA y se resuelve aquí con el criterio más conservador:
 * - Codificación: las dos fuentes dicen solo «ASCII». Se escribe ASCII puro (las tildes y la ñ se
 *   sustituyen por su letra base), que es válido en cualquier página de códigos.
 * - Relleno: textos y cuentas alineados a la izquierda con espacios; números a la derecha con punto
 *   decimal (en A3, con signo y ceros, como su ejemplo «+0000001000.00»); lógicos «F»/«T» de un
 *   carácter (convención de los ficheros de ancho fijo de xBase).
 * Conviene hacer una importación de prueba en una empresa de pruebas antes de usarlo en real.
 */

import type { OrderedBookEntry } from "@/server/accounting/books/books-model";

const CRLF = "\r\n";

/** Texto en ASCII puro y sin saltos de línea. */
export function toAscii(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/€/g, "EUR")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\x20-\x7e]/g, "?");
}

const text = (value: string | null | undefined, length: number) => toAscii(value).slice(0, length).padEnd(length, " ");
const dateKey = (day: string) => day.replaceAll("-", "");

/** Referencia de 10 caracteres: el correlativo del número interno (AS-2026/000123 → 000123). */
function documentReference(number: string) {
  const sequence = number.slice(number.lastIndexOf("/") + 1);
  return sequence.replace(/^AS-?/, "");
}

/** Importe de A3: signo, 10 enteros, punto y 2 decimales (14 caracteres). */
export function a3Amount(cents: number) {
  const absolute = Math.abs(cents);
  const units = Math.floor(absolute / 100);
  if (units > 9_999_999_999) throw new Error("Importe demasiado grande para el formato de A3.");
  return `${cents < 0 ? "-" : "+"}${String(units).padStart(10, "0")}.${String(absolute % 100).padStart(2, "0")}`;
}

export type A3ExportOptions = { /** Código de la empresa en A3 (1 a 99999). */ companyCode: number };

export const A3_RECORD_LENGTH = 256;

/** `SUENLACE.DAT` con un registro tipo 0 por apunte. Los apuntes a cero se omiten. */
export function buildSuenlace(journal: OrderedBookEntry[], options: A3ExportOptions): string {
  if (!Number.isInteger(options.companyCode) || options.companyCode < 1 || options.companyCode > 99_999) {
    throw new Error("El código de empresa de A3 debe ser un número entre 1 y 99999.");
  }
  const company = String(options.companyCode).padStart(5, "0");
  const records: string[] = [];
  for (const entry of journal) {
    const lines = entry.lines.filter((line) => line.debitCents !== 0 || line.creditCents !== 0);
    // A3 exige que cada asiento empiece por I y acabe en U: un asiento necesita al menos dos apuntes.
    if (lines.length < 2) continue;
    lines.forEach((line, index) => {
      const isDebit = line.debitCents !== 0;
      const position = index === 0 ? "I" : index === lines.length - 1 ? "U" : "M";
      const record = [
        "4",
        company,
        dateKey(entry.day),
        "0",
        text(line.accountCode, 12),
        text(line.accountName, 30),
        isDebit ? "D" : "H",
        text(documentReference(entry.number), 10),
        position,
        text(line.concept ?? entry.reference ?? "", 30),
        a3Amount(isDebit ? line.debitCents : line.creditCents),
        " ".repeat(138),
        " ",
        "E",
        "N",
      ].join("");
      records.push(record + CRLF);
    });
  }
  return records.join("");
}

/** Numérico de ancho fijo de xBase: alineado a la derecha con punto decimal. */
function numeric(value: number, length: number, decimals = 0) {
  const formatted = value.toFixed(decimals);
  if (formatted.length > length) throw new Error("Importe demasiado grande para el formato de ContaPlus.");
  return formatted.padStart(length, " ");
}

export const XDIARIO_RECORD_LENGTH = 347;
export const XSUBCTA_RECORD_LENGTH = 161;

/**
 * `XDiario.txt`: un registro por apunte con los 38 campos del protocolo. Solo se informan número de
 * asiento (el de orden del Diario), fecha, subcuenta, concepto, documento e importes en euros; los
 * campos de IVA, analítica y moneda extranjera van vacíos o a cero.
 */
export function buildXDiario(journal: OrderedBookEntry[]): string {
  const records: string[] = [];
  for (const entry of journal) {
    if (entry.order > 999_999) throw new Error("ContaPlus admite como máximo 999.999 asientos por fichero.");
    for (const line of entry.lines) {
      if (line.debitCents === 0 && line.creditCents === 0) continue;
      const record = [
        numeric(entry.order, 6), // 1 Asien
        dateKey(entry.day), // 2 Fecha
        text(line.accountCode, 12), // 3 SubCta
        text("", 12), // 4 Contra
        numeric(0, 16, 2), // 5 PtaDebe
        text(line.concept ?? entry.reference ?? "", 25), // 6 Concepto
        numeric(0, 16, 2), // 7 PtaHaber
        numeric(0, 8), // 8 Factura
        numeric(0, 16, 2), // 9 BaseImpo
        numeric(0, 5, 2), // 10 IVA
        numeric(0, 5, 2), // 11 RecEquiv
        text(documentReference(entry.number), 10), // 12 Documento
        text("", 3), // 13 Departa
        text("", 6), // 14 Clave
        text("", 1), // 15 Estado
        numeric(0, 6), // 16 NCasado
        numeric(0, 1), // 17 TCasado
        numeric(0, 6), // 18 Trans
        numeric(0, 16, 6), // 19 Cambio
        numeric(0, 16, 2), // 20 DebeME
        numeric(0, 16, 2), // 21 HaberME
        text("", 1), // 22 Auxiliar
        text("", 1), // 23 Serie
        text("", 4), // 24 Sucursal
        text("", 5), // 25 CodDivisa
        numeric(0, 16, 2), // 26 ImpAuxME
        "2", // 27 MonedaUso: euros
        numeric(line.debitCents / 100, 16, 2), // 28 EuroDebe
        numeric(line.creditCents / 100, 16, 2), // 29 EuroHaber
        numeric(0, 16, 2), // 30 BaseEuro
        "F", // 31 NoConv
        text("", 10), // 32 NumeroInv
        text("", 1), // 33 Serie_RT
        numeric(0, 8), // 34 Factu_RT
        numeric(0, 16, 2), // 35 BaseImp_RT
        numeric(0, 16, 2), // 36 BaseImp_RF
        "F", // 37 Rectifica
        text("", 8), // 38 Fecha_RT
      ].join("");
      records.push(record + CRLF);
    }
  }
  return records.join("");
}

export type SubaccountExportRow = { code: string; name: string; taxId?: string | null; address?: string | null; city?: string | null; province?: string | null; postalCode?: string | null };

/** `XSubCta.txt`: una subcuenta por registro, sin repetir, con los 12 primeros campos del protocolo. */
export function buildXSubCta(accounts: SubaccountExportRow[]): string {
  const seen = new Set<string>();
  const records: string[] = [];
  for (const account of [...accounts].sort((a, b) => a.code.localeCompare(b.code))) {
    if (seen.has(account.code)) continue;
    seen.add(account.code);
    const record = [
      text(account.code, 12), // 1 Cod
      text(account.name, 40), // 2 Titulo
      text(account.taxId, 15), // 3 Nif
      text(account.address, 35), // 4 Domicilio
      text(account.city, 25), // 5 Poblacion
      text(account.province, 20), // 6 Provincia
      text(account.postalCode, 5), // 7 CodPostal
      "F", // 8 Divisa
      text("", 5), // 9 CodDivisa
      "F", // 10 Documento
      "F", // 11 Ajustame
      text("", 1), // 12 TipoIVA
    ].join("");
    records.push(record + CRLF);
  }
  return records.join("");
}
