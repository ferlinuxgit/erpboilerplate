import { describe, expect, it } from "vitest";

import {
  buildEquityChangesStatement,
  buildEquityYear,
  buildRecognizedIncomeStatement,
  classifyEquityEntry,
  equityColumnOf,
  equityColumns,
  type EquityYearInput,
} from "@/server/accounting/annual-accounts/equity-changes-model";
import { assessCompanySize, circumstancesMet, meetsForTwoYears, SIZE_LIMITS, yearMeetsLimits } from "@/server/accounting/annual-accounts/size-criteria";

const line = (code: string, debitCents: number, creditCents: number) => ({ code, debitCents, creditCents });

describe("columnas del estado de cambios en el patrimonio neto", () => {
  it("el modelo de PYMES no tiene otros instrumentos ni ajustes por cambios de valor", () => {
    expect(equityColumns("abbreviated").map((column) => column.id)).toContain("valueAdjustments");
    expect(equityColumns("normal")).toHaveLength(12);
    expect(equityColumns("pymes").map((column) => column.id)).toEqual(["capital", "uncalled", "premium", "reserves", "ownShares", "priorResults", "contributions", "result", "interimDividend", "grants"]);
  });

  it("asigna cada cuenta a su columna", () => {
    expect(equityColumnOf("10000000", "abbreviated")).toBe("capital");
    expect(equityColumnOf("10300000", "abbreviated")).toBe("uncalled");
    expect(equityColumnOf("11200000", "abbreviated")).toBe("reserves");
    expect(equityColumnOf("12100000", "abbreviated")).toBe("priorResults");
    expect(equityColumnOf("12900000", "abbreviated")).toBe("result");
    expect(equityColumnOf("55700000", "abbreviated")).toBe("interimDividend");
    expect(equityColumnOf("13000000", "abbreviated")).toBe("grants");
    expect(equityColumnOf("94000000", "abbreviated")).toBe("grants");
    expect(equityColumnOf("13300000", "abbreviated")).toBe("valueAdjustments");
    expect(equityColumnOf("13300000", "pymes")).toBe("reserves");
    // 1034 y 190 son pasivo, no patrimonio neto.
    expect(equityColumnOf("10340000", "abbreviated")).toBeNull();
    expect(equityColumnOf("57200000", "abbreviated")).toBeNull();
  });
});

describe("clasificación de los asientos de patrimonio", () => {
  it("distingue traspasos, capital, reconocidos y operaciones con socios", () => {
    expect(classifyEquityEntry({ result: -100, reserves: 100 }, "abbreviated")).toBe("other");
    expect(classifyEquityEntry({ capital: 300_000, premium: 50_000 }, "abbreviated")).toBe("capitalIncrease");
    expect(classifyEquityEntry({ capital: -100_000 }, "abbreviated")).toBe("capitalReduction");
    expect(classifyEquityEntry({ grants: 5_000 }, "abbreviated")).toBe("recognized");
    expect(classifyEquityEntry({ result: -40_000 }, "abbreviated")).toBe("otherOwners");
    expect(classifyEquityEntry({ result: -40_000 }, "normal")).toBe("dividends");
    expect(classifyEquityEntry({ ownShares: -10_000 }, "normal")).toBe("ownShares");
    expect(classifyEquityEntry({ contributions: 10_000 }, "normal")).toBe("otherOwners");
  });
});

/**
 * 2026: empieza con 3.000 € de capital y 1.000 € de resultado de 2025 en la 129. Reparte el
 * resultado (600 € a reservas y 400 € de dividendo), amplía capital en 2.000 €, recibe una
 * subvención de 500 € y gana 1.250 €.
 */
const year2026: EquityYearInput = {
  label: "2026",
  opening: [{ code: "10000000", cents: 300_000 }, { code: "12900000", cents: 100_000 }, { code: "57200000", cents: -400_000 }],
  pendingPriorResultCents: 0,
  yearResultCents: 125_000,
  entries: [
    { entryId: "reparto", lines: [line("12900000", 60_000, 0), line("11200000", 0, 60_000)] },
    { entryId: "dividendo", lines: [line("12900000", 40_000, 0), line("52600000", 0, 40_000)] },
    { entryId: "ampliacion", lines: [line("57200000", 200_000, 0), line("10000000", 0, 200_000)] },
    { entryId: "subvencion", lines: [line("57200000", 50_000, 0), line("13000000", 0, 50_000)] },
  ],
};

