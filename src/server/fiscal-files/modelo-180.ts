import {
  alpha, amountUnsigned, amountWithSignField, buildRecord, declarantProblems, defaultDeclarationNumber, fiscalFile, FiscalFileError, hasSpanishNifShape,
  informativeDeclarantFields, informativeProvinceCode, informativeRecipientFields, listProblems, MISSING_PROVINCE_HELP, normalizeSpanishNif, numeric, percent4,
  resolveRecipientProvince, sanitizeText, type Declarant, type FiscalFile,
} from "@/server/fiscal-files/fields";

/**
 * Modelo 180 (resumen anual de retenciones sobre arrendamientos de inmuebles urbanos): registros de
 * 500 posiciones, uno de tipo 1 (declarante) y uno de tipo 2 por perceptor e inmueble. Diseños de
 * registro oficiales «Modelo 180», ejercicio 2023 y siguientes (Orden HFP/1284/2023):
 * https://sede.agenciatributaria.gob.es/static_files/Sede/Disenyo_registro/DR_100_199/archivos_23/DR_Mod_180_2023.pdf
 *
 * El programa guarda la dirección del inmueble como texto libre: viaja entera en «nombre de la vía
 * pública» y no se rellenan el tipo de vía, el número ni el código de municipio del INE.
 */

export const MODELO_180_RECORD_LENGTH = 500;
export const MODELO_180_FIRST_YEAR = 2023;

export type Modelo180FileRecipient = {
  taxId: string | null;
  name: string;
  /** 1 dineraria, 2 en especie. */
  modality: "1" | "2";
  baseCents: number;
  /** Último tipo aplicado (%); si falta, se deduce de la base y la retención. */
  rate: number | null;
  withheldCents: number;
  property: { situation: string; cadastralReference: string | null; address: string | null; postalCode: string | null; city: string | null } | null;
  /** Inmuebles dados de alta para el arrendador (con más de uno hay que repartir a mano). */
  propertyCount?: number;
};

export type Modelo180Input = {
  declarant: Declarant;
  year: number;
  recipients: Modelo180FileRecipient[];
  /** Código postal de la ficha de cada arrendador, por NIF normalizado. */
  postalCodes?: Map<string, string | null>;
  defaultProvince?: string | null;
  declarationNumber?: string;
};

