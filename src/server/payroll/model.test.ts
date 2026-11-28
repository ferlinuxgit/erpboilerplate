import { describe, expect, it } from "vitest";

import {
  buildSlipPostingLines,
  expectedNetCents,
  key190For,
  parsePayrollImport,
  parseSpanishAmount,
  periodEndDate,
  periodLabel,
  postingIsBalanced,
  proposeWithholdingCents,
  slipCents,
  subkey190For,
  validateSlip,
} from "@/server/payroll/model";

const slip = slipCents({
  grossAmount: 2000,
  withholdingAmount: 300,
  employeeSocialSecurity: 127,
  employerSocialSecurity: 620,
  advancesAmount: 100,
  netAmount: 1473,
});

describe("cuadre de la nómina", () => {
  it("líquido = bruto − IRPF − ingreso a cuenta − SS del trabajador − anticipos", () => {
    expect(expectedNetCents(slip)).toBe(147_300);
    expect(validateSlip(slip)).toEqual({ ok: true });
  });

  it("avisa con la diferencia si no cuadra", () => {
    const result = validateSlip({ ...slip, netCents: 150_000 });
    expect(result).toMatchObject({ ok: false, code: "PAYROLL_UNBALANCED" });
    expect(result.ok ? "" : result.message).toContain("27,00 €");
  });

  it("la retribución en especie no suma al líquido, pero su ingreso a cuenta sí resta", () => {
    const withKind = slipCents({ grossAmount: 2000, inKindAmount: 200, inKindWithholdingAmount: 30, withholdingAmount: 300, employeeSocialSecurity: 127, netAmount: 1543 });
    expect(validateSlip(withKind)).toEqual({ ok: true });
  });

  it("rechaza nóminas vacías, negativas o con más descuentos que bruto", () => {
    expect(validateSlip(slipCents({ grossAmount: 0, netAmount: 0 }))).toMatchObject({ ok: false, code: "PAYROLL_EMPTY" });
    expect(validateSlip(slipCents({ grossAmount: -10, netAmount: 0 }))).toMatchObject({ ok: false, code: "PAYROLL_NEGATIVE" });
    expect(validateSlip(slipCents({ grossAmount: 100, withholdingAmount: 150, netAmount: 0 }))).toMatchObject({ ok: false, code: "PAYROLL_NEGATIVE_NET" });
    expect(validateSlip(slipCents({ grossAmount: 100, inKindWithholdingAmount: 10, netAmount: 90 }))).toMatchObject({ ok: false, code: "PAYROLL_IN_KIND" });
  });
});

describe("asiento de la nómina", () => {
  it("640 y 642 al debe; 4751, 476, 460 y 465 al haber, cuadrado", () => {
    const lines = buildSlipPostingLines(slip);
    expect(lines).toEqual([
      { role: "wages", debitCents: 200_000, creditCents: 0 },
      { role: "employerSocialSecurity", debitCents: 62_000, creditCents: 0 },
      { role: "withholding", debitCents: 0, creditCents: 30_000 },
      { role: "socialSecurity", debitCents: 0, creditCents: 74_700 },
      { role: "advances", debitCents: 0, creditCents: 10_000 },
      { role: "payable", debitCents: 0, creditCents: 147_300 },
    ]);
    expect(postingIsBalanced(lines)).toBe(true);
  });

  it("administrador sin Seguridad Social: solo 640, 4751 y 465", () => {
    const lines = buildSlipPostingLines(slipCents({ grossAmount: 3000, withholdingAmount: 1050, netAmount: 1950 }));
    expect(lines.map((line) => line.role)).toEqual(["wages", "withholding", "payable"]);
    expect(postingIsBalanced(lines)).toBe(true);
  });

  it("el ingreso a cuenta de la especie va a la 4751 y cuadra", () => {
    const lines = buildSlipPostingLines(slipCents({ grossAmount: 2000, inKindAmount: 200, inKindWithholdingAmount: 30, withholdingAmount: 300, employeeSocialSecurity: 127, netAmount: 1543 }));
    expect(lines.find((line) => line.role === "withholding")?.creditCents).toBe(33_000);
    expect(postingIsBalanced(lines)).toBe(true);
  });
});