describe("movimientos del ejercicio", () => {
  it("modelo abreviado: saldo inicial, variaciones por fila y saldo final", () => {
    const year = buildEquityYear(year2026, "abbreviated");
    expect(year.opening).toMatchObject({ total: 4000, values: { capital: 3000, result: 1000 } });
    const byId = Object.fromEntries(year.movements.map((row) => [row.id, row]));
    // Resultado + subvención reconocida.
    expect(byId.recognized).toMatchObject({ total: 1750, values: { result: 1250, grants: 500 } });
    expect(byId["owners.1"]).toMatchObject({ total: 2000, values: { capital: 2000 } });
    expect(byId["owners.3"]).toMatchObject({ total: -400, values: { result: -400 } });
    expect(byId.other).toMatchObject({ total: 0, values: { result: -600, reserves: 600 } });
    expect(byId.owners.kind).toBe("group");
    expect(year.closing).toMatchObject({ total: 7350, values: { capital: 5000, reserves: 600, result: 1250, grants: 500 } });
    // El saldo final es el inicial más todas las variaciones.
    const moved = year.movements.reduce((sum, row) => sum + row.total, 0);
    expect(year.opening.total + moved).toBe(year.closing.total);
  });

  it("modelo de PYMES: separa el resultado de lo reconocido en patrimonio", () => {
    const byId = Object.fromEntries(buildEquityYear(year2026, "pymes").movements.map((row) => [row.id, row]));
    expect(byId.result.total).toBe(1250);
    expect(byId.recognized).toMatchObject({ total: 500, values: { grants: 500 } });
  });

  it("modelo normal: el dividendo va a su fila", () => {
    const byId = Object.fromEntries(buildEquityYear(year2026, "normal").movements.map((row) => [row.id, row]));
    expect(byId["owners.4"].total).toBe(-400);
    expect(byId["owners.7"].total).toBe(0);
  });

  it("el resultado de un año sin regularizar pasa a resultados de ejercicios anteriores", () => {
    const year = buildEquityYear({ label: "2026", opening: [{ code: "10000000", cents: 300_000 }], pendingPriorResultCents: 40_000, yearResultCents: 10_000, entries: [] }, "abbreviated");
    expect(year.opening.values).toMatchObject({ capital: 3000, result: 400 });
    expect(year.closing.values).toMatchObject({ capital: 3000, priorResults: 400, result: 100 });
    expect(year.closing.total).toBe(3500);
  });
});

describe("estado completo con ejercicio anterior", () => {
  it("encadena las letras A a E y el saldo final de un año es el inicial del siguiente", () => {
    const year2025: EquityYearInput = { label: "2025", opening: [{ code: "10000000", cents: 300_000 }], pendingPriorResultCents: 0, yearResultCents: 100_000, entries: [] };
    const statement = buildEquityChangesStatement(year2026, year2025, "abbreviated");
    const ids = statement.rows.map((row) => row.id);
    expect(ids[0]).toBe("previous.before");
    expect(ids).toContain("previous.closing");
    expect(ids[ids.length - 1]).toBe("current.closing");
    const closing2025 = statement.rows.find((row) => row.id === "previous.closing");
    const opening2026 = statement.rows.find((row) => row.id === "current.opening");
    expect(closing2025?.label).toBe("C. SALDO, FINAL DEL AÑO 2025");
    expect(closing2025?.total).toBe(4000);
    expect(opening2026?.total).toBe(4000);
    expect(statement.rows.at(-1)).toMatchObject({ label: "E. SALDO, FINAL DEL AÑO 2026", total: 7350 });
  });

  it("sin ejercicio anterior empieza en la letra C", () => {
    const statement = buildEquityChangesStatement(year2026, null, "pymes");
    expect(statement.rows[0].id).toBe("current.before");
    expect(statement.columns).toHaveLength(10);
  });
});

