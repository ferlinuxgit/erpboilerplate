/**
 * Plurales en español para textos de interfaz ("1 día", "3 días", "1 modelo", "2 modelos").
 * Si no se indica el plural se forma con la regla básica: vocal átona → +s; consonante → +es.
 * Para palabras irregulares o con tilde que cambia ("declaración" → "declaraciones") pasa el plural.
 */
export function pluralize(count: number, singular: string, plural?: string) {
  return Math.abs(count) === 1 ? singular : (plural ?? defaultPlural(singular));
}

/** Número formateado en es-ES + palabra en singular o plural: "1 día", "1.200 facturas". */
export function formatCount(count: number, singular: string, plural?: string) {
  return `${new Intl.NumberFormat("es-ES").format(count)} ${pluralize(count, singular, plural)}`;
}

/** "Quedan 3 días", "Queda 1 día", "Vence hoy", "Venció ayer", "Venció hace 5 días". */
export function describeDaysUntil(days: number, { past = "Venció", future = "Queda" }: { past?: string; future?: string } = {}) {
  if (days === 0) return "Vence hoy";
  if (days === -1) return `${past} ayer`;
  if (days < 0) return `${past} hace ${formatCount(Math.abs(days), "día")}`;
  const verb = future === "Queda" ? (days === 1 ? "Queda" : "Quedan") : future;
  return `${verb} ${formatCount(days, "día")}`;
}

function defaultPlural(singular: string) {
  if (/[aeiouáéó]$/i.test(singular)) return `${singular}s`;
  if (/z$/i.test(singular)) return `${singular.slice(0, -1)}ces`;
  if (/[íú]$/i.test(singular)) return `${singular}es`;
  return `${singular}es`;
}
