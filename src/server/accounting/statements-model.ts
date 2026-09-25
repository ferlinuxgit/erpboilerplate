/**
 * Estados financieros por periodo (funciones puras, sin base de datos).
 *
 * Convenciones:
 * - Saldo contable = debe − haber, en céntimos enteros.
 * - Los asientos del ciclo de ejercicio (regularización, cierre y apertura) NO cuentan como
 *   movimientos del periodo: el cierre dejaría todos los saldos a cero y la regularización
 *   vaciaría gastos e ingresos. Así el balance y la cuenta de resultados muestran la imagen
 *   "antes de cierre" y no mezclan ejercicios.
 * - El saldo anterior (antes de `from`) excluye cierre y apertura (se anulan entre sí) pero
 *   incluye las regularizaciones de ejercicios anteriores: el resultado de años cerrados ya
 *   está en la 129.
 */

export type StatementAccountRow = {
  accountId: string;
  code: string;
  name: string;
  type: string;
  /** Saldo antes del inicio del periodo (sin cierre/apertura). */
  priorCents: number;
  /** Debe y haber del periodo (sin asientos del ciclo de ejercicio). */
  debitCents: number;
  creditCents: number;
  /** Saldo desde el inicio del ejercicio hasta el fin del periodo (sin asientos del ciclo). */
  yearToDateCents: number;
};

export type StatementLine = {
  accountId: string;
  code: string;
  name: string;
  /** Importe en euros con el signo natural de la masa (activo y gastos en positivo al debe). */
  amount: number;
};

export type TrialBalanceRow = {
  accountId: string;
  code: string;
  name: string;
  opening: number;
  debit: number;
  credit: number;
  closing: number;
};

export type FinancialStatements = {
  incomeStatement: {
    revenue: StatementLine[];
    expenses: StatementLine[];
    revenueTotal: number;
    expenseTotal: number;
    /** Beneficio (positivo) o pérdida (negativo) del periodo. */
    result: number;
  };
  balanceSheet: {
    assets: StatementLine[];
    liabilities: StatementLine[];
    equity: StatementLine[];
    assetsTotal: number;
    liabilitiesTotal: number;
    /** Patrimonio neto incluido el resultado. */
    equityTotal: number;
    /** Beneficio del ejercicio acumulado hasta el fin del periodo (aún sin regularizar). */
    yearResult: number;
    /** Resultado de ejercicios anteriores que nunca se regularizó (ejercicios sin cerrar). */
    pendingPriorResult: number;
    /** Activo − (patrimonio neto + pasivo). Distinto de 0 solo si hay asientos descuadrados. */
    difference: number;
  };
  trialBalance: TrialBalanceRow[];
  totals: { debit: number; credit: number };
};

const cents = (value: number) => Math.round(value) / 100;

/** Cuentas de resultados: grupos 6 y 7 del PGC (o tipos REVENUE/EXPENSE en otros planes). */
export function isIncomeStatementAccount(account: { code: string; type: string }, countryCode: string) {
  if (countryCode === "ES") return account.code.startsWith("6") || account.code.startsWith("7");
  return account.type === "REVENUE" || account.type === "EXPENSE";
}

function isRevenue(account: { code: string; type: string }, countryCode: string) {
  if (countryCode === "ES") return account.code.startsWith("7");
  return account.type === "REVENUE";
}

/** Masa patrimonial de una cuenta de balance. Las MIXED se clasifican por el signo de su saldo. */
function balanceSheetGroup(type: string, balanceCents: number): "asset" | "liability" | "equity" {
  if (type === "ASSET") return "asset";
  if (type === "LIABILITY") return "liability";
  if (type === "EQUITY") return "equity";
  if (type === "REVENUE" || type === "EXPENSE") return balanceCents >= 0 ? "asset" : "liability";
  return balanceCents >= 0 ? "asset" : "liability";
}

