import { describe, expect, it } from "vitest";

import pgcAccounts from "@/server/seeds/es/pgc-2024.json";
import { buildCashFlowStatement, cashFlowPrefixes } from "@/server/accounting/annual-accounts/cash-flow-model";
import type { StatementAccountRow } from "@/server/accounting/statements-model";

/** Libro de pruebas: asientos (cuenta, debe, haber en euros) y saldos iniciales. */
function ledger(entries: Array<Array<[string, number, number]>>, opening: Record<string, number> = {}): StatementAccountRow[] {
  const rows = new Map<string, StatementAccountRow>();
  const get = (code: string) => {
    const existing = rows.get(code);
    if (existing) return existing;
    const created: StatementAccountRow = { accountId: `acc-${code}`, code, name: `Cuenta ${code}`, type: "MIXED", priorCents: 0, debitCents: 0, creditCents: 0, yearToDateCents: 0 };
    rows.set(code, created);
    return created;
  };
  for (const [code, euros] of Object.entries(opening)) get(code).priorCents += Math.round(euros * 100);
  for (const entry of entries) {
    const debit = entry.reduce((sum, [, d]) => sum + d, 0);
    const credit = entry.reduce((sum, [, , c]) => sum + c, 0);
    if (Math.abs(debit - credit) > 0.001) throw new Error("asiento descuadrado");
    for (const [code, d, c] of entry) {
      const row = get(code);
      row.debitCents += Math.round(d * 100);
      row.creditCents += Math.round(c * 100);
      row.yearToDateCents += Math.round((d - c) * 100);
    }
  }
  return [...rows.values()];
}

const amounts = (lines: Array<{ id: string; amount: number; kind: string }>) =>
  Object.fromEntries(lines.filter((line) => line.amount !== 0 && line.kind === "line").map((line) => [line.id, line.amount]));
const lineOf = (lines: Array<{ id: string; amount: number; previous: number | null }>, id: string) => lines.find((line) => line.id === id);

// Un ejercicio corriente de una pequeña sociedad.
const YEAR = ledger([
  [["4300001", 1210, 0], ["7000000", 0, 1000], ["4770000", 0, 210]], // venta a crédito
  [["5720001", 1000, 0], ["4300001", 0, 1000]], // cobro parcial
  [["6000000", 400, 0], ["4720000", 84, 0], ["4000001", 0, 484]], // compra a crédito
  [["4000001", 300, 0], ["5720001", 0, 300]], // pago parcial
  [["6400000", 200, 0], ["5720001", 0, 200]], // sueldos
  [["2160000", 500, 0], ["5720001", 0, 500]], // compra de mobiliario
  [["6810000", 100, 0], ["2816000", 0, 100]], // amortización
  [["5720001", 1000, 0], ["1700000", 0, 1000]], // préstamo bancario
  [["6623000", 50, 0], ["5720001", 0, 50]], // intereses pagados
  [["6300000", 50, 0], ["4752000", 0, 50]], // impuesto del ejercicio, pendiente de pago
  [["1290000", 300, 0], ["1120000", 0, 200], ["5260000", 0, 100]], // reparto del resultado anterior
  [["5260000", 100, 0], ["5720001", 0, 100]], // pago del dividendo
], { "5720001": 2000, "1290000": -300, "1000000": -3000, "2160000": 1300 });

