/**
 * ¿Qué modelo de cuentas anuales le corresponde a la empresa? (funciones puras)
 *
 * Límites vigentes, contrastados con el texto consolidado del BOE (consulta de 27-11-2026):
 * - Balance y estado de cambios en el patrimonio neto abreviados (art. 257 de la Ley de Sociedades
 *   de Capital) y Plan General de Contabilidad de PYMES (art. 2 del Real Decreto 1515/2007):
 *   activo ≤ 4.000.000 €, cifra de negocios ≤ 8.000.000 € y plantilla media ≤ 50.
 * - Cuenta de pérdidas y ganancias abreviada (art. 258 LSC): activo ≤ 11.400.000 €, cifra de
 *   negocios ≤ 22.800.000 € y plantilla media ≤ 250.
 * - Criterios de microempresa (art. 4 del RD 1515/2007): 1.000.000 €, 2.000.000 € y 10.
 *
 * En todos los casos hay que cumplir al menos DOS de las tres circunstancias durante DOS ejercicios
 * consecutivos a la fecha de cierre (y la facultad se pierde al dejar de cumplirlas dos ejercicios
 * seguidos). En el primer ejercicio basta con cumplirlas al cierre de ese ejercicio. Si la empresa
 * forma parte de un grupo, los importes se suman con los del grupo: eso no se puede saber aquí.
 */

export type SizeLimits = { assets: number; turnover: number; employees: number };

export const SIZE_LIMITS = {
  micro: { assets: 1_000_000, turnover: 2_000_000, employees: 10 },
  small: { assets: 4_000_000, turnover: 8_000_000, employees: 50 },
  abbreviatedIncome: { assets: 11_400_000, turnover: 22_800_000, employees: 250 },
} as const satisfies Record<string, SizeLimits>;

export type SizeFigures = {
  /** Total de las partidas del activo al cierre. */
  assets: number;
  /** Importe neto de la cifra de negocios del ejercicio. */
  turnover: number;
  /** Número medio de trabajadores; null si no se ha indicado. */
  employees: number | null;
};

/** Circunstancias cumplidas (de 0 a 3). Sin dato de plantilla solo se cuentan las otras dos. */
export function circumstancesMet(figures: SizeFigures, limits: SizeLimits) {
  return Number(figures.assets <= limits.assets) + Number(figures.turnover <= limits.turnover) + Number(figures.employees !== null && figures.employees <= limits.employees);
}

/** ¿El ejercicio cumple el límite? `null` si depende de la plantilla y no se conoce. */
export function yearMeetsLimits(figures: SizeFigures, limits: SizeLimits): boolean | null {
  const met = circumstancesMet(figures, limits);
  if (met >= 2) return true;
  // Con una sola circunstancia cumplida, la plantilla (desconocida) podría ser la segunda.
  if (figures.employees === null && met === 1) return null;
  return false;
}

/**
 * Regla de los dos ejercicios: se puede usar el modelo reducido si el ejercicio actual y el
 * anterior cumplen; en el primer ejercicio basta el actual. (No se puede reconstruir aquí el
 * historial completo: quien ya tenía la facultad solo la pierde tras dos ejercicios sin cumplir,
 * y eso se avisa en el texto.)
 */
export function meetsForTwoYears(current: SizeFigures, previous: SizeFigures | null, limits: SizeLimits): boolean | null {
  const now = yearMeetsLimits(current, limits);
  if (!previous) return now;
  const before = yearMeetsLimits(previous, limits);
  if (now === null || before === null) return null;
  // Un ejercicio cumple y el otro no: depende de los anteriores (ver `transition`).
  return now === before ? now : null;
}

export type SizeAssessment = {
  /** Puede formular balance abreviado y aplicar el PGC de PYMES. */
  small: boolean | null;
  /** Puede formular cuenta de pérdidas y ganancias abreviada. */
  abbreviatedIncome: boolean | null;
  /** Puede aplicar los criterios de microempresa (si opta por el PGC de PYMES). */
  micro: boolean | null;
  /** Modelo recomendado con los datos disponibles. */
  recommended: "abbreviated" | "normal";
  /** Un ejercicio cumple y el otro no: la respuesta depende de los ejercicios anteriores. */
  transition: boolean;
  missingEmployees: boolean;
  messages: string[];
};

const number = (value: number) => new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0, useGrouping: "always" }).format(value);

export function assessCompanySize(current: SizeFigures, previous: SizeFigures | null): SizeAssessment {
  const small = meetsForTwoYears(current, previous, SIZE_LIMITS.small);
  const abbreviatedIncome = meetsForTwoYears(current, previous, SIZE_LIMITS.abbreviatedIncome);
  const micro = meetsForTwoYears(current, previous, SIZE_LIMITS.micro);
  const missingEmployees = current.employees === null || (previous !== null && previous.employees === null);
  const transition = previous !== null
    && yearMeetsLimits(current, SIZE_LIMITS.small) !== yearMeetsLimits(previous, SIZE_LIMITS.small)
    && yearMeetsLimits(current, SIZE_LIMITS.small) !== null
    && yearMeetsLimits(previous, SIZE_LIMITS.small) !== null;
  const messages: string[] = [];
  const limits = SIZE_LIMITS.small;

  if (small === true) {
    messages.push(`Cumples al menos dos de los tres límites (activo ≤ ${number(limits.assets)} €, cifra de negocios ≤ ${number(limits.turnover)} € y plantilla media ≤ ${limits.employees})${previous ? " en este ejercicio y en el anterior" : ""}: puedes presentar balance y cuenta de pérdidas y ganancias abreviados, o aplicar el Plan de PYMES.`);
    if (micro === true) messages.push("También entras en los límites de microempresa (1.000.000 €, 2.000.000 € y 10 trabajadores): si optas por el Plan de PYMES puedes aplicar sus criterios simplificados.");
  } else if (small === false && !transition) {
    messages.push(`Superas dos de los tres límites del balance abreviado (activo ${number(limits.assets)} €, cifra de negocios ${number(limits.turnover)} € y plantilla ${limits.employees})${previous ? " en este ejercicio y en el anterior" : ""}: te corresponde el balance en modelo normal, con estado de cambios en el patrimonio neto y estado de flujos de efectivo.`);
    if (abbreviatedIncome === true) messages.push(`La cuenta de pérdidas y ganancias sí puede ser abreviada (límites de ${number(SIZE_LIMITS.abbreviatedIncome.assets)} €, ${number(SIZE_LIMITS.abbreviatedIncome.turnover)} € y ${SIZE_LIMITS.abbreviatedIncome.employees} trabajadores).`);
  } else if (transition) {
    messages.push("Uno de los dos últimos ejercicios cumple los límites del balance abreviado y el otro no. El modelo no cambia hasta que la situación se repite dos ejercicios seguidos: mantén el que venías usando.");
  } else {
    messages.push("Con los importes del balance no basta para decidir: indica la plantilla media del ejercicio para completar la comprobación.");
  }
  if (missingEmployees && small !== null) messages.push("No has indicado la plantilla media; se ha decidido solo con el activo y la cifra de negocios.");
  messages.push("Si la empresa pertenece a un grupo hay que sumar los importes del grupo, y las entidades de interés público y las que emiten valores cotizados no pueden usar los modelos reducidos. Confírmalo con tu asesor.");

  return { small, abbreviatedIncome, micro, recommended: small === false && !transition ? "normal" : "abbreviated", transition, missingEmployees, messages };
}