describe("estado de ingresos y gastos reconocidos", () => {
  it("toma lo cargado en el grupo 8 y lo abonado en el 9, sin los traspasos de cierre", () => {
    const { lines, unassigned } = buildRecognizedIncomeStatement({
      yearResultCents: 125_000,
      accounts: [
        // Subvención reconocida (abono) y su traspaso al cierre (cargo), que no cuenta.
        line("94000000", 50_000, 50_000),
        // Transferencia a resultados (cargo) y su traspaso (abono).
        line("84000000", 10_000, 10_000),
        line("83010000", 2_500, 2_500),
        line("86000000", 300, 0),
      ],
    }, { yearResultCents: 100_000, accounts: [] });
    const byId = Object.fromEntries(lines.map((item) => [item.id, item]));
    expect(byId["R.A"]).toMatchObject({ amount: 1250, previous: 1000 });
    expect(byId["R.III"].amount).toBe(500);
    expect(byId["R.V"].amount).toBe(-25);
    expect(byId["R.B"].amount).toBe(475);
    expect(byId["R.VIII"].amount).toBe(-100);
    expect(byId["R.C"].amount).toBe(-100);
    expect(byId["R.TOTAL"]).toMatchObject({ amount: 1625, previous: 1000, kind: "total" });
    expect(unassigned).toEqual(["86000000"]);
  });
});

describe("límites de tamaño (arts. 257 y 258 LSC, RD 1515/2007)", () => {
  it("importes vigentes", () => {
    expect(SIZE_LIMITS.small).toEqual({ assets: 4_000_000, turnover: 8_000_000, employees: 50 });
    expect(SIZE_LIMITS.abbreviatedIncome).toEqual({ assets: 11_400_000, turnover: 22_800_000, employees: 250 });
    expect(SIZE_LIMITS.micro).toEqual({ assets: 1_000_000, turnover: 2_000_000, employees: 10 });
  });

  it("basta con dos de las tres circunstancias", () => {
    expect(circumstancesMet({ assets: 5_000_000, turnover: 7_000_000, employees: 40 }, SIZE_LIMITS.small)).toBe(2);
    expect(yearMeetsLimits({ assets: 5_000_000, turnover: 7_000_000, employees: 40 }, SIZE_LIMITS.small)).toBe(true);
    expect(yearMeetsLimits({ assets: 5_000_000, turnover: 9_000_000, employees: 40 }, SIZE_LIMITS.small)).toBe(false);
    // Los límites son «no supere»: el importe exacto cumple.
    expect(yearMeetsLimits({ assets: 4_000_000, turnover: 8_000_000, employees: 51 }, SIZE_LIMITS.small)).toBe(true);
  });

  it("sin plantilla solo decide si el resultado no depende de ella", () => {
    expect(yearMeetsLimits({ assets: 100_000, turnover: 300_000, employees: null }, SIZE_LIMITS.small)).toBe(true);
    expect(yearMeetsLimits({ assets: 5_000_000, turnover: 300_000, employees: null }, SIZE_LIMITS.small)).toBeNull();
    expect(yearMeetsLimits({ assets: 5_000_000, turnover: 9_000_000, employees: null }, SIZE_LIMITS.small)).toBe(false);
  });

  it("exige dos ejercicios consecutivos (el primero, solo el suyo)", () => {
    const small = { assets: 100_000, turnover: 300_000, employees: 3 };
    const big = { assets: 6_000_000, turnover: 12_000_000, employees: 80 };
    expect(meetsForTwoYears(small, null, SIZE_LIMITS.small)).toBe(true);
    expect(meetsForTwoYears(small, small, SIZE_LIMITS.small)).toBe(true);
    expect(meetsForTwoYears(big, big, SIZE_LIMITS.small)).toBe(false);
    expect(meetsForTwoYears(big, small, SIZE_LIMITS.small)).toBeNull();
  });

  it("recomienda el modelo y lo explica", () => {
    const small = assessCompanySize({ assets: 100_000, turnover: 300_000, employees: 3 }, null);
    expect(small).toMatchObject({ small: true, micro: true, recommended: "abbreviated", transition: false });
    expect(small.messages[0]).toContain("4.000.000");

    const big = { assets: 6_000_000, turnover: 12_000_000, employees: 80 };
    const normal = assessCompanySize(big, big);
    expect(normal).toMatchObject({ small: false, abbreviatedIncome: true, recommended: "normal" });
    expect(normal.messages.join(" ")).toContain("modelo normal");

    const growing = assessCompanySize(big, { assets: 100_000, turnover: 300_000, employees: 3 });
    expect(growing).toMatchObject({ transition: true, recommended: "abbreviated" });

    const unknown = assessCompanySize({ assets: 5_000_000, turnover: 300_000, employees: null }, null);
    expect(unknown).toMatchObject({ small: null, missingEmployees: true });
    expect(unknown.messages[0]).toContain("plantilla media");
  });
});