describe("estado de flujos de efectivo (método indirecto)", () => {
  it("clasifica un ejercicio corriente y cuadra con la variación del grupo 57", () => {
    const statement = buildCashFlowStatement(YEAR);
    expect(amounts(statement.lines)).toEqual({
      "A.1": 250, // 1000 − 400 − 200 − 100 − 50 (sin el impuesto)
      "A.2.a": 100,
      "A.2.h": 50,
      "A.3.b": -294, // clientes +210 y IVA soportado +84
      "A.3.d": 394, // proveedores +184 e IVA repercutido +210
      "A.4.a": -50,
      "B.6.c": -500,
      "C.10.a.2": 1000,
      "C.11.a": -100,
      "CASH.OPEN": 2000,
      "CASH.CLOSE": 2850,
    });
    expect(lineOf(statement.lines, "A.5")?.amount).toBe(450);
    expect(lineOf(statement.lines, "B.8")?.amount).toBe(-500);
    expect(lineOf(statement.lines, "C.12")?.amount).toBe(900);
    expect(lineOf(statement.lines, "E")?.amount).toBe(850);
    expect(statement.current).toMatchObject({ openingCash: 2000, closingCash: 2850, cashVariation: 850, explained: 850, unclassified: 0, unclassifiedAccounts: [] });
    // Sin diferencias no aparece la línea de diferencias sin clasificar.
    expect(lineOf(statement.lines, "X")).toBeUndefined();
    expect(statement.previous).toBeNull();
  });

  it("separa pagos y cobros del inmovilizado vendido con beneficio", () => {
    const rows = ledger([
      [["2130000", 30, 0], ["5720001", 0, 30]], // compra
      [["6810000", 20, 0], ["2813000", 0, 20]], // amortización
      [["5720001", 50, 0], ["2813000", 60, 0], ["2130000", 0, 100], ["7710000", 0, 10]], // venta
    ], { "5720001": 100, "2130000": 100, "2813000": -40, "1000000": -160 });
    const { lines, current } = buildCashFlowStatement(rows);
    expect(amounts(lines)).toMatchObject({ "A.1": -10, "A.2.a": 20, "A.2.e": -10, "B.6.c": -30, "B.7.c": 50 });
    expect(lineOf(lines, "A.5")?.amount).toBe(0);
    expect(current.cashVariation).toBe(20);
    expect(current.unclassified).toBe(0);
  });

  it("no cuenta como pago el traspaso del inmovilizado en curso ni la compra aplazada", () => {
    const rows = ledger([
      [["2110000", 100, 0], ["2310000", 0, 100]], // traspaso de la obra terminada
      [["2150000", 80, 0], ["5230000", 0, 80]], // compra pendiente de pago
      [["5230000", 30, 0], ["5720001", 0, 30]], // pago parcial al proveedor de inmovilizado
    ], { "5720001": 100, "2310000": 100, "1000000": -200 });
    const { lines, current } = buildCashFlowStatement(rows);
    expect(amounts(lines)).toEqual({ "B.6.c": -30, "CASH.OPEN": 100, "CASH.CLOSE": 70 });
    expect(current.unclassified).toBe(0);
  });

  it("subvención cobrada e imputada al resultado: financiación y ajuste", () => {
    const rows = ledger([
      [["5720001", 1000, 0], ["9400000", 0, 1000]],
      [["8400000", 100, 0], ["7460000", 0, 100]],
    ], { "5720001": 0 });
    const { lines } = buildCashFlowStatement(rows);
    expect(amounts(lines)).toEqual({ "A.1": 100, "A.2.d": -100, "C.9.e": 1000, "CASH.CLOSE": 1000 });
  });

  it("ampliación de capital con reservas no mueve efectivo; la dineraria es emisión", () => {
    const rows = ledger([
      [["1130000", 500, 0], ["1000000", 0, 500]],
      [["5720001", 2000, 0], ["1000000", 0, 1800], ["1100000", 0, 200]],
      [["1080000", 300, 0], ["5720001", 0, 300]],
    ]);
    expect(amounts(buildCashFlowStatement(rows).lines)).toEqual({ "C.9.a": 2000, "C.9.c": -300, "CASH.CLOSE": 1700 });
  });

  it("enseña las cuentas sin partida en «Diferencias sin clasificar» y sigue cuadrando", () => {
    const rows = ledger([[["5720001", 70, 0], ["1340000", 0, 70]]]);
    const { lines, current } = buildCashFlowStatement(rows);
    expect(lineOf(lines, "X")?.amount).toBe(70);
    expect(lineOf(lines, "E")?.amount).toBe(70);
    expect(current).toMatchObject({ cashVariation: 70, explained: 0, unclassified: 70, unclassifiedAccounts: [{ code: "1340000", amount: 70 }] });
  });

  it("rellena la columna del ejercicio anterior", () => {
    const previous = ledger([[["5720001", 500, 0], ["7050000", 0, 500]]], { "1000000": -2000, "5720001": 2000 });
    const { lines, previous: check } = buildCashFlowStatement(YEAR, previous);
    expect(lineOf(lines, "A.1")?.previous).toBe(500);
    expect(lineOf(lines, "E")?.previous).toBe(500);
    expect(lineOf(lines, "CASH.CLOSE")?.previous).toBe(2500);
    expect(check?.unclassified).toBe(0);
  });

  it("cuadra siempre con el grupo 57 aunque se mueva cada cuenta del cuadro de cuentas", () => {
    const postable = (pgcAccounts as Array<{ code: string; isPostable: boolean }>).filter((account) => account.isPostable && !account.code.startsWith("57")).map((account) => account.code);
    const entries = postable.map((code, index): Array<[string, number, number]> => (index % 2
      ? [[`${code}0000`.slice(0, 8), 1, 0], ["57200000", 0, 1]]
      : [["57200000", 1, 0], [`${code}0000`.slice(0, 8), 0, 1]]));
    const { lines, current } = buildCashFlowStatement(ledger(entries));
    expect(lineOf(lines, "E")?.amount).toBe(current.cashVariation);
    expect(current.explained + current.unclassified).toBeCloseTo(current.cashVariation, 2);
  });

  it("solo deja sin partida las cuentas de coberturas, conversión y ajustes actuariales", () => {
    const prefixes = cashFlowPrefixes().balance;
    const unmapped = (pgcAccounts as Array<{ code: string; isPostable: boolean }>)
      .filter((account) => account.isPostable && !/^[67]/.test(account.code) && !prefixes.some((prefix) => account.code.startsWith(prefix)))
      .map((account) => account.code);
    expect(unmapped.every((code) => /^(134|135|81|82|85|91|92|95)/.test(code))).toBe(true);
  });
});
