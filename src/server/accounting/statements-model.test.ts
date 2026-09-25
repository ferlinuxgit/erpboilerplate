import { describe, expect, it } from "vitest";

import {
  buildFinancialStatements,
  periodDateKeys,
  resolveStatementPeriod,
  statementPeriodOptions,
  type StatementAccountRow,
} from "@/server/accounting/statements-model";

function row(code: string, type: string, values: Partial<StatementAccountRow>): StatementAccountRow {
  return { accountId: `acc-${code}`, code, name: `Cuenta ${code}`, type, priorCents: 0, debitCents: 0, creditCents: 0, yearToDateCents: 0, ...values };
}

const year2026 = { code: "2026", startsAt: new Date(Date.UTC(2026, 0, 1)), endsAt: new Date(Date.UTC(2026, 11, 31)) };

describe("estados financieros por periodo", () => {
  it("calcula el beneficio del periodo solo con los movimientos del periodo", () => {
    const statements = buildFinancialStatements([
      // Caja: 1.000 € de capital de 2025 + 1.210 € de ventas cobradas en 2026 − 300 € de gastos.
      row("570", "ASSET", { priorCents: 100_000, debitCents: 121_000, creditCents: 30_000 }),
      row("100", "EQUITY", { priorCents: -100_000 }),
      row("477", "LIABILITY", { creditCents: 21_000 }),
      row("700", "REVENUE", { creditCents: 100_000, yearToDateCents: -100_000 }),
      row("629", "EXPENSE", { debitCents: 30_000, yearToDateCents: 30_000 }),
    ], "ES");

    expect(statements.incomeStatement.revenueTotal).toBe(1000);
    expect(statements.incomeStatement.expenseTotal).toBe(300);
    expect(statements.incomeStatement.result).toBe(700);
    expect(statements.balanceSheet.assetsTotal).toBe(1910);
    expect(statements.balanceSheet.liabilitiesTotal).toBe(210);
    expect(statements.balanceSheet.yearResult).toBe(700);
    expect(statements.balanceSheet.pendingPriorResult).toBe(0);
    expect(statements.balanceSheet.equityTotal).toBe(1700);
    expect(statements.balanceSheet.difference).toBe(0);
  });

  it("no mezcla ejercicios: el resultado de un año cerrado está en la 129 y no en la cuenta de resultados", () => {
    // 2025 se regularizó (700 € de beneficio pasaron a 129). En 2026 solo hay 50 € de ventas.
    const statements = buildFinancialStatements([
      row("570", "ASSET", { priorCents: 70_000, debitCents: 5_000 }),
      row("129", "EQUITY", { priorCents: -70_000 }),
      row("700", "REVENUE", { priorCents: 0, creditCents: 5_000, yearToDateCents: -5_000 }),
    ], "ES");

    expect(statements.incomeStatement.result).toBe(50);
    expect(statements.balanceSheet.equity).toEqual([expect.objectContaining({ code: "129", amount: 700 })]);
    expect(statements.balanceSheet.yearResult).toBe(50);
    expect(statements.balanceSheet.difference).toBe(0);
  });

  it("separa el resultado sin regularizar de ejercicios anteriores", () => {
    const statements = buildFinancialStatements([
      row("570", "ASSET", { priorCents: 20_000, debitCents: 10_000 }),
      row("700", "REVENUE", { priorCents: -20_000, creditCents: 10_000, yearToDateCents: -10_000 }),
    ], "ES");

    expect(statements.balanceSheet.yearResult).toBe(100);
    expect(statements.balanceSheet.pendingPriorResult).toBe(200);
    expect(statements.balanceSheet.difference).toBe(0);
  });

  it("clasifica las cuentas mixtas por el signo del saldo y genera sumas y saldos", () => {
    const statements = buildFinancialStatements([
      row("555", "MIXED", { debitCents: 1_000 }),
      row("4750", "MIXED", { creditCents: 1_000 }),
    ], "ES");

    expect(statements.balanceSheet.assets.map((line) => line.code)).toEqual(["555"]);
    expect(statements.balanceSheet.liabilities.map((line) => line.code)).toEqual(["4750"]);
    expect(statements.trialBalance).toEqual([
      expect.objectContaining({ code: "4750", debit: 0, credit: 10, closing: -10 }),
      expect.objectContaining({ code: "555", debit: 10, credit: 0, closing: 10 }),
    ]);
    expect(statements.totals).toEqual({ debit: 10, credit: 10 });
  });

  it("resuelve periodos del ejercicio (completo, trimestre, mes) y cae al año con claves no válidas", () => {
    expect(resolveStatementPeriod(year2026, "year")).toMatchObject({ key: "year", from: new Date("2026-01-01T00:00:00Z"), toExclusive: new Date("2027-01-01T00:00:00Z") });
    expect(resolveStatementPeriod(year2026, "q2")).toMatchObject({ key: "q2", from: new Date("2026-04-01T00:00:00Z"), toExclusive: new Date("2026-07-01T00:00:00Z") });
    expect(resolveStatementPeriod(year2026, "m12")).toMatchObject({ key: "m12", label: "Diciembre 2026", toExclusive: new Date("2027-01-01T00:00:00Z") });
    expect(resolveStatementPeriod(year2026, "q9").key).toBe("year");
    expect(resolveStatementPeriod(year2026, "m13").key).toBe("year");
    expect(periodDateKeys(resolveStatementPeriod(year2026, "q1"))).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(statementPeriodOptions(year2026)).toHaveLength(1 + 4 + 12);
  });
});
