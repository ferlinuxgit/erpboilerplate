/**
 * Previsión de tesorería (funciones puras): saldo actual + cobros y pagos por vencimiento,
 * agrupados por semanas, con saldo acumulado.
 */

export type ForecastItem = {
  id: string;
  kind: "receivable" | "payable" | "recurring";
  label: string;
  partnerName: string;
  /** Con signo: positivo entra dinero, negativo sale. */
  amount: number;
  dueDate: Date | null;
  href?: string | null;
};

export type ForecastBucketItem = ForecastItem & { overdue: boolean };

export type ForecastBucket = {
  index: number;
  start: Date;
  /** Último día incluido. */
  end: Date;
  inflow: number;
  outflow: number;
  net: number;
  closingBalance: number;
  items: ForecastBucketItem[];
};

export type ForecastResult = {
  openingBalance: number;
  horizonDays: number;
  buckets: ForecastBucket[];
  undated: ForecastItem[];
  overdue: { count: number; inflow: number; outflow: number };
  beyond: { count: number; net: number };
  totals: { inflow: number; outflow: number };
  finalBalance: number;
  lowest: { balance: number; bucketIndex: number };
};

export const FORECAST_HORIZONS = [30, 60, 90] as const;
const DAY = 86_400_000;

function cents(value: number) {
  return Math.round(value * 100);
}

/** Medianoche UTC del día (las fechas de negocio se guardan a medianoche UTC). */
export function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Reparte los documentos en semanas desde hoy. Lo vencido y no cobrado/pagado se lleva a la
 * primera semana (marcado como vencido); lo que vence después del horizonte se resume aparte y
 * lo que no tiene vencimiento se lista sin sumarlo al saldo, para que el usuario lo complete.
 */
export function buildForecast(input: { openingBalance: number; today: Date; horizonDays: number; items: ForecastItem[] }): ForecastResult {
  const today = startOfUtcDay(input.today);
  const horizonDays = Math.max(7, Math.round(input.horizonDays));
  const weekCount = Math.ceil(horizonDays / 7);
  const horizonEnd = new Date(today.getTime() + horizonDays * DAY);
  const buckets: ForecastBucket[] = Array.from({ length: weekCount }, (_, index) => {
    const start = new Date(today.getTime() + index * 7 * DAY);
    const lastDay = new Date(Math.min(start.getTime() + 6 * DAY, horizonEnd.getTime() - DAY));
    return { index, start, end: lastDay, inflow: 0, outflow: 0, net: 0, closingBalance: 0, items: [] };
  });
  const bucketCents = buckets.map(() => ({ inflow: 0, outflow: 0 }));
  const undated: ForecastItem[] = [];
  const overdue = { count: 0, inflow: 0, outflow: 0 };
  const beyond = { count: 0, net: 0 };

  for (const item of input.items) {
    if (cents(item.amount) === 0) continue;
    if (!item.dueDate) {
      undated.push(item);
      continue;
    }
    const due = startOfUtcDay(item.dueDate);
    if (due.getTime() >= horizonEnd.getTime()) {
      beyond.count += 1;
      beyond.net += cents(item.amount);
      continue;
    }
    const isOverdue = due.getTime() < today.getTime();
    const index = isOverdue ? 0 : Math.min(Math.floor((due.getTime() - today.getTime()) / (7 * DAY)), weekCount - 1);
    buckets[index].items.push({ ...item, overdue: isOverdue });
    if (item.amount > 0) bucketCents[index].inflow += cents(item.amount);
    else bucketCents[index].outflow += -cents(item.amount);
    if (isOverdue) {
      overdue.count += 1;
      if (item.amount > 0) overdue.inflow += cents(item.amount);
      else overdue.outflow += -cents(item.amount);
    }
  }

  let running = cents(input.openingBalance);
  let lowest = { balance: running, bucketIndex: -1 };
  let totalIn = 0;
  let totalOut = 0;
  buckets.forEach((bucket, index) => {
    const { inflow, outflow } = bucketCents[index];
    running += inflow - outflow;
    totalIn += inflow;
    totalOut += outflow;
    bucket.inflow = inflow / 100;
    bucket.outflow = outflow / 100;
    bucket.net = (inflow - outflow) / 100;
    bucket.closingBalance = running / 100;
    bucket.items.sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0));
    if (running < lowest.balance) lowest = { balance: running, bucketIndex: index };
  });

  return {
    openingBalance: cents(input.openingBalance) / 100,
    horizonDays,
    buckets,
    undated,
    overdue: { count: overdue.count, inflow: overdue.inflow / 100, outflow: overdue.outflow / 100 },
    beyond: { count: beyond.count, net: beyond.net / 100 },
    totals: { inflow: totalIn / 100, outflow: totalOut / 100 },
    finalBalance: running / 100,
    lowest: { balance: lowest.balance / 100, bucketIndex: lowest.bucketIndex },
  };
}

/** Mismo día del mes `months` meses después (31 de agosto + 1 → 30 de septiembre). */
function addMonthsClamped(date: Date, months: number) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)));
}

export type RecurringHistoryRow = { ruleId: string; ruleName: string; postedAt: Date; amount: number };

/**
 * Pagos/cobros periódicos conocidos: movimientos asignados con la misma regla al menos dos veces
 * con un intervalo mensual (25-35 días). Se proyectan cada mes con el importe medio.
 */
export function projectRecurring(history: RecurringHistoryRow[], today: Date, horizonDays: number): ForecastItem[] {
  const byRule = new Map<string, RecurringHistoryRow[]>();
  for (const row of history) byRule.set(row.ruleId, [...(byRule.get(row.ruleId) ?? []), row]);
  const start = startOfUtcDay(today);
  const end = new Date(start.getTime() + horizonDays * DAY);
  const items: ForecastItem[] = [];
  for (const [ruleId, rows] of byRule) {
    if (rows.length < 2) continue;
    const sorted = [...rows].sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
    const gaps = sorted.slice(1).map((row, index) => (row.postedAt.getTime() - sorted[index].postedAt.getTime()) / DAY);
    const averageGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    if (averageGap < 25 || averageGap > 35) continue;
    const averageCents = Math.round(sorted.reduce((sum, row) => sum + cents(row.amount), 0) / sorted.length);
    const last = sorted[sorted.length - 1];
    // Si hace más de 45 días que no se repite, se da por terminado.
    if (start.getTime() - last.postedAt.getTime() > 45 * DAY) continue;
    let next = addMonthsClamped(last.postedAt, 1);
    let occurrence = 0;
    while (next.getTime() < end.getTime() && occurrence < 12) {
      if (next.getTime() >= start.getTime()) {
        items.push({
          id: `${ruleId}:${next.toISOString().slice(0, 10)}`,
          kind: "recurring",
          label: last.ruleName,
          partnerName: "Periódico (según el banco)",
          amount: averageCents / 100,
          dueDate: next,
          href: null,
        });
      }
      occurrence += 1;
      next = addMonthsClamped(last.postedAt, occurrence + 1);
    }
  }
  return items;
}
