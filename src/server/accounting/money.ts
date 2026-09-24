/**
 * Utilidades de importes en céntimos enteros para la contabilidad.
 * Todas las sumas y comprobaciones de cuadre se hacen en enteros para evitar
 * errores de coma flotante (p. ej. 0,1 + 0,2).
 */

/** Redondeo "half away from zero" a céntimos, robusto frente a 1.005 * 100 = 100.4999… */
export function toCents(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const amount = typeof value === "number" ? value : Number(String(value).trim().replace(",", "."));
  if (!Number.isFinite(amount)) return 0;
  const scaled = Number((Math.abs(amount) * 100).toFixed(6));
  const rounded = Math.round(scaled);
  return amount < 0 ? -rounded : rounded;
}

export function centsToAmount(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function centsToNumber(cents: number): number {
  return Number(centsToAmount(cents));
}

/** Aplica un porcentaje (0-100, admite decimales) a un importe en céntimos con redondeo comercial. */
export function applyPct(cents: number, pct: number): number {
  const clamped = Math.min(Math.max(Number.isFinite(pct) ? pct : 0, 0), 100);
  const raw = (cents * clamped) / 100;
  const scaled = Number(Math.abs(raw).toFixed(6));
  const rounded = Math.round(scaled);
  return raw < 0 ? -rounded : rounded;
}

export function sumCents(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