describe("otras deducciones, especie contabilizada y finiquitos", () => {
  const deductions = [
    { kind: "garnishment" as const, concept: "Embargo Juzgado n.º 3", amountCents: 20_000, accountCode: "4659" },
    { kind: "loan" as const, concept: "Devolución del préstamo", amountCents: 5_000, accountCode: "544" },
  ];

  it("las otras deducciones restan del líquido y van al haber de su cuenta", () => {
    const withDeductions = slipCents({ grossAmount: 2000, withholdingAmount: 300, employeeSocialSecurity: 127, netAmount: 1323, otherDeductions: deductions });
    expect(expectedNetCents(withDeductions)).toBe(132_300);
    expect(validateSlip(withDeductions)).toEqual({ ok: true });
    const lines = buildSlipPostingLines(withDeductions);
    expect(lines.filter((line) => line.role === "otherDeduction")).toEqual([
      { role: "otherDeduction", debitCents: 0, creditCents: 20_000, accountCode: "4659", concept: "Embargo Juzgado n.º 3" },
      { role: "otherDeduction", debitCents: 0, creditCents: 5_000, accountCode: "544", concept: "Devolución del préstamo" },
    ]);
    expect(postingIsBalanced(lines)).toBe(true);
  });

  it("rechaza deducciones sin cuenta válida", () => {
    const bad = slipCents({ grossAmount: 100, netAmount: 90, otherDeductions: [{ kind: "union", concept: "Cuota", amountCents: 1_000, accountCode: "46" }] });
    expect(validateSlip(bad)).toMatchObject({ ok: false, code: "PAYROLL_DEDUCTION" });
  });

  it("la especie contabilizada va a la 64x contra la cuenta puente, sin cambiar el líquido", () => {
    const withKind = slipCents({ grossAmount: 2000, inKindAmount: 200, inKindWithholdingAmount: 30, withholdingAmount: 300, employeeSocialSecurity: 127, netAmount: 1543, inKindPosting: { expenseAccount: "649", counterAccount: "555" } });
    expect(validateSlip(withKind)).toEqual({ ok: true });
    const lines = buildSlipPostingLines(withKind);
    expect(lines.find((line) => line.role === "inKindExpense")).toMatchObject({ debitCents: 20_000, accountCode: "649" });
    expect(lines.find((line) => line.role === "inKindCounter")).toMatchObject({ creditCents: 20_000, accountCode: "555" });
    expect(postingIsBalanced(lines)).toBe(true);
    expect(validateSlip({ ...withKind, inKindPosting: { expenseAccount: "629", counterAccount: "555" } })).toMatchObject({ ok: false, code: "PAYROLL_IN_KIND_POSTING" });
  });

  it("la indemnización del finiquito va a la 641 y forma parte del bruto", () => {
    const settlement = slipCents({ grossAmount: 5000, severanceAmount: 3000, severanceExemptAmount: 3000, withholdingAmount: 200, netAmount: 4800 });
    expect(validateSlip(settlement)).toEqual({ ok: true });
    const lines = buildSlipPostingLines(settlement);
    expect(lines.find((line) => line.role === "wages")?.debitCents).toBe(200_000);
    expect(lines.find((line) => line.role === "severance")?.debitCents).toBe(300_000);
    expect(postingIsBalanced(lines)).toBe(true);
    expect(validateSlip(slipCents({ grossAmount: 100, severanceAmount: 200, netAmount: 100 }))).toMatchObject({ code: "PAYROLL_SEVERANCE" });
    expect(validateSlip(slipCents({ grossAmount: 300, severanceAmount: 200, severanceExemptAmount: 250, netAmount: 300 }))).toMatchObject({ code: "PAYROLL_SEVERANCE_EXEMPT" });
  });
});

describe("ayudas", () => {
  it("propone IRPF = bruto × tipo", () => {
    expect(proposeWithholdingCents(200_000, 15)).toBe(30_000);
    expect(proposeWithholdingCents(123_457, 12.37)).toBe(15_272);
    expect(proposeWithholdingCents(200_000, 0)).toBe(0);
  });

  it("claves del 190: A para empleados y E con subclave para administradores", () => {
    expect([key190For("employee"), subkey190For("employee", "02")]).toEqual(["A", null]);
    expect([key190For("director"), subkey190For("director", "02")]).toEqual(["E", "02"]);
    expect(subkey190For("director", null)).toBe("04");
  });

  it("fin de mes y nombre del periodo", () => {
    expect(periodEndDate("2026-02")).toBe("2026-02-28");
    expect(periodEndDate("2028-02")).toBe("2028-02-29");
    expect(periodLabel("2026-03")).toBe("marzo de 2026");
  });

  it("lee importes a la española", () => {
    expect(parseSpanishAmount("1.234,56")).toBe(1234.56);
    expect(parseSpanishAmount("1234.56")).toBe(1234.56);
    expect(parseSpanishAmount(" 2.000 € ".replace("2.000", "2000"))).toBe(2000);
    expect(parseSpanishAmount("")).toBe(0);
    expect(parseSpanishAmount("abc")).toBeNull();
  });
});

describe("importación de nóminas", () => {
  const employees = [
    { id: "e1", name: "Luis", taxId: "11111111H" },
    { id: "e2", name: "Eva", taxId: "22222222-J" },
  ];

  it("lee filas pegadas de una hoja de cálculo, salta la cabecera y valida el cuadre", () => {
    const text = [
      "NIF\tBruto\tEspecie\tIRPF\tIngreso a cuenta\tSS trabajador\tSS empresa\tAnticipos\tLíquido",
      "11111111H\t2.000,00\t0\t300,00\t0\t127,00\t620,00\t0\t1.573,00",
      "22222222J\t1.500,00\t0\t150,00\t0\t95,25\t465,00\t0\t1.300,00",
      "",
      "99999999R\t1.000,00\t0\t0\t0\t0\t0\t0\t1.000,00",
    ].join("\n");
    const rows = parsePayrollImport(text, employees);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ employeeId: "e1", error: null, amounts: { grossAmount: 2000, netAmount: 1573 } });
    expect(rows[1].error).toContain("no cuadra");
    expect(rows[2].error).toContain("No hay ningún trabajador");
  });

  it("acepta punto y coma y detecta NIF repetidos y columnas que faltan", () => {
    const rows = parsePayrollImport("11111111H;1000;0;100;0;60;300;0;840\n11111111H;1000;0;100;0;60;300;0;840\n22222222J;1000", employees);
    expect(rows.map((row) => row.error === null)).toEqual([true, false, false]);
    expect(rows[1].error).toContain("repetido");
    expect(rows[2].error).toContain("Faltan columnas");
  });
});
