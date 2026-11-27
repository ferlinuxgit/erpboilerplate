import { describe, expect, it } from "vitest";

import pgcAccounts from "@/server/seeds/es/pgc-2024.json";
import { NORMAL_MODEL } from "@/server/accounting/annual-accounts/model-normal";
import { PYMES_MODEL } from "@/server/accounting/annual-accounts/model-pymes";
import {
  buildOfficialStatements,
  OFFICIAL_STATEMENT_MODEL_IDS,
  officialStatementModelInfo,
  officialStatementPrefixes,
  type NodeDefinition,
} from "@/server/accounting/official-statements-model";
import type { StatementAccountRow } from "@/server/accounting/statements-model";

function row(code: string, values: Partial<StatementAccountRow>): StatementAccountRow {
  return { accountId: `acc-${code}`, code, name: `Cuenta ${code}`, type: "MIXED", priorCents: 0, debitCents: 0, creditCents: 0, yearToDateCents: 0, ...values };
}

const amounts = (lines: Array<{ id: string; amount: number }>) => Object.fromEntries(lines.filter((line) => line.amount !== 0).map((line) => [line.id, line.amount]));
const postable = (pgcAccounts as Array<{ code: string; isPostable: boolean }>).filter((account) => account.isPostable).map((account) => account.code);
const isIncome = (code: string) => code.startsWith("6") || code.startsWith("7");

function walk(nodes: NodeDefinition[], visit: (node: NodeDefinition) => void) {
  for (const node of nodes) {
    visit(node);
    if (node.children) walk(node.children, visit);
  }
}

describe.each(OFFICIAL_STATEMENT_MODEL_IDS)("modelo de cuentas anuales «%s»", (modelId) => {
  it("asigna a un epígrafe todas las cuentas del cuadro de cuentas (grupos 1 a 9)", () => {
    const { balance, income } = officialStatementPrefixes(modelId);
    const unmapped = postable.filter((code) => !(isIncome(code) ? income : balance).some((prefix) => code.startsWith(prefix)));
    expect(unmapped).toEqual([]);
  });

  it("cuadra un balance con todas las cuentas del plan y lleva el mismo resultado al patrimonio neto", () => {
    // Un apunte de 1 € al debe en cada cuenta del plan y la contrapartida total en bancos.
    const rows = postable.map((code) => row(`${code}0000`.slice(0, 8).padEnd(8, "0"), isIncome(code) ? { debitCents: 100, yearToDateCents: 100 } : { debitCents: 100 }));
    rows.push(row("57299999", { creditCents: postable.length * 100 }));
    const statements = buildOfficialStatements(rows, null, modelId);
    expect(statements.model).toBe(modelId);
    expect(statements.difference).toBe(0);
    expect(statements.totals.result).toBe(-postable.filter(isIncome).length);
  });

  it("tiene nombre y norma", () => {
    expect(officialStatementModelInfo(modelId).name).toMatch(/^Modelo/);
    expect(officialStatementModelInfo(modelId).source).toMatch(/Real Decreto 151[45]\/2007/);
  });
});

describe("definiciones de los modelos normal y de PYMES", () => {
  it.each([NORMAL_MODEL, PYMES_MODEL])("no repite identificadores ni prefijos dentro de un mismo lado ($id)", (model) => {
    const ids: string[] = [];
    for (const [side, nodes] of [["activo", model.assets], ["pasivo", model.equityAndLiabilities], ["pyg", model.income]] as const) {
      const prefixes: string[] = [];
      walk(nodes, (node) => {
        ids.push(`${side}:${node.id}`);
        prefixes.push(...(node.accounts ?? []), ...(node.bySign ?? []), ...(node.foreign ?? []));
        // Los totales suman epígrafes que existen.
        for (const id of node.totalOf ?? []) expect(nodes.some((candidate) => candidate.id === id), `${node.id} suma ${id}`).toBe(true);
      });
      expect(prefixes.filter((prefix, index) => prefixes.indexOf(prefix) !== index), side).toEqual([]);
    }
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
    // Los epígrafes de reserva y de resultado existen.
    const all = new Set(ids.map((id) => id.split(":")[1]));
    const prior = typeof model.priorResultsLine === "string" ? [model.priorResultsLine] : [model.priorResultsLine.profit, model.priorResultsLine.loss];
    for (const id of [...Object.values(model.fallback), model.yearResultLine, ...prior, ...Object.values(model.totalLines)]) expect(all.has(id), id).toBe(true);
  });
});

