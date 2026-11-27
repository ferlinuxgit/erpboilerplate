/**
 * Parte pura del aviso de ejercicio legalizado (sin base de datos: la usan también los formularios).
 */

/**
 * AVISO DE EJERCICIO LEGALIZADO
 *
 * Los libros presentados a legalizar en el Registro Mercantil (art. 27 del Código de Comercio y
 * art. 18 de la Ley 14/2013) llevan una huella de su contenido: si después se cambia un asiento de
 * ese ejercicio, el Libro Diario del programa deja de coincidir con el legalizado. No se impide
 * (puede hacer falta corregir un error y volver a legalizar), pero quien lo hace debe saberlo: se
 * exige una confirmación explícita y queda en la auditoría.
 */

export type LegalizedBooksNotice = {
  fiscalYearId: string;
  yearCode: string;
  submissionId: string;
  /** Fecha de presentación (`AAAA-MM-DD`). */
  submittedAt: string | null;
  registryName: string | null;
};

/** Ejercicio con libros presentados, con sus fechas, para avisar en los formularios. */
export type LegalizedYearView = { fiscalYearId: string; code: string; from: string; to: string; submittedAt: string | null; registryName: string | null };

function spanishDate(key: string | null) {
  const match = key ? /^(\d{4})-(\d{2})-(\d{2})/.exec(key) : null;
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}

/** Texto del aviso (función pura): el mismo en pantalla y en el error del servidor. */
export function legalizedBooksWarning(notice: { yearCode: string; submittedAt: string | null; registryName?: string | null }) {
  const when = spanishDate(notice.submittedAt);
  const where = notice.registryName?.trim() ? ` en ${notice.registryName.trim()}` : "";
  return `Los libros del ejercicio ${notice.yearCode} se presentaron a legalizar${when ? ` el ${when}` : ""}${where}. Si cambias su contabilidad, el Libro Diario dejará de coincidir con el legalizado y tendrás que volver a generarlo y presentarlo. Lo habitual es corregir el error con un asiento en el ejercicio en curso.`;
}

/** Ejercicio legalizado que contiene el día `AAAA-MM-DD` (función pura, para los formularios). */
export function legalizedYearForDate(years: readonly LegalizedYearView[], dateKey: string | null | undefined) {
  if (!dateKey) return null;
  return years.find((year) => dateKey >= year.from && dateKey <= year.to) ?? null;
}
