import {
  amountUnsigned, buildRecord, declarantProblems, defaultDeclarationNumber, fiscalFile, FiscalFileError, hasSpanishNifShape,
  informativeDeclarantFields, informativeRecipientFields, listProblems, MISSING_PROVINCE_HELP, normalizeSpanishNif, numeric, percent4,
  resolveRecipientProvince, sanitizeText, type Declarant, type FiscalFile,
} from "@/server/fiscal-files/fields";

/**
 * Modelo 193 (resumen anual de retenciones sobre rendimientos del capital mobiliario): registros de
 * 500 posiciones, uno de tipo 1 (declarante) y uno de tipo 2 por perceptor y clave. Diseños de
 * registro oficiales «Modelo 193», ejercicio 2025:
 * https://sede.agenciatributaria.gob.es/static_files/Sede/Disenyo_registro/DR_100_199/DR_Modelo_193_2025.pdf
 *
 * El fichero es el de una sociedad que paga directamente sus propios dividendos (clave A,
 * naturaleza 02) o los intereses de préstamos que recibe (clave B, naturaleza 03), sin entidades
 * que medien el pago ni valores depositados. Ese declarante no está en ninguna de las categorías
 * a) a d) del campo «naturaleza del declarante», así que lleva «S» y, como manda el diseño para ese
 * caso: clave de código y pago a ceros, código emisor, tipo de código, cuenta de valores e ISIN en
 * blanco, penalizaciones, fechas de préstamo, compensaciones y garantías a ceros; y en el tipo 1,
 * «retenciones ingresadas» y «gastos» a ceros. No se generan registros de gastos.
 */

export const MODELO_193_RECORD_LENGTH = 500;
export const MODELO_193_FIRST_YEAR = 2025;

const SUPPORTED: Record<string, string[]> = { A: ["02"], B: ["03"] };

export type Modelo193FileRecipient = {
  taxId: string | null;
  name: string;
  /** Clave de percepción (A dividendos, B intereses) y naturaleza. */
  key: string;
  nature: string;
  incomeCents: number;
  baseCents: number;
  /** Último porcentaje aplicado; si falta, se deduce de la base y la retención. */
  rate: number | null;
  withheldCents: number;
  /** Clave A: fecha de devengo del dividendo (AAAA-MM-DD), la de pago del acuerdo de distribución. */
  accrualDate?: string | null;
  /** Clave A: el perceptor cobró dividendos en varias fechas (el registro lleva la última). */
  severalDates?: boolean;
};

export type Modelo193Input = {
  declarant: Declarant;
  year: number;
  recipients: Modelo193FileRecipient[];
  postalCodes?: Map<string, string | null>;
  defaultProvince?: string | null;
  declarationNumber?: string;
};

