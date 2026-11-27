import {
  alpha, amountUnsigned, amountWithSignField, buildRecord, declarantProblems, fiscalFile, FiscalFileError, hasSpanishNifShape,
  nifField, normalizeSpanishNif, numeric, sanitizeText, type Declarant, type FiscalFile,
} from "@/server/fiscal-files/fields";

/**
 * Modelo 347 (declaración anual de operaciones con terceras personas): fichero de registros de
 * 500 posiciones (tipo 1 del declarante y un tipo 2 por declarado). Diseño lógico oficial
 * «347.pdf», «Ejercicio 2025 y siguientes», modificado por la Orden HAC/1431/2025, de 3 de diciembre:
 * https://sede.agenciatributaria.gob.es/static_files/Sede/Disenyo_registro/DR_300_399/archivos/347.pdf
 *
 * Solo se generan registros de declarado con las claves A (compras) y B (ventas), que son las que
 * calcula el programa. No se generan registros de inmueble (arrendamientos de locales), ni las
 * marcas de seguro, criterio de caja, inversión del sujeto pasivo o depósito distinto del aduanero.
 */

export const MODELO_347_RECORD_LENGTH = 500;
export const MODELO_347_FIRST_YEAR = 2025;

/** Estados miembros de la UE con el prefijo que usa su NIF-IVA (Grecia: EL). */
const EU_VAT_PREFIXES = new Set(["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "FI", "FR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "XI"]);

export type Modelo347Party = {
  /** A: adquisiciones (proveedor). B: entregas y prestaciones (cliente). */
  key: "A" | "B";
  taxId: string | null;
  name: string;
  /** País de la ficha del tercero (ISO de dos letras); sin dato se entiende España. */
  countryCode?: string | null;
  /** Código postal del domicilio (de él sale la provincia). */
  postalCode?: string | null;
  amountCents: number;
  /** Importe de cada trimestre natural, con el IVA incluido. */
  quartersCents: [number, number, number, number];
  /** Cobros en metálico de más de 6.000 € (solo clientes). */
  cashCents?: number;
};

export type Modelo347Input = {
  declarant: Declarant;
  year: number;
  parties: Modelo347Party[];
  /** Número identificativo de la declaración (13 dígitos que empiezan por 347). */
  declarationNumber?: string;
};

/** Provincia (dos dígitos) a partir del código postal español; null si no es un código válido. */
export function provinceFromPostalCode(postalCode: string | null | undefined) {
  const match = /^(\d{2})\d{3}$/.exec((postalCode ?? "").replace(/\s/g, ""));
  if (!match) return null;
  const province = Number(match[1]);
  return province >= 1 && province <= 52 ? match[1] : null;
}

type PartyIdentity = { nif: string; province: string; country: string; euId: string };