describe("modelo normal", () => {
  it("desglosa las partidas que el abreviado agrupa", () => {
    const statements = buildOfficialStatements([
      row("10000000", { priorCents: -300_000 }),
      row("57200001", { priorCents: 300_000, debitCents: 121_000, creditCents: 121_000 }),
      row("21700000", { debitCents: 100_000 }),
      row("28170000", { creditCents: 25_000 }),
      row("68100000", { debitCents: 25_000, yearToDateCents: 25_000 }),
      row("43000001", { debitCents: 242_000, creditCents: 121_000 }),
      row("70000000", { creditCents: 150_000, yearToDateCents: -150_000 }),
      row("70500000", { creditCents: 50_000, yearToDateCents: -50_000 }),
      row("47700000", { creditCents: 42_000 }),
      row("60000000", { debitCents: 50_000, yearToDateCents: 50_000 }),
      row("47200000", { debitCents: 31_500 }),
      row("47090000", { debitCents: 1_000 }),
      row("40000001", { creditCents: 60_500 }),
      row("47520000", { creditCents: 1_000 }),
    ], null, "normal");

    expect(amounts(statements.assets)).toEqual({
      A: 750, "A.II": 750, "A.II.2": 750,
      B: 4535, "B.III": 1535, "B.III.1": 1210, "B.III.5": 10, "B.III.6": 315, "B.VII": 3000, "B.VII.1": 3000,
      TOTAL_ACTIVO: 5285,
    });
    expect(amounts(statements.equityAndLiabilities)).toEqual({
      PN: 4250, "PN.1": 4250, "PN.1.I": 3000, "PN.1.I.1": 3000, "PN.1.VII": 1250,
      PC: 1035, "PC.V": 1035, "PC.V.1": 605, "PC.V.5": 10, "PC.V.6": 420,
      TOTAL_PN_PASIVO: 5285,
    });
    expect(amounts(statements.incomeStatement)).toEqual({
      "PG.1": 2000, "PG.1.a": 1500, "PG.1.b": 500,
      "PG.4": -500, "PG.4.a": -500, "PG.8": -250,
      "PG.A1": 1250, "PG.A3": 1250, "PG.A4": 1250, "PG.A5": 1250,
    });
    expect(statements.difference).toBe(0);
    expect(statements.unmapped).toEqual([]);
  });

  it("separa el remanente de las pérdidas de años sin cerrar según su signo", () => {
    const profit = buildOfficialStatements([row("70000000", { priorCents: -40_000 }), row("57200001", { priorCents: 40_000 })], null, "normal");
    expect(amounts(profit.equityAndLiabilities)).toMatchObject({ "PN.1.V": 400, "PN.1.V.1": 400 });
    const loss = buildOfficialStatements([row("62900000", { priorCents: 40_000 }), row("57200001", { priorCents: -40_000 })], null, "normal");
    expect(amounts(loss.equityAndLiabilities)).toMatchObject({ "PN.1.V": -400, "PN.1.V.2": -400 });
  });

  it("lleva los ajustes de los grupos 8 y 9 sin traspasar a su partida del patrimonio neto", () => {
    const statements = buildOfficialStatements([
      row("90000000", { creditCents: 10_000 }),
      row("94000000", { creditCents: 5_000 }),
      row("57200001", { debitCents: 15_000 }),
    ], null, "normal");
    expect(amounts(statements.equityAndLiabilities)).toMatchObject({ "PN.2.I": 100, "PN.3": 50 });
    expect(statements.difference).toBe(0);
  });
});

describe("modelo de PYMES", () => {
  it("coloca con aviso las cuentas que el plan de PYMES no tiene", () => {
    const statements = buildOfficialStatements([
      row("13300000", { creditCents: 10_000 }),
      row("58000000", { debitCents: 10_000 }),
      row("70000000", { creditCents: 5_000, yearToDateCents: -5_000 }),
      row("57200001", { debitCents: 5_000 }),
    ], null, "pymes");
    expect(statements.unmapped.map((account) => account.code)).toEqual(["13300000", "58000000"]);
    expect(amounts(statements.equityAndLiabilities)).toMatchObject({ "PN.1.III": 100, "PN.1.VII": 50 });
    expect(amounts(statements.assets)).toMatchObject({ "B.II.3": 100, "B.VI": 50 });
    expect(statements.difference).toBe(0);
  });

  it("no avisa de las cuentas propias del plan de PYMES", () => {
    const { foreign } = officialStatementPrefixes("pymes");
    // Las cuentas marcadas como ajenas al plan de PYMES no figuran en su tabla del BOE.
    expect(foreign).toEqual(expect.arrayContaining(["111", "115", "133", "8", "9", "257", "580", "585", "5593", "5598", "767", "774", "7956"]));
    const statements = buildOfficialStatements([row("43000001", { debitCents: 100 }), row("70000000", { creditCents: 100, yearToDateCents: -100 })], null, "pymes");
    expect(statements.unmapped).toEqual([]);
  });
});
