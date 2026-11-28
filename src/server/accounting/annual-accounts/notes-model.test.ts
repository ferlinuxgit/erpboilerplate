import { describe, expect, it } from "vitest";

import {
  debtTable,
  defaultNoteText,
  fixedAssetTables,
  grantsTable,
  movementRows,
  NOTE_SECTIONS,
  noteText,
  supplierPaymentPeriod,
  supplierPaymentTable,
  taxReconciliationFromLiquidation,
  taxReconciliationTable,
  type NotesContext,
} from "@/server/accounting/annual-accounts/notes-model";
import type { StatementAccountRow } from "@/server/accounting/statements-model";

function row(code: string, values: Partial<StatementAccountRow>): StatementAccountRow {
  return { accountId: `acc-${code}`, code, name: `Cuenta ${code}`, type: "MIXED", priorCents: 0, debitCents: 0, creditCents: 0, yearToDateCents: 0, ...values };
}

const ctx: NotesContext = { companyName: "Ejemplo, S.L.", taxId: "B12345678", address: "Calle Mayor 1, 28001 Madrid", yearLabel: "2026", modelName: "Modelo abreviado", planName: "Plan General de Contabilidad (Real Decreto 1514/2007)", resultAmount: 1250 };
const utc = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day));

describe("apartados de la memoria", () => {
  it("tiene las diez notas del modelo y los dos apartados que exigen otras normas", () => {
    expect(NOTE_SECTIONS.filter((section) => !section.extraLegalBasis).map((section) => section.id)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    expect(NOTE_SECTIONS.filter((section) => section.extraLegalBasis).map((section) => section.id)).toEqual(["aplicacion", "pmp"]);
  });

  it("propone un texto de partida para cada apartado y respeta el guardado", () => {
    for (const section of NOTE_SECTIONS) expect(defaultNoteText(section.id, ctx).length, section.id).toBeGreaterThan(40);
    expect(defaultNoteText("1", ctx)).toContain("Ejemplo, S.L., con NIF B12345678");
    expect(defaultNoteText("aplicacion", ctx)).toContain("1.250,00 €");
    expect(defaultNoteText("aplicacion", { ...ctx, resultAmount: -300 })).toContain("pérdida de 300,00 €");
    expect(noteText("1", { "1": "Texto propio" }, ctx)).toBe("Texto propio");
    expect(noteText("1", { "1": "   " }, ctx)).toBe(defaultNoteText("1", ctx));
  });
});

describe("cuadro de movimientos del inmovilizado", () => {
  const rows = [
    // Ordenador de 1.000 € que ya estaba y furgoneta de 20.000 € comprada en el año; se vende el ordenador.
    row("21700000", { priorCents: 100_000, creditCents: 100_000 }),
    row("21800000", { debitCents: 2_000_000 }),
    row("28170000", { priorCents: -50_000, debitCents: 75_000, creditCents: 25_000 }),
    row("28180000", { creditCents: 320_000 }),
    row("20600000", { priorCents: 30_000 }),
  ];

  it("saldo inicial, entradas, salidas y saldo final del coste", () => {
    const [cost, depreciation, impairment] = fixedAssetTables(rows);
    expect(cost.rows.map((item) => item.values)).toEqual([
      [300, 0, 0, 300],
      [1000, 20_000, 1000, 20_000],
      [0, 0, 0, 0],
      [1300, 20_000, 1000, 20_300],
    ]);
    // La amortización acumulada se muestra en positivo: dotaciones como entradas y bajas como salidas.
    expect(depreciation.rows[1].values).toEqual([500, 3450, 750, 3200]);
    expect(impairment.rows.at(-1)?.values).toEqual([0, 0, 0, 0]);
  });

  it("las cuentas correctoras suman con su signo natural", () => {
    expect(movementRows(rows, [{ label: "x", prefixes: ["281"] }], true)[0]).toMatchObject({ opening: 500, additions: 3450, disposals: 750, closing: 3200 });
  });
});

describe("otros cuadros", () => {
  it("deudas a largo y a corto plazo", () => {
    const table = debtTable([row("17000000", { creditCents: 1_000_000 }), row("52000000", { creditCents: 200_000 }), row("40000001", { creditCents: 60_500 }), row("41000001", { priorCents: -10_000 })]);
    expect(table.rows[0].values).toEqual([10_000, 2000, 12_000]);
    expect(table.rows[4].values).toEqual([0, 705, 705]);
    expect(table.rows.at(-1)?.values).toEqual([10_000, 2705, 12_705]);
  });

  it("subvenciones en patrimonio y en resultados", () => {
    const table = grantsTable([row("13000000", { priorCents: -100_000, debitCents: 20_000, creditCents: 50_000 }), row("74600000", { creditCents: 20_000 }), row("74000000", { creditCents: 5_000 })]);
    expect(table.rows.map((item) => item.values[0])).toEqual([1000, 500, 200, 1300, 50, 200]);
  });

  it("conciliación fiscal: sin datos avisa; con datos calcula la base imponible", () => {
    const empty = taxReconciliationTable({ result: 3000, incomeTaxExpense: 1000, permanentDifferences: null, temporaryDifferences: null, lossCarryforward: null });
    expect(empty.rows[2].values).toEqual([4000]);
    expect(empty.rows.at(-1)?.values).toEqual([null]);
    expect(empty.note).toContain("No hay liquidación del Impuesto sobre Sociedades");
    const filled = taxReconciliationTable({ result: 3000, incomeTaxExpense: 1000, permanentDifferences: 500, temporaryDifferences: -200, lossCarryforward: 1300 });
    expect(filled.rows.map((item) => item.values[0])).toEqual([3000, 1000, 4000, 500, -200, 4300, -1300, 3000]);
  });
});

describe("conciliación fiscal desde la liquidación del Impuesto sobre Sociedades", () => {
  const liquidation = {
    status: "filed" as const,
    accountingResultBeforeTaxCents: 400_000,
    adjustments: [
      { sign: "increase" as const, amountCents: 50_000, nature: "permanent" as const },
      { sign: "decrease" as const, amountCents: 10_000, nature: "permanent" as const },
      { sign: "increase" as const, amountCents: 20_000, nature: "temporaryOrigin" as const },
      { sign: "decrease" as const, amountCents: 5_000, nature: "temporaryReversal" as const },
    ],
    capitalizationReserveCents: 15_000,
    lossCompensationCents: 100_000,
    taxableBaseCents: 340_000,
    levelingReductionCents: 0,
    levelingAdditionCents: 0,
    grossQuotaCents: 85_000,
    creditsCents: 5_000,
    netQuotaCents: 80_000,
    withholdingsAndInstallmentsCents: 30_000,
    differentialCents: 50_000,
  };

  it("toma los ajustes, la compensación de bases y la cuota de la liquidación", () => {
    const table = taxReconciliationFromLiquidation({ result: 3000, incomeTaxExpense: 1000, liquidation });
    const byLabel = Object.fromEntries(table.rows.map((item) => [item.label, item.values[0]]));
    expect(byLabel["Resultado contable antes de impuestos"]).toBe(4000);
    expect(byLabel["Diferencias permanentes: aumentos"]).toBe(500);
    expect(byLabel["Diferencias permanentes: disminuciones"]).toBe(-100);
    expect(byLabel["Diferencias temporarias con origen en el ejercicio: aumentos"]).toBe(200);
    expect(byLabel["Diferencias temporarias con origen en ejercicios anteriores: disminuciones"]).toBe(-50);
    expect(byLabel["Reserva de capitalización"]).toBe(-150);
    expect(byLabel["Compensación de bases imponibles negativas de ejercicios anteriores"]).toBe(-1000);
    expect(byLabel["Base imponible (resultado fiscal)"]).toBe(3400);
    expect(byLabel["Cuota líquida"]).toBe(800);
    expect(byLabel["Cuota diferencial (positiva: a ingresar; negativa: a devolver)"]).toBe(500);
    expect(table.rows.some((item) => item.label.startsWith("Reserva de nivelación"))).toBe(false);
    expect(table.note).toContain("presentada");
    expect(table.note).not.toContain("Atención");
  });

  it("avisa si la liquidación parte de otro resultado", () => {
    const table = taxReconciliationFromLiquidation({ result: 3500, incomeTaxExpense: 1000, liquidation: { ...liquidation, status: "draft" } });
    expect(table.note).toContain("borrador");
    expect(table.note).toContain("4.000,00 €");
  });
});

describe("periodo medio de pago a proveedores", () => {
  const range = { from: utc(2026, 1, 1), toExclusive: utc(2027, 1, 1) };

  it("pondera por importe los días de las operaciones pagadas y de las pendientes", () => {
    const period = supplierPaymentPeriod([
      // 1.000 € pagados a 30 días y 3.000 € pagados a 90 días.
      { date: utc(2026, 3, 1), totalCents: 100_000, payments: [{ date: utc(2026, 3, 31), cents: 100_000 }] },
      { date: utc(2026, 5, 1), totalCents: 300_000, payments: [{ date: utc(2026, 7, 30), cents: 300_000 }] },
      // 2.000 € de una factura del 1 de diciembre, sin pagar al cierre (30 días).
      { date: utc(2026, 12, 1), totalCents: 200_000, payments: [] },
    ], range);
    expect(period.ratioPaidDays).toBe(75);
    expect(period.ratioPendingDays).toBe(30);
    expect(period.totalPaid).toBe(4000);
    expect(period.totalPending).toBe(2000);
    // (75 × 4.000 + 30 × 2.000) / 6.000 = 60.
    expect(period.averageDays).toBe(60);
    expect(period.paidWithinLimit).toEqual({ amount: 1000, count: 1, amountPct: 25, countPct: 50 });
  });

  it("solo cuenta los pagos del ejercicio y lo pendiente al cierre", () => {
    const period = supplierPaymentPeriod([
      // Factura de 2025 pagada en 2025: no interviene en 2026.
      { date: utc(2025, 6, 1), totalCents: 50_000, payments: [{ date: utc(2025, 7, 1), cents: 50_000 }] },
      // Factura de 2026 pagada en 2027: al cierre de 2026 está pendiente.
      { date: utc(2026, 12, 21), totalCents: 100_000, payments: [{ date: utc(2027, 1, 20), cents: 100_000 }] },
      // Factura de 2027: aún no existe al cierre.
      { date: utc(2027, 1, 5), totalCents: 70_000, payments: [] },
    ], range);
    expect(period).toMatchObject({ totalPaid: 0, totalPending: 1000, ratioPaidDays: null, ratioPendingDays: 10, averageDays: 10 });
  });

  it("sin operaciones no inventa un periodo", () => {
    const period = supplierPaymentPeriod([], range);
    expect(period.averageDays).toBeNull();
    const table = supplierPaymentTable(period, null, { current: "2026" });
    expect(table.columns).toEqual(["2026"]);
    expect(table.rows[0].values).toEqual([null]);
  });

  it("muestra el ejercicio anterior en una segunda columna", () => {
    const period = supplierPaymentPeriod([{ date: utc(2026, 3, 1), totalCents: 100_000, payments: [{ date: utc(2026, 3, 31), cents: 100_000 }] }], range);
    const table = supplierPaymentTable(period, period, { current: "2026", previous: "2025" });
    expect(table.columns).toEqual(["2026", "2025"]);
    expect(table.rows[0].values).toEqual(["30,0 días", "30,0 días"]);
  });
});