export function buildModelo193File(input: Modelo193Input): FiscalFile {
  const { year } = input;
  const problems = declarantProblems(input.declarant);
  if (year < MODELO_193_FIRST_YEAR) problems.push(`El fichero se genera con el diseño del 193 del ejercicio ${MODELO_193_FIRST_YEAR} en adelante.`);
  if (input.recipients.length === 0) problems.push("No hay ningún perceptor de dividendos o intereses con retención en el año: no hay nada que declarar en el 193.");
  const declarationNumber = input.declarationNumber ?? defaultDeclarationNumber("193", year);
  if (!/^193\d{10}$/.test(declarationNumber)) problems.push("El número identificativo de la declaración tiene que tener 13 dígitos y empezar por 193.");

  const withoutNif: string[] = [];
  const withoutProvince: string[] = [];
  const withoutDate: string[] = [];
  const negative: string[] = [];
  const badKey: string[] = [];
  const resolved: Array<{ province: string; rate: number; date: string }> = [];
  for (const recipient of input.recipients) {
    const label = sanitizeText(recipient.name) || "(sin nombre)";
    if (!hasSpanishNifShape(normalizeSpanishNif(recipient.taxId))) withoutNif.push(label);
    const province = resolveRecipientProvince(recipient.taxId, input.postalCodes, input.defaultProvince);
    if (!province) withoutProvince.push(label);
    if (!SUPPORTED[recipient.key]?.includes(recipient.nature)) badKey.push(`${label} (clave ${recipient.key}, naturaleza ${recipient.nature})`);
    if (recipient.incomeCents < 0 || recipient.baseCents < 0 || recipient.withheldCents < 0) negative.push(label);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(recipient.accrualDate ?? "");
    if (recipient.key === "A" && !match) withoutDate.push(label);
    const rate = recipient.rate ?? (recipient.baseCents > 0 ? Math.round((recipient.withheldCents / recipient.baseCents) * 10_000) / 100 : 0);
    // Fecha de devengo (331-338): día, mes y año. Solo en la clave A; en el resto, a ceros.
    resolved.push({ province: province ?? "00", rate, date: recipient.key === "A" && match ? `${match[3]}${match[2]}${match[1]}` : "00000000" });
  }
  problems.push(
    ...listProblems("Estos perceptores no tienen un NIF español válido:", withoutNif),
    ...listProblems(`Falta la provincia del domicilio de estos perceptores: ${MISSING_PROVINCE_HELP} Perceptores:`, withoutProvince),
    ...listProblems("No se ha encontrado la fecha de pago del dividendo (Nóminas y retenciones › Rendimientos del capital) de:", withoutDate),
    ...listProblems("Estos perceptores tienen importes negativos; preséntalos a mano en la sede:", negative),
    ...listProblems("El programa no sabe generar el registro de:", badKey),
  );
  if (problems.length > 0) throw new FiscalFileError(problems);

  const totalBase = input.recipients.reduce((sum, row) => sum + Math.round(row.baseCents), 0);
  const totalWithheld = input.recipients.reduce((sum, row) => sum + Math.round(row.withheldCents), 0);
  const records = [buildRecord(MODELO_193_RECORD_LENGTH, [
    ...informativeDeclarantFields("193", year, input.declarant, declarationNumber),
    { pos: 136, len: 9, value: numeric(input.recipients.length, 9), name: "número total de perceptores" },
    { pos: 145, len: 15, value: amountUnsigned(totalBase, 15), name: "base de retenciones" },
    { pos: 160, len: 15, value: amountUnsigned(totalWithheld, 15), name: "retenciones e ingresos a cuenta" },
    { pos: 175, len: 15, value: numeric(0, 15), name: "retenciones ingresadas" },
    { pos: 220, len: 15, value: numeric(0, 15), name: "gastos" },
    { pos: 235, len: 1, value: "S", name: "naturaleza del declarante" },
  ])];

  input.recipients.forEach((recipient, index) => {
    const extra = resolved[index];
    records.push(buildRecord(MODELO_193_RECORD_LENGTH, [
      ...informativeRecipientFields("193", year, input.declarant, recipient),
      { pos: 77, len: 2, value: extra.province, name: "provincia" },
      { pos: 79, len: 1, value: "0", name: "clave código" },
      { pos: 92, len: 1, value: recipient.key, name: "clave de percepción" },
      { pos: 93, len: 2, value: recipient.nature, name: "naturaleza" },
      { pos: 95, len: 1, value: "0", name: "pago" },
      { pos: 118, len: 4, value: numeric(0, 4), name: "ejercicio de devengo" },
      { pos: 122, len: 1, value: "1", name: "tipo de percepción (dineraria)" },
      { pos: 123, len: 13, value: amountUnsigned(recipient.incomeCents, 13), name: "importe de percepciones" },
      { pos: 139, len: 13, value: numeric(0, 13), name: "importe de reducciones" },
      { pos: 152, len: 13, value: amountUnsigned(recipient.baseCents, 13), name: "base de retenciones" },
      { pos: 165, len: 4, value: percent4(extra.rate), name: "% de retención" },
      { pos: 169, len: 13, value: amountUnsigned(recipient.withheldCents, 13), name: "retenciones e ingresos a cuenta" },
      { pos: 182, len: 11, value: numeric(0, 11), name: "penalizaciones" },
      { pos: 208, len: 1, value: "S", name: "naturaleza del declarante" },
      { pos: 209, len: 8, value: numeric(0, 8), name: "fecha de inicio del préstamo" },
      { pos: 217, len: 8, value: numeric(0, 8), name: "fecha de vencimiento del préstamo" },
      { pos: 225, len: 12, value: numeric(0, 12), name: "compensaciones" },
      { pos: 237, len: 12, value: numeric(0, 12), name: "garantías" },
      { pos: 249, len: 65, value: numeric(0, 65), name: "retenciones ingresadas en el Estado y las Haciendas forales" },
      { pos: 314, len: 1, value: "0", name: "Ceuta, Melilla o La Palma" },
      { pos: 315, len: 7, value: numeric(index + 1, 7), name: "número de orden" },
      { pos: 331, len: 8, value: extra.date, name: "fecha de devengo" },
      // Clave de mercado: «D. Otros» (participaciones y préstamos que no cotizan en ningún mercado).
      { pos: 339, len: 1, value: "D", name: "clave de mercado" },
    ]));
  });

  const warnings = ["El fichero se genera para una sociedad que paga directamente sus dividendos o intereses (naturaleza del declarante «S», clave de mercado «D. Otros»). Si los pagas a través de una entidad depositaria o tus valores cotizan, preséntalo desde la sede."];
  if (input.recipients.some((row) => row.severalDates)) warnings.push("Algún socio cobró dividendos en varias fechas: su registro lleva la fecha del último pago. Si necesitas un registro por reparto, desglósalo en la sede.");
  if (!(input.declarant.phone ?? "").replace(/\D/g, "")) warnings.push("Falta el teléfono de contacto de la empresa (va a ceros): añádelo en Configuración › Empresa o complétalo en la sede.");
  return fiscalFile(`193-${year}.txt`, `${records.join("\r\n")}\r\n`, warnings);
}
