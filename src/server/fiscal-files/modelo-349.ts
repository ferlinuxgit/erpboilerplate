import {
  alpha, amountUnsigned, buildRecord, declarantProblems, fiscalFile, FiscalFileError, nifField, numeric, sanitizeText,
  type Declarant, type FilePeriod, type FiscalFile,
} from "@/server/fiscal-files/fields";

/**
 * Modelo 349 (declaración recapitulativa de operaciones intracomunitarias): fichero de registros de
 * 500 posiciones (tipo 1 del declarante y un tipo 2 por operador y clave). Diseño lógico oficial
 * «DR_Anexo_349.pdf» (anexo de la Orden HAC/174/2020, de 4 de febrero; ejercicio 2020 y siguientes):
 * https://sede.agenciatributaria.gob.es/static_files/Sede/Disenyo_registro/DR_300_399/archivos_20/DR_Anexo_349.pdf
 *
 * Se generan los registros de operador con las claves que calcula el programa (E, A, S e I). Los
 * registros de rectificaciones piden la base rectificada y la declarada anteriormente, que el
 * programa no guarda: si el periodo tiene rectificaciones de otros periodos no se genera el fichero.
 */

export const MODELO_349_RECORD_LENGTH = 500;

export type Modelo349FileOperator = {
  key: "E" | "A" | "S" | "I";
  /** NIF-IVA con el prefijo del país (FR12345678901, EL123456789…). */
  taxId: string;
  name: string;
  amountCents: number;
};

export type Modelo349Input = {
  declarant: Declarant;
  period: FilePeriod;
  operators: Modelo349FileOperator[];
  /** Número de rectificaciones de periodos anteriores que tiene el modelo (bloquean el fichero). */
  rectificationCount?: number;
  /** Número identificativo de la declaración (13 dígitos que empiezan por 349). */
  declarationNumber?: string;
};

export function buildModelo349File(input: Modelo349Input): FiscalFile {
  const { period } = input;
  const problems = declarantProblems(input.declarant);
  if (period.code === "0A") problems.push("El modelo 349 es mensual o trimestral (desde 2020 no hay declaración anual): el periodo no es válido.");
  if ((input.rectificationCount ?? 0) > 0) problems.push("El periodo tiene rectificaciones de operaciones de periodos anteriores. El fichero de la AEAT pide la base rectificada y la declarada en su día, que el programa no guarda: presenta este 349 a mano en la sede.");
  if (input.operators.length === 0) problems.push("No hay operaciones intracomunitarias en el periodo: no hay nada que declarar en el 349.");
  const declarationNumber = input.declarationNumber ?? `349${String(period.year).padStart(4, "0")}${period.code.replace("T", "0").padStart(2, "0")}0001`;
  if (!/^349\d{10}$/.test(declarationNumber)) problems.push("El número identificativo de la declaración tiene que tener 13 dígitos y empezar por 349.");
  const operatorProblems: string[] = [];
  for (const operator of input.operators) {
    const label = sanitizeText(operator.name) || "(sin nombre)";
    if (!/^[A-Z]{2}[0-9A-Z]{2,15}$/.test(operator.taxId) || operator.taxId.startsWith("ES")) operatorProblems.push(`${label}: falta el NIF-IVA de otro país de la UE («${operator.taxId}»).`);
    if (operator.amountCents < 0) operatorProblems.push(`${label}: el importe del periodo es negativo (las rectificativas superan las operaciones); hay que declararlo como rectificación en la sede.`);
  }
  if (operatorProblems.length > 0) problems.push(`Revisa estos operadores: ${operatorProblems.slice(0, 8).join(" ")}${operatorProblems.length > 8 ? ` (y ${operatorProblems.length - 8} más).` : ""}`);
  if (problems.length > 0) throw new FiscalFileError(problems);

  const year = numeric(period.year, 4);
  const nif = nifField(input.declarant.taxId);
  const phone = (input.declarant.phone ?? "").replace(/\D/g, "").slice(-9);
  const total = input.operators.reduce((sum, operator) => sum + Math.round(operator.amountCents), 0);

  const records = [buildRecord(MODELO_349_RECORD_LENGTH, [
    { pos: 1, len: 1, value: "1" },
    { pos: 2, len: 3, value: "349" },
    { pos: 5, len: 4, value: year },
    { pos: 9, len: 9, value: nif, name: "NIF del declarante" },
    { pos: 18, len: 40, value: alpha(input.declarant.name, 40) },
    { pos: 59, len: 9, value: phone.padStart(9, "0"), name: "teléfono" },
    { pos: 68, len: 40, value: alpha(input.declarant.contactName ?? input.declarant.name, 40) },
    { pos: 108, len: 13, value: declarationNumber },
    { pos: 123, len: 13, value: numeric(0, 13), name: "declaración anterior" },
    { pos: 136, len: 2, value: period.code, name: "periodo" },
    { pos: 138, len: 9, value: numeric(input.operators.length, 9), name: "número de operadores" },
    { pos: 147, len: 15, value: amountUnsigned(total, 15, "importe de las operaciones intracomunitarias") },
    { pos: 162, len: 9, value: numeric(0, 9), name: "número de rectificaciones" },
    { pos: 171, len: 15, value: amountUnsigned(0, 15), name: "importe de las rectificaciones" },
  ])];

  for (const operator of input.operators) {
    records.push(buildRecord(MODELO_349_RECORD_LENGTH, [
      { pos: 1, len: 1, value: "2" },
      { pos: 2, len: 3, value: "349" },
      { pos: 5, len: 4, value: year },
      { pos: 9, len: 9, value: nif },
      { pos: 76, len: 2, value: operator.taxId.slice(0, 2), name: "código de país" },
      { pos: 78, len: 15, value: alpha(operator.taxId.slice(2), 15), name: "NIF del operador" },
      { pos: 93, len: 40, value: alpha(operator.name, 40) },
      { pos: 133, len: 1, value: operator.key, name: "clave de operación" },
      { pos: 134, len: 13, value: amountUnsigned(operator.amountCents, 13, "base imponible") },
    ]));
  }

  const warnings = ["Comprueba cada NIF-IVA en el censo VIES antes de presentar: la sede rechaza los operadores que no figuran en él."];
  if (!phone) warnings.push("Falta el teléfono de contacto de la empresa (va a ceros): añádelo en Configuración › Empresa o complétalo en la sede.");
  return fiscalFile(`349-${period.year}-${period.code}.txt`, `${records.join("\r\n")}\r\n`, warnings);
}