export function buildModelo180File(input: Modelo180Input): FiscalFile {
  const { year } = input;
  const problems = declarantProblems(input.declarant);
  if (year < MODELO_180_FIRST_YEAR) problems.push(`El fichero se genera con el diseño del 180 del ejercicio ${MODELO_180_FIRST_YEAR} en adelante.`);
  if (input.recipients.length === 0) problems.push("No hay ningún arrendador con retenciones en el año: no hay nada que declarar en el 180.");
  const declarationNumber = input.declarationNumber ?? defaultDeclarationNumber("180", year);
  if (!/^180\d{10}$/.test(declarationNumber)) problems.push("El número identificativo de la declaración tiene que tener 13 dígitos y empezar por 180.");

  const withoutNif: string[] = [];
  const withoutProvince: string[] = [];
  const withoutProperty: string[] = [];
  const badProperty: string[] = [];
  const negative: string[] = [];
  const resolved: Array<{ province: string; propertyProvince: string; rate: number; cadastral: string }> = [];
  for (const recipient of input.recipients) {
    const label = sanitizeText(recipient.name) || "(sin nombre)";
    if (!hasSpanishNifShape(normalizeSpanishNif(recipient.taxId))) withoutNif.push(label);
    const province = resolveRecipientProvince(recipient.taxId, input.postalCodes, input.defaultProvince);
    if (!province) withoutProvince.push(label);
    if (recipient.baseCents < 0 || recipient.withheldCents < 0) negative.push(label);
    const property = recipient.property;
    const cadastral = (property?.cadastralReference ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const propertyProvince = informativeProvinceCode(property?.postalCode);
    if (!property) withoutProperty.push(label);
    else {
      const issues: string[] = [];
      if (!["1", "2", "3", "4"].includes(property.situation)) issues.push("situación del inmueble");
      // Situaciones 1 a 3: «inmueble con referencia catastral» (20 caracteres).
      if (property.situation !== "4" && cadastral.length !== 20) issues.push("referencia catastral de 20 caracteres");
      if (!sanitizeText(property.address)) issues.push("dirección");
      if (!sanitizeText(property.city)) issues.push("municipio");
      if (!propertyProvince) issues.push("código postal");
      if (issues.length > 0) badProperty.push(`${label} (falta: ${issues.join(", ")})`);
    }
    const rate = recipient.rate ?? (recipient.baseCents > 0 ? Math.round((recipient.withheldCents / recipient.baseCents) * 10_000) / 100 : 0);
    resolved.push({ province: province ?? "00", propertyProvince: propertyProvince ?? "00", rate, cadastral });
  }
  problems.push(
    ...listProblems("Estos arrendadores no tienen un NIF español válido:", withoutNif),
    ...listProblems(`Falta la provincia del domicilio de estos arrendadores: ${MISSING_PROVINCE_HELP} Arrendadores:`, withoutProvince),
    ...listProblems("Falta dar de alta el inmueble alquilado (Nóminas y retenciones › Inmuebles alquilados) de:", withoutProperty),
    ...listProblems("Completa los datos del inmueble alquilado de:", badProperty),
    ...listProblems("Estos arrendadores tienen base o retención negativa en el año; preséntalos a mano en la sede:", negative),
  );
  if (problems.length > 0) throw new FiscalFileError(problems);

  const totalBase = input.recipients.reduce((sum, row) => sum + Math.round(row.baseCents), 0);
  const totalWithheld = input.recipients.reduce((sum, row) => sum + Math.round(row.withheldCents), 0);
  const records = [buildRecord(MODELO_180_RECORD_LENGTH, [
    ...informativeDeclarantFields("180", year, input.declarant, declarationNumber),
    { pos: 136, len: 9, value: numeric(input.recipients.length, 9), name: "número total de perceptores" },
    { pos: 145, len: 16, value: amountWithSignField(totalBase, 15), name: "base de retenciones" },
    { pos: 161, len: 15, value: amountUnsigned(totalWithheld, 15), name: "retenciones e ingresos a cuenta" },
  ])];

  input.recipients.forEach((recipient, index) => {
    const property = recipient.property as NonNullable<Modelo180FileRecipient["property"]>;
    const extra = resolved[index];
    records.push(buildRecord(MODELO_180_RECORD_LENGTH, [
      ...informativeRecipientFields("180", year, input.declarant, recipient),
      { pos: 76, len: 2, value: extra.province, name: "provincia del perceptor" },
      { pos: 78, len: 1, value: recipient.modality, name: "modalidad" },
      { pos: 79, len: 14, value: amountWithSignField(recipient.baseCents, 13), name: "base de retenciones" },
      { pos: 93, len: 4, value: percent4(extra.rate), name: "% de retención" },
      { pos: 97, len: 13, value: amountUnsigned(recipient.withheldCents, 13), name: "retenciones e ingresos a cuenta" },
      { pos: 110, len: 4, value: numeric(0, 4), name: "ejercicio de devengo" },
      { pos: 114, len: 1, value: property.situation, name: "situación del inmueble" },
      { pos: 115, len: 20, value: alpha(property.situation === "4" ? "" : extra.cadastral, 20), name: "referencia catastral" },
      { pos: 140, len: 50, value: alpha(property.address, 50), name: "nombre de la vía pública" },
      { pos: 286, len: 30, value: alpha(property.city, 30), name: "municipio" },
      { pos: 321, len: 2, value: extra.propertyProvince, name: "provincia del inmueble" },
      { pos: 323, len: 5, value: (property.postalCode ?? "").replace(/\s/g, ""), name: "código postal del inmueble" },
    ]));
  });

  const warnings = ["La dirección de cada inmueble va entera en «nombre de la vía pública» (el programa la guarda como texto libre): en la sede, separa el tipo de vía y el número, y añade el código de municipio si te lo pide."];
  if (input.recipients.some((row) => (row.propertyCount ?? 1) > 1)) warnings.push("Algún arrendador tiene varios inmuebles: el 180 lleva un registro por inmueble y el fichero solo incluye el primero con todo el alquiler. Repártelo en la sede.");
  if (!(input.declarant.phone ?? "").replace(/\D/g, "")) warnings.push("Falta el teléfono de contacto de la empresa (va a ceros): añádelo en Configuración › Empresa o complétalo en la sede.");
  return fiscalFile(`180-${year}.txt`, `${records.join("\r\n")}\r\n`, warnings);
}
