/**
 * Tipos de cambio de referencia del Banco Central Europeo (vía Frankfurter, sin clave). Para un día
 * sin publicación (fin de semana, festivo) devuelve el último anterior. Los históricos no cambian:
 * se guardan en memoria.
 */

const ECB_API = "https://api.frankfurter.dev/v1";
const cache = new Map<string, { rate: number; rateDate: string }>();

export type ExchangeRate = { from: string; to: string; rate: number; rateDate: string; source: "BCE" };

const CURRENCY = /^[A-Z]{3}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function ecbExchangeRate(input: { from: string; to: string; date: string }, fetcher: typeof fetch = fetch): Promise<ExchangeRate> {
  const from = input.from.trim().toUpperCase();
  const to = input.to.trim().toUpperCase();
  if (!CURRENCY.test(from) || !CURRENCY.test(to)) throw new Error("Moneda no válida.");
  const today = new Date().toISOString().slice(0, 10);
  const date = ISO_DATE.test(input.date) && input.date <= today ? input.date : today;
  if (from === to) return { from, to, rate: 1, rateDate: date, source: "BCE" };

  const key = `${from}:${to}:${date}`;
  const cached = cache.get(key);
  if (cached) return { from, to, ...cached, source: "BCE" };

  const response = await fetcher(`${ECB_API}/${date}?base=${from}&symbols=${to}`, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`El BCE no publica cambio de ${from} a ${to}.`);
  const body = await response.json() as { date?: string; rates?: Record<string, number> };
  const rate = body.rates?.[to];
  if (!rate || !Number.isFinite(rate)) throw new Error(`El BCE no publica cambio de ${from} a ${to}.`);
  const result = { rate, rateDate: body.date ?? date };
  // El cambio de hoy puede no estar publicado aún: solo se guardan los días pasados.
  if (date < today) cache.set(key, result);
  return { from, to, ...result, source: "BCE" };
}