function identifyParty(party: Modelo347Party): PartyIdentity | { problem: string } {
  const country = (party.countryCode ?? "ES").toUpperCase() === "GR" ? "EL" : (party.countryCode ?? "ES").toUpperCase();
  const cleaned = (party.taxId ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const spanish = normalizeSpanishNif(cleaned);
  const label = sanitizeText(party.name) || "(sin nombre)";
  if (country === "ES") {
    if (!hasSpanishNifShape(spanish)) return { problem: `${label}: falta el NIF o no tiene forma de NIF español («${party.taxId ?? ""}»).` };
    const province = provinceFromPostalCode(party.postalCode);
    if (!province) return { problem: `${label}: falta el código postal en su ficha (hace falta para indicar la provincia).` };
    return { nif: nifField(spanish), province, country: "  ", euId: " ".repeat(17) };
  }
  // No residente sin establecimiento permanente: provincia 99 y país de residencia. Si tiene NIF
  // español se indica; si es de la UE, su NIF-IVA va en el campo de operador comunitario (los dos
  // campos son excluyentes).
  if (hasSpanishNifShape(spanish) && !EU_VAT_PREFIXES.has(cleaned.slice(0, 2))) return { nif: nifField(spanish), province: "99", country: alpha(country, 2), euId: " ".repeat(17) };
  if (EU_VAT_PREFIXES.has(country) && cleaned) {
    const number = cleaned.startsWith(country) ? cleaned.slice(2) : cleaned;
    return { nif: " ".repeat(9), province: "99", country: alpha(country, 2), euId: `${country}${alpha(number, 15)}` };
  }
  return { nif: " ".repeat(9), province: "99", country: alpha(country, 2), euId: " ".repeat(17) };
}

export function buildModelo347File(input: Modelo347Input): FiscalFile {
  const problems = declarantProblems(input.declarant);
  if (input.year < MODELO_347_FIRST_YEAR) problems.push(`El fichero se genera con el diseño del 347 del ejercicio ${MODELO_347_FIRST_YEAR} en adelante.`);
  if (input.parties.length === 0) problems.push("No hay ningún tercero que supere los 3.005,06 € en el año: no hay nada que declarar en el 347.");
  const declarationNumber = input.declarationNumber ?? `347${String(input.year).padStart(4, "0")}000001`;
  if (!/^347\d{10}$/.test(declarationNumber)) problems.push("El número identificativo de la declaración tiene que tener 13 dígitos y empezar por 347.");

  const identities: Array<PartyIdentity | null> = [];
  const partyProblems: string[] = [];
  for (const party of input.parties) {
    const identity = identifyParty(party);
    if ("problem" in identity) {
      partyProblems.push(identity.problem);
      identities.push(null);
      continue;
    }
    identities.push(identity);
    const quarters = party.quartersCents.reduce((total, cents) => total + Math.round(cents), 0);
    if (quarters !== Math.round(party.amountCents)) partyProblems.push(`${sanitizeText(party.name)}: la suma de los trimestres no coincide con el importe anual.`);
    if ((party.cashCents ?? 0) < 0) partyProblems.push(`${sanitizeText(party.name)}: el importe cobrado en metálico no puede ser negativo.`);
  }
  if (partyProblems.length > 0) {
    problems.push(`Completa estos datos en la ficha de cada cliente o proveedor: ${partyProblems.slice(0, 8).join(" ")}${partyProblems.length > 8 ? ` (y ${partyProblems.length - 8} más).` : ""}`);
  }
  if (problems.length > 0) throw new FiscalFileError(problems);

  const year = numeric(input.year, 4);
  const nif = nifField(input.declarant.taxId);
  const phone = (input.declarant.phone ?? "").replace(/\D/g, "").slice(-9);
  const total = input.parties.reduce((sum, party) => sum + Math.round(party.amountCents), 0);

  const records = [buildRecord(MODELO_347_RECORD_LENGTH, [
    { pos: 1, len: 1, value: "1" },
    { pos: 2, len: 3, value: "347" },
    { pos: 5, len: 4, value: year },
    { pos: 9, len: 9, value: nif, name: "NIF del declarante" },
    { pos: 18, len: 40, value: alpha(input.declarant.name, 40) },
    { pos: 58, len: 1, value: "T", name: "tipo de soporte" },
    { pos: 59, len: 9, value: phone.padStart(9, "0"), name: "teléfono" },
    { pos: 68, len: 40, value: alpha(input.declarant.contactName ?? input.declarant.name, 40) },
    { pos: 108, len: 13, value: declarationNumber },
    { pos: 123, len: 13, value: numeric(0, 13), name: "declaración anterior" },
    { pos: 136, len: 9, value: numeric(input.parties.length, 9), name: "número de declarados" },
    { pos: 145, len: 16, value: amountWithSignField(total, 15), name: "importe total anual" },
    { pos: 161, len: 9, value: numeric(0, 9), name: "número de inmuebles" },
    { pos: 170, len: 16, value: amountWithSignField(0, 15), name: "importe de arrendamientos" },
  ])];

  input.parties.forEach((party, index) => {
    const identity = identities[index] as PartyIdentity;
    const cash = Math.round(party.cashCents ?? 0);
    const fields = [
      { pos: 1, len: 1, value: "2" },
      { pos: 2, len: 3, value: "347" },
      { pos: 5, len: 4, value: year },
      { pos: 9, len: 9, value: nif },
      { pos: 18, len: 9, value: identity.nif, name: "NIF del declarado" },
      { pos: 36, len: 40, value: alpha(party.name, 40) },
      { pos: 76, len: 1, value: "D", name: "tipo de hoja" },
      { pos: 77, len: 2, value: identity.province, name: "provincia" },
      { pos: 79, len: 2, value: identity.country, name: "país" },
      { pos: 82, len: 1, value: party.key, name: "clave de operación" },
      { pos: 83, len: 16, value: amountWithSignField(party.amountCents, 15), name: "importe anual" },
      { pos: 101, len: 15, value: amountUnsigned(cash, 15, "importe percibido en metálico") },
      { pos: 116, len: 16, value: amountWithSignField(0, 15), name: "transmisiones de inmuebles" },
      // Ejercicio de las operaciones que originan el cobro en metálico (ceros si no hay cobro).
      { pos: 132, len: 4, value: cash > 0 ? year : numeric(0, 4), name: "ejercicio del cobro en metálico" },
      { pos: 264, len: 17, value: identity.euId, name: "NIF operador comunitario" },
      { pos: 284, len: 16, value: amountWithSignField(0, 15), name: "criterio de caja" },
      { pos: 300, len: 6, value: numeric(0, 6), name: "convocatoria BDNS" },
    ];
    // Cuatro trimestres: operaciones (signo + 15) e inmuebles (signo + 15), 32 posiciones por trimestre.
    party.quartersCents.forEach((cents, quarter) => {
      fields.push(
        { pos: 136 + quarter * 32, len: 16, value: amountWithSignField(cents, 15), name: `operaciones del trimestre ${quarter + 1}` },
        { pos: 152 + quarter * 32, len: 16, value: amountWithSignField(0, 15), name: `inmuebles del trimestre ${quarter + 1}` },
      );
    });
    records.push(buildRecord(MODELO_347_RECORD_LENGTH, fields));
  });

  const warnings = ["El fichero lleva las claves A (compras) y B (ventas). Arrendamientos de locales, operaciones de seguro, criterio de caja e inversión del sujeto pasivo no se marcan: revísalos en la sede si te afectan."];
  if (!phone) warnings.push("Falta el teléfono de contacto de la empresa (va a ceros): añádelo en Configuración › Empresa o complétalo en la sede.");
  return fiscalFile(`347-${input.year}.txt`, `${records.join("\r\n")}\r\n`, warnings);
}