export function buildFinancialStatements(rows: StatementAccountRow[], countryCode: string): FinancialStatements {
  const sorted = [...rows].sort((a, b) => a.code.localeCompare(b.code));
  const revenue: StatementLine[] = [];
  const expenses: StatementLine[] = [];
  const assets: StatementLine[] = [];
  const liabilities: StatementLine[] = [];
  const equity: StatementLine[] = [];
  let revenueCents = 0;
  let expenseCents = 0;
  let assetsCents = 0;
  let liabilitiesCents = 0;
  let equityCents = 0;
  let yearResultCents = 0;
  let pendingPriorCents = 0;
  let debitTotal = 0;
  let creditTotal = 0;
  const trialBalance: TrialBalanceRow[] = [];

  for (const row of sorted) {
    const periodNet = row.debitCents - row.creditCents;
    const closingCents = row.priorCents + periodNet;
    debitTotal += row.debitCents;
    creditTotal += row.creditCents;
    if (row.priorCents !== 0 || row.debitCents !== 0 || row.creditCents !== 0) {
      trialBalance.push({
        accountId: row.accountId,
        code: row.code,
        name: row.name,
        opening: cents(row.priorCents),
        debit: cents(row.debitCents),
        credit: cents(row.creditCents),
        closing: cents(closingCents),
      });
    }

    if (isIncomeStatementAccount(row, countryCode)) {
      if (periodNet !== 0) {
        if (isRevenue(row, countryCode)) {
          revenue.push({ accountId: row.accountId, code: row.code, name: row.name, amount: cents(-periodNet) });
          revenueCents += -periodNet;
        } else {
          expenses.push({ accountId: row.accountId, code: row.code, name: row.name, amount: cents(periodNet) });
          expenseCents += periodNet;
        }
      }
      // Resultado en el balance: acumulado del ejercicio + lo que quedó sin regularizar de antes.
      yearResultCents += -row.yearToDateCents;
      pendingPriorCents += -(closingCents - row.yearToDateCents);
      continue;
    }

    if (closingCents === 0) continue;
    const group = balanceSheetGroup(row.type, closingCents);
    if (group === "asset") {
      assets.push({ accountId: row.accountId, code: row.code, name: row.name, amount: cents(closingCents) });
      assetsCents += closingCents;
    } else if (group === "liability") {
      liabilities.push({ accountId: row.accountId, code: row.code, name: row.name, amount: cents(-closingCents) });
      liabilitiesCents += -closingCents;
    } else {
      equity.push({ accountId: row.accountId, code: row.code, name: row.name, amount: cents(-closingCents) });
      equityCents += -closingCents;
    }
  }

  const equityTotalCents = equityCents + yearResultCents + pendingPriorCents;
  return {
    incomeStatement: {
      revenue,
      expenses,
      revenueTotal: cents(revenueCents),
      expenseTotal: cents(expenseCents),
      result: cents(revenueCents - expenseCents),
    },
    balanceSheet: {
      assets,
      liabilities,
      equity,
      assetsTotal: cents(assetsCents),
      liabilitiesTotal: cents(liabilitiesCents),
      equityTotal: cents(equityTotalCents),
      yearResult: cents(yearResultCents),
      pendingPriorResult: cents(pendingPriorCents),
      difference: cents(assetsCents - equityTotalCents - liabilitiesCents),
    },
    trialBalance,
    totals: { debit: cents(debitTotal), credit: cents(creditTotal) },
  };
}

export type StatementPeriodKey = "year" | "q1" | "q2" | "q3" | "q4" | `m${string}`;

export type StatementPeriod = {
  key: StatementPeriodKey;
  label: string;
  /** Inclusivo (00:00 UTC). */
  from: Date;
  /** Exclusivo (00:00 UTC del día siguiente al último). */
  toExclusive: Date;
};

const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Opciones de periodo dentro de un ejercicio: año completo, trimestres y meses (relativos al inicio). */
export function statementPeriodOptions(year: { startsAt: Date; endsAt: Date }) {
  const months = monthCount(year);
  const options: Array<{ value: StatementPeriodKey; label: string }> = [{ value: "year", label: "Ejercicio completo" }];
  for (let quarter = 1; quarter <= Math.floor(months / 3); quarter += 1) {
    options.push({ value: `q${quarter}` as StatementPeriodKey, label: `${quarter}.º trimestre` });
  }
  for (let offset = 0; offset < months; offset += 1) {
    const date = new Date(Date.UTC(year.startsAt.getUTCFullYear(), year.startsAt.getUTCMonth() + offset, 1));
    options.push({ value: `m${String(offset + 1).padStart(2, "0")}`, label: `${capitalize(MONTH_NAMES[date.getUTCMonth()])} ${date.getUTCFullYear()}` });
  }
  return options;
}

function monthCount(year: { startsAt: Date; endsAt: Date }) {
  return (year.endsAt.getUTCFullYear() - year.startsAt.getUTCFullYear()) * 12 + (year.endsAt.getUTCMonth() - year.startsAt.getUTCMonth()) + 1;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Rango del periodo pedido; si la clave no es válida devuelve el ejercicio completo. */
export function resolveStatementPeriod(year: { code: string; startsAt: Date; endsAt: Date }, key: string | null | undefined): StatementPeriod {
  const endExclusive = new Date(Date.UTC(year.endsAt.getUTCFullYear(), year.endsAt.getUTCMonth(), year.endsAt.getUTCDate() + 1));
  const months = monthCount(year);
  const monthStart = (offset: number) => new Date(Date.UTC(year.startsAt.getUTCFullYear(), year.startsAt.getUTCMonth() + offset, 1));
  const quarter = /^q([1-4])$/.exec(key ?? "");
  if (quarter && Number(quarter[1]) * 3 <= months) {
    const index = Number(quarter[1]);
    return { key: `q${index}` as StatementPeriodKey, label: `${index}.º trimestre ${year.code}`, from: monthStart((index - 1) * 3), toExclusive: monthStart(index * 3) };
  }
  const month = /^m(\d{2})$/.exec(key ?? "");
  if (month && Number(month[1]) >= 1 && Number(month[1]) <= months) {
    const offset = Number(month[1]) - 1;
    const from = monthStart(offset);
    return { key: `m${month[1]}`, label: `${capitalize(MONTH_NAMES[from.getUTCMonth()])} ${from.getUTCFullYear()}`, from, toExclusive: monthStart(offset + 1) };
  }
  return { key: "year", label: `Ejercicio ${year.code}`, from: year.startsAt, toExclusive: endExclusive };
}

/** "YYYY-MM-DD" del último día incluido en el periodo (para enlaces al mayor). */
export function periodDateKeys(period: { from: Date; toExclusive: Date }) {
  const last = new Date(period.toExclusive.getTime() - 86_400_000);
  return { from: period.from.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}
