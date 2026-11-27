import { describe, expect, it } from "vitest";

import { addMonthsUtc, corporateReminders, corporateTaxReturnWindow, installmentDueDate, periodDays } from "@/server/corporate-tax/deadlines";
import { baseMethodMandatory, baseMethodPct, computeBaseInstallment, computeQuotaInstallment, type BaseInstallmentInput } from "@/server/corporate-tax/installments-model";

const eur = (amount: number) => Math.round(amount * 100);
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

function baseInput(overrides: Partial<BaseInstallmentInput> = {}): BaseInstallmentInput {
  return {
    accountingResultBeforeTaxCents: eur(40_000),
    increasesCents: 0,
    decreasesCents: 0,
    losses: [],
    lossCompensationCents: null,
    regime: "general",
    startYear: 2026,
    revenueCents: eur(500_000),
    bonusesCents: 0,
    withholdingsCents: 0,
    previousInstallmentsCents: 0,
    ...overrides,
  };
}

describe("pago fraccionado, modalidad del art. 40.2", () => {
  it("18 % de la cuota íntegra menos deducciones y retenciones", () => {
    expect(computeQuotaInstallment({ grossQuotaCents: eur(25_000), creditsCents: eur(1_000), withholdingsCents: eur(4_000) })).toEqual({
      method: "quota",
      baseCents: eur(20_000),
      pct: 18,
      amountCents: eur(3_600),
    });
  });

  it("sin base positiva no hay pago", () => {
    expect(computeQuotaInstallment({ grossQuotaCents: eur(1_000), creditsCents: 0, withholdingsCents: eur(3_000) }).amountCents).toBe(0);
  });
});

describe("pago fraccionado, modalidad del art. 40.3", () => {
  it("porcentaje: 5/7 del tipo por defecto, o 19/20 por exceso desde 10 millones", () => {
    expect(baseMethodPct(25)).toBe(17);
    expect(baseMethodPct(15)).toBe(10);
    expect(baseMethodPct(23)).toBe(16);
    expect(baseMethodPct(21)).toBe(15);
    expect(baseMethodPct(28)).toBe(20);
    expect(baseMethodPct(25, true)).toBe(24);
    expect(baseMethodPct(20, true)).toBe(19);
  });

  it("es obligatoria por encima de 6 millones de cifra de negocios", () => {
    expect(baseMethodMandatory(eur(6_000_000))).toBe(false);
    expect(baseMethodMandatory(eur(6_000_000.01))).toBe(true);
    expect(baseMethodMandatory(null)).toBe(false);
  });

  it("17 % de la base del periodo menos retenciones y pagos anteriores", () => {
    const result = computeBaseInstallment(baseInput({ increasesCents: eur(1_000), withholdingsCents: eur(500), previousInstallmentsCents: eur(2_000) }));
    expect(result.baseCents).toBe(eur(41_000));
    expect(result.quotaCents).toBe(eur(6_970));
    expect(result.resultCents).toBe(eur(4_470));
    expect(result.amountCents).toBe(eur(4_470));
    expect(result.minimumCents).toBe(0);
  });

  it("nunca sale negativo y compensa bases negativas", () => {
    const result = computeBaseInstallment(baseInput({ losses: [{ originYear: 2024, pendingCents: eur(30_000) }], previousInstallmentsCents: eur(5_000) }));
    expect(result.lossesAppliedCents).toBe(eur(30_000));
    expect(result.baseCents).toBe(eur(10_000));
    expect(result.resultCents).toBe(eur(-3_300));
    expect(result.amountCents).toBe(0);
  });

  it("con pérdidas en el periodo no hay pago", () => {
    expect(computeBaseInstallment(baseInput({ accountingResultBeforeTaxCents: eur(-10_000) })).amountCents).toBe(0);
  });

  it("escala de microempresas por tramos", () => {
    const result = computeBaseInstallment(baseInput({ regime: "micro", accountingResultBeforeTaxCents: eur(80_000) }));
    // 2026: 19 % → 13 % hasta 50.000 y 21 % → 15 % el resto.
    expect(result.brackets.map((bracket) => [bracket.baseCents, bracket.pct])).toEqual([[eur(50_000), 13], [eur(30_000), 15]]);
    expect(result.amountCents).toBe(eur(11_000));
  });

  it("desde 10 millones: 24 % y mínimo del 23 % del resultado contable", () => {
    const result = computeBaseInstallment(baseInput({
      accountingResultBeforeTaxCents: eur(1_000_000),
      decreasesCents: eur(900_000),
      revenueCents: eur(12_000_000),
      previousInstallmentsCents: eur(50_000),
    }));
    expect(result.largeCompany).toBe(true);
    expect(result.quotaCents).toBe(eur(24_000));
    expect(result.resultCents).toBe(eur(-26_000));
    expect(result.minimumCents).toBe(eur(180_000));
    expect(result.amountCents).toBe(eur(180_000));
  });
});

describe("plazos", () => {
  it("modelo 200: 25 días naturales tras los seis meses posteriores al cierre", () => {
    const natural = corporateTaxReturnWindow(day("2025-12-31"));
    expect([iso(natural.from), iso(natural.to)]).toEqual(["2026-07-01", "2026-07-25"]);
    const june = corporateTaxReturnWindow(day("2026-06-30"));
    expect([iso(june.from), iso(june.to)]).toEqual(["2027-01-01", "2027-01-25"]);
    const midMonth = corporateTaxReturnWindow(day("2026-03-15"));
    expect([iso(midMonth.from), iso(midMonth.to)]).toEqual(["2026-09-16", "2026-10-10"]);
  });

  it("modelo 202: día 20 de abril, octubre y diciembre", () => {
    expect([4, 10, 12].map((month) => iso(installmentDueDate(2026, month)))).toEqual(["2026-04-20", "2026-10-20", "2026-12-20"]);
  });

  it("suma meses de fecha a fecha", () => {
    expect(iso(addMonthsUtc(day("2025-12-31"), 4))).toBe("2026-04-30");
    expect(iso(addMonthsUtc(day("2025-08-31"), 6))).toBe("2026-02-28");
    expect(iso(addMonthsUtc(day("2026-06-30"), 6))).toBe("2026-12-30");
    expect(iso(addMonthsUtc(day("2026-06-30"), 6, { keepMonthEnd: true }))).toBe("2026-12-31");
  });

  it("recordatorios del ejercicio natural: libros 30 de abril, cuentas 30 de julio y 232 en noviembre", () => {
    const all = corporateReminders(day("2025-12-31"), "2025", { relatedParties: true, books: true, annualAccounts: true });
    expect(all.map((reminder) => [reminder.code, iso(reminder.dueDate)])).toEqual([
      ["LIBROS", "2026-04-30"],
      ["CCAA", "2026-07-30"],
      ["232", "2026-11-30"],
    ]);
    expect(corporateReminders(day("2025-12-31"), "2025", { relatedParties: false, books: false, annualAccounts: false })).toEqual([]);
  });

  it("días del periodo impositivo", () => {
    expect(periodDays(day("2025-01-01"), day("2025-12-31"))).toBe(365);
    expect(periodDays(day("2024-01-01"), day("2024-12-31"))).toBe(366);
    expect(periodDays(day("2026-10-20"), day("2026-12-31"))).toBe(73);
  });
});
