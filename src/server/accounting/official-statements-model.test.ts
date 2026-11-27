import { describe, expect, it } from "vitest";

import pgcAccounts from "@/server/seeds/es/pgc-2024.json";
import { buildOfficialStatements, officialStatementPrefixes } from "@/server/accounting/official-statements-model";
import type { StatementAccountRow } from "@/server/accounting/statements-model";

function row(code: string, values: Partial<StatementAccountRow>): StatementAccountRow {
  return { accountId: `acc-${code}`, code, name: `Cuenta ${code}`, type: "MIXED", priorCents: 0, debitCents: 0, creditCents: 0, yearToDateCents: 0, ...values };
}

const amounts = (lines: Array<{ id: string; amount: number }>) => Object.fromEntries(lines.filter((line) => line.amount !== 0).map((line) => [line.id, line.amount]));

describe("cuentas anuales en modelo abreviado del PGC", () => {
  it("asigna a un epígrafe todas las cuentas del cuadro de cuentas (grupos 1 a 9)", () => {
    const { balance, income } = officialStatementPrefixes();
    const unmapped = (pgcAccounts as Array<{ code: string; isPostable: boolean }>)
      .filter((account) => account.isPostable)
      .filter((account) => !(account.code.startsWith("6") || account.code.startsWith("7") ? income : balance).some((prefix) => account.code.startsWith(prefix)))
      .map((account) => account.code);
    expect(unmapped).toEqual([]);
  });

  it("reparte el balance por epígrafes y cuadra con el resultado sin regularizar", () => {
    const statements = buildOfficialStatements([
      // Apertura: 3.000 € de capital en el banco. En el año: ordenador de 1.000 € amortizado 250 €,
      // venta de 2.000 € + IVA cobrada a medias, compra de 500 € + IVA pendiente de pago.
      row("10000000", { priorCents: -300_000 }),
      row("57200001", { priorCents: 300_000, debitCents: 121_000, creditCents: 121_000 }),
      row("21700000", { debitCents: 100_000 }),
      row("28170000", { creditCents: 25_000 }),
      row("68100000", { debitCents: 25_000, yearToDateCents: 25_000 }),
      row("43000001", { debitCents: 242_000, creditCents: 121_000 }),
      row("70000000", { creditCents: 200_000, yearToDateCents: -200_000 }),
      row("47700000", { creditCents: 42_000 }),
      row("60000000", { debitCents: 50_000, yearToDateCents: 50_000 }),
      row("47200000", { debitCents: 31_500 }),
      row("40000001", { creditCents: 60_500 }),
      row("52300000", { creditCents: 0 }),
    ]);

    expect(amounts(statements.assets)).toEqual({
      A: 750, "A.II": 750,
      B: 4525, "B.III": 1525, "B.III.1": 1210, "B.III.3": 315, "B.VII": 3000,
      TOTAL_ACTIVO: 5275,
    });
    expect(amounts(statements.equityAndLiabilities)).toEqual({
      PN: 4250, "PN.1": 4250, "PN.1.I": 3000, "PN.1.I.1": 3000, "PN.1.VII": 1250,
      PC: 1025, "PC.V": 1025, "PC.V.1": 605, "PC.V.2": 420,
      TOTAL_PN_PASIVO: 5275,
    });
    expect(statements.difference).toBe(0);
    expect(statements.unmapped).toEqual([]);
    // El inmovilizado material muestra el bruto y su amortización acumulada.
    expect(statements.assets.find((line) => line.id === "A.II")?.accounts).toEqual([
      expect.objectContaining({ code: "21700000", amount: 1000 }),
      expect.objectContaining({ code: "28170000", amount: -250 }),
    ]);
  });

  it("presenta la cuenta de pérdidas y ganancias con ingresos en positivo y gastos en negativo", () => {
    const statements = buildOfficialStatements([
      row("70500000", { creditCents: 1_000_000, yearToDateCents: -1_000_000 }),
      row("70800000", { debitCents: 50_000, yearToDateCents: 50_000 }),
      row("62900000", { debitCents: 200_000, yearToDateCents: 200_000 }),
      row("64000000", { debitCents: 300_000, yearToDateCents: 300_000 }),
      row("68100000", { debitCents: 25_000, yearToDateCents: 25_000 }),
      row("67800000", { debitCents: 5_000, yearToDateCents: 5_000 }),
      row("66200000", { debitCents: 10_000, yearToDateCents: 10_000 }),
      row("76900000", { creditCents: 1_000, yearToDateCents: -1_000 }),
      row("63000000", { debitCents: 102_750, yearToDateCents: 102_750 }),
      row("57200001", { debitCents: 308_250 }),
    ]);

    expect(amounts(statements.incomeStatement)).toEqual({
      "PG.1": 9500, "PG.6": -3000, "PG.7": -2000, "PG.8": -250, "PG.OTROS": -50,
      "PG.A": 4200,
      "PG.12": 10, "PG.13": -100, "PG.B": -90,
      "PG.C": 4110, "PG.17": -1027.5, "PG.D": 3082.5,
    });
    expect(statements.totals.result).toBe(3082.5);
    // El mismo resultado aparece en el patrimonio neto mientras no se regulariza.
    expect(statements.equityAndLiabilities.find((line) => line.id === "PN.1.VII")?.amount).toBe(3082.5);
    expect(statements.difference).toBe(0);
  });

  it("lleva las cuentas corrientes con socios al activo o al pasivo según su saldo", () => {
    const debtor = buildOfficialStatements([row("55100000", { debitCents: 50_000 }), row("57200001", { creditCents: 50_000 })]);
    expect(amounts(debtor.assets)).toMatchObject({ "B.V": 500, "B.VII": -500 });
    const creditor = buildOfficialStatements([row("55100000", { creditCents: 50_000 }), row("57200001", { debitCents: 50_000 })]);
    expect(amounts(creditor.equityAndLiabilities)).toMatchObject({ "PC.III.3": 500 });
    expect(creditor.difference).toBe(0);
  });

  it("separa el resultado de años sin cerrar, compara con el ejercicio anterior y avisa de cuentas fuera del modelo", () => {
    const statements = buildOfficialStatements(
      [
        // 400 € de beneficio de un año anterior nunca regularizado + 100 € de este año.
        row("70000000", { priorCents: -40_000, creditCents: 10_000, yearToDateCents: -10_000 }),
        row("57200001", { priorCents: 40_000, debitCents: 10_000 }),
        // Cuenta inventada fuera del cuadro de cuentas.
        row("45000000", { debitCents: 2_000 }),
        row("46900000", { creditCents: 2_000 }),
      ],
      [row("70000000", { creditCents: 40_000, yearToDateCents: -40_000 }), row("57200001", { debitCents: 40_000 })],
    );

    expect(statements.equityAndLiabilities.find((line) => line.id === "PN.1.V")).toMatchObject({ amount: 400, previous: 0 });
    expect(statements.equityAndLiabilities.find((line) => line.id === "PN.1.VII")).toMatchObject({ amount: 100, previous: 400 });
    expect(statements.incomeStatement.find((line) => line.id === "PG.1")).toMatchObject({ amount: 100, previous: 400 });
    expect(statements.unmapped.map((account) => account.code)).toEqual(["45000000", "46900000"]);
    expect(statements.assets.find((line) => line.id === "B.III.3")?.amount).toBe(20);
    expect(statements.equityAndLiabilities.find((line) => line.id === "PC.III.3")?.amount).toBe(20);
    expect(statements.difference).toBe(0);
  });
});
