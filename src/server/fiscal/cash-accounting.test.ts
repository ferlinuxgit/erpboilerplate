import { describe, expect, it } from "vitest";

import { FISCAL_TIME_ZONE_PENINSULA } from "@/lib/fiscal-spain";
import {
  cashAccountingDeadline,
  expandIssuedLinesForCash,
  expandSupplierLinesForCash,
  portionCents,
  resolveCashAccrualEvents,
  type CashMovement,
} from "@/server/fiscal/cash-accounting";
import { computeIssuedVat, computeSupplierVat, type IssuedLineInput, type SupplierLineInput } from "@/server/fiscal/spain-calc";

const timeZone = FISCAL_TIME_ZONE_PENINSULA;
const day = (iso: string) => new Date(`${iso}T10:00:00.000Z`);
const inRange = (date: Date, start: string, end: string) => date >= day(start) && date < day(end);

function sale(overrides: Partial<IssuedLineInput & { accrualDate: Date; rectifiedInvoiceId: string | null }> = {}) {
  const issueDate = overrides.issueDate ?? day("2026-02-10");
  return {
    invoiceId: "inv-1", number: "F-1", issueDate, accrualDate: issueDate, totalAmount: 1210, treatment: "DOMESTIC" as const,
    quantity: 1, unitPrice: 1000, taxRate: 21, invoiceType: "INVOICE", rectifiedInvoiceId: null, ...overrides,
  };
}

function purchase(overrides: Partial<SupplierLineInput> = {}): SupplierLineInput {
  const issueDate = overrides.issueDate ?? day("2026-02-10");
  return {
    invoiceId: "sup-1", number: "P-1", issueDate, accountingDate: issueDate, totalAmount: 1210, treatment: "DOMESTIC",
    subtotal: 1000, taxAmount: 210, taxRate: 21, taxDeductiblePct: 100, supplierCashAccounting: true, ...overrides,
  };
}

const movements = (entries: Record<string, CashMovement[]>) => new Map(Object.entries(entries));

describe("tramos de devengo en criterio de caja (art. 163 terdecies LIVA)", () => {
  it("devenga cada cobro parcial en proporción a lo cobrado", () => {
    const events = resolveCashAccrualEvents({
      operationDate: day("2026-02-10"),
      totalCents: 121_000,
      movements: [{ date: day("2026-03-01"), amount: "302.50" }, { date: day("2026-05-20"), amount: 907.5 }],
      timeZone,
    });
    expect(events.map((event) => [event.date.toISOString().slice(0, 10), event.from, event.to, event.reason])).toEqual([
      ["2026-03-01", 0, 0.25, "payment"],
      ["2026-05-20", 0.25, 1, "payment"],
    ]);
    // Los tramos suman el importe exacto, sin perder céntimos.
    expect(events.reduce((total, event) => total + portionCents(21_001, event), 0)).toBe(21_001);
  });

  it("lo no cobrado se devenga el 31 de diciembre del año siguiente al de la operación", () => {
    const deadline = cashAccountingDeadline(day("2026-02-10"), timeZone);
    // Medianoche local (península, UTC+1 en invierno) del 31-12-2027.
    expect(deadline.date.toISOString()).toBe("2027-12-30T23:00:00.000Z");
    const events = resolveCashAccrualEvents({
      operationDate: day("2026-02-10"),
      totalCents: 121_000,
      // El cobro de 2028 llega fuera de plazo: ya no mueve nada.
      movements: [{ date: day("2026-03-01"), amount: 605 }, { date: day("2028-01-15"), amount: 605 }],
      timeZone,
    });
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ from: 0.5, to: 1, reason: "deadline" });
    expect(events[1].date.getTime()).toBe(deadline.date.getTime());
  });

  it("una factura sin ningún cobro va entera al límite; una rectificativa, a su propia fecha", () => {
    const unpaid = resolveCashAccrualEvents({ operationDate: day("2026-12-30"), totalCents: 50_000, movements: [], timeZone });
    expect(unpaid).toHaveLength(1);
    expect(unpaid[0]).toMatchObject({ from: 0, to: 1, reason: "deadline" });
    const creditNote = resolveCashAccrualEvents({ operationDate: day("2026-04-02"), totalCents: -12_100, movements: [], timeZone });
    expect(creditNote).toEqual([{ date: day("2026-04-02"), from: 0, to: 1, reason: "general" }]);
  });

  it("no cuenta de más un cobro que supera el total ni imputa antes de `notBefore`", () => {
    const events = resolveCashAccrualEvents({
      operationDate: day("2026-02-10"),
      totalCents: 10_000,
      movements: [{ date: day("2026-01-20"), amount: 150 }],
      timeZone,
      notBefore: day("2026-02-15"),
    });
    expect(events).toEqual([{ date: day("2026-02-15"), from: 0, to: 1, reason: "payment" }]);
  });
});

describe("facturas emitidas en criterio de caja", () => {
  const compute = (lines: ReturnType<typeof sale>[], collected: Record<string, CashMovement[]>, start: string, end: string) => {
    const expanded = expandIssuedLinesForCash(lines, { movements: movements(collected), timeZone, isEligible: (line) => line.treatment === "DOMESTIC" });
    return computeIssuedVat(expanded.filter((line) => inRange(line.accrualDate, start, end)));
  };

  it("cobro parcial: en el trimestre solo se declara la parte cobrada", () => {
    const q1 = compute([sale()], { "inv-1": [{ date: day("2026-03-15"), amount: 484 }] }, "2026-01-01", "2026-04-01");
    expect(q1.vat.get(21)).toEqual({ rate: 21, base: 40_000, tax: 8_400 });
    expect(q1.cashVat.get(21)).toEqual({ rate: 21, base: 40_000, tax: 8_400 });
    expect(q1.documents[0]).toMatchObject({ taxBase: 400, taxAmount: 84, cashAccounting: true });
  });

  it("cobro en otro trimestre: nada en el de la factura, todo en el del cobro", () => {
    const collected = { "inv-1": [{ date: day("2026-06-05"), amount: 1210 }] };
    expect(compute([sale()], collected, "2026-01-01", "2026-04-01").vat.size).toBe(0);
    expect(compute([sale()], collected, "2026-04-01", "2026-07-01").vat.get(21)).toEqual({ rate: 21, base: 100_000, tax: 21_000 });
  });

  it("sin cobrar: se declara en el último periodo del año siguiente", () => {
    expect(compute([sale()], {}, "2026-01-01", "2027-10-01").vat.size).toBe(0);
    expect(compute([sale()], {}, "2027-10-01", "2028-01-01").vat.get(21)).toEqual({ rate: 21, base: 100_000, tax: 21_000 });
  });

  it("rectificativa de una factura sin cobrar: el abono y la parte abonada se anulan en el mismo periodo", () => {
    const lines = [
      sale(),
      sale({ invoiceId: "abono", number: "R-1", issueDate: day("2026-04-20"), accrualDate: day("2026-04-20"), invoiceType: "CREDIT_NOTE", rectifiedInvoiceId: "inv-1", totalAmount: -242, unitPrice: -200 }),
    ];
    const collected = { "inv-1": [{ date: day("2026-07-10"), amount: 968 }] };
    // 2T: el abono (−200) y, como cobro por compensación, 200 de la factura original.
    const q2 = compute(lines, collected, "2026-04-01", "2026-07-01");
    expect(q2.vat.get(21)).toEqual({ rate: 21, base: 0, tax: 0 });
    expect(q2.rectification.vat.get(21)).toEqual({ rate: 21, base: -20_000, tax: -4_200 });
    // 3T: el resto, al cobrarlo. En total se declara la base neta: 800.
    expect(compute(lines, collected, "2026-07-01", "2026-10-01").vat.get(21)).toEqual({ rate: 21, base: 80_000, tax: 16_800 });
  });

  it("las operaciones excluidas del régimen (art. 163 duodecies) siguen la regla general", () => {
    const intraEu = sale({ invoiceId: "ue", treatment: "INTRA_EU", taxRate: 0, totalAmount: 1000 });
    const result = compute([intraEu], {}, "2026-01-01", "2026-04-01");
    expect(result.zeroRated.INTRA_EU).toBe(100_000);
  });

  it("reparte el recargo de equivalencia y los impuestos guardados con el IVA de la misma entrega", () => {
    const line = sale({
      totalAmount: 1262,
      taxes: [
        { rate: 21, kind: "VAT", operation: "ADD", baseAmount: "1000.00", amount: "210.00" },
        { rate: 5.2, kind: "SURCHARGE", operation: "ADD", baseAmount: "1000.00", amount: "52.00" },
      ],
    });
    const q1 = compute([line], { "inv-1": [{ date: day("2026-03-15"), amount: 631 }] }, "2026-01-01", "2026-04-01");
    expect(q1.vat.get(21)).toEqual({ rate: 21, base: 50_000, tax: 10_500 });
    expect(q1.surcharge.get(5.2)).toEqual({ rate: 5.2, base: 50_000, tax: 2_600 });
  });
});

describe("facturas recibidas que se deducen al pago (arts. 163 quaterdecies y quinquiesdecies)", () => {
  const periodDate = (line: SupplierLineInput) => line.deductionDate ?? (line.sign === -1 ? line.voidedAt : null) ?? line.accountingDate ?? line.issueDate;
  const compute = (lines: SupplierLineInput[], paid: Record<string, CashMovement[]>, start: string, end: string) => {
    const expanded = expandSupplierLinesForCash(lines, { movements: movements(paid), timeZone, isEligible: (line) => line.treatment === "DOMESTIC" && Boolean(line.supplierCashAccounting) });
    return computeSupplierVat(expanded.filter((line) => inRange(periodDate(line), start, end)), 100);
  };

  it("deduce en proporción a cada pago, en el periodo del pago", () => {
    const paid = { "sup-1": [{ date: day("2026-03-20"), amount: 605 }, { date: day("2026-08-01"), amount: 605 }] };
    expect(compute([purchase()], paid, "2026-01-01", "2026-04-01").deductibleCents).toBe(10_500);
    expect(compute([purchase()], paid, "2026-04-01", "2026-07-01").deductibleCents).toBe(0);
    expect(compute([purchase()], paid, "2026-07-01", "2026-10-01").deductibleCents).toBe(10_500);
  });

  it("nunca deduce antes de registrar la factura, aunque el pago sea anterior", () => {
    const line = purchase({ accountingDate: day("2026-04-10") });
    const paid = { "sup-1": [{ date: day("2026-02-12"), amount: 1210 }] };
    expect(compute([line], paid, "2026-01-01", "2026-04-01").deductibleCents).toBe(0);
    expect(compute([line], paid, "2026-04-01", "2026-07-01").deductibleCents).toBe(21_000);
  });

  it("sin pagar, la cuota se deduce el 31 de diciembre del año siguiente", () => {
    expect(compute([purchase()], {}, "2026-01-01", "2027-10-01").deductibleCents).toBe(0);
    expect(compute([purchase()], {}, "2027-10-01", "2028-01-01").deductibleCents).toBe(21_000);
  });

  it("una factura sin la marca (y las intracomunitarias o con inversión del sujeto pasivo) se deduce al registrarla", () => {
    const lines = [purchase({ supplierCashAccounting: false }), purchase({ invoiceId: "isp", treatment: "REVERSE_CHARGE", taxAmount: 0, totalAmount: 1000 })];
    const q1 = compute(lines, {}, "2026-01-01", "2026-04-01");
    expect(q1.deductibleCents).toBe(42_000);
    expect(q1.selfAssessed.reverseCharge.tax).toBe(21_000);
  });

  it("al anular una factura solo se resta lo que ya se había deducido", () => {
    const voidedAt = day("2026-06-15");
    const lines = [purchase({ voidedAt, sign: 1 }), purchase({ voidedAt, sign: -1 })];
    const paid = { "sup-1": [{ date: day("2026-03-20"), amount: 302.5 }, { date: day("2026-09-01"), amount: 907.5 }] };
    expect(compute(lines, paid, "2026-01-01", "2026-04-01").deductibleCents).toBe(5_250);
    expect(compute(lines, paid, "2026-04-01", "2026-07-01").deductibleCents).toBe(-5_250);
    // El pago posterior a la anulación ya no deduce nada.
    expect(compute(lines, paid, "2026-07-01", "2026-10-01").deductibleCents).toBe(0);
  });

  it("un abono del proveedor cuenta como pago de la factura que rectifica", () => {
    const lines = [
      purchase(),
      purchase({ invoiceId: "abono", number: "PR-1", issueDate: day("2026-05-05"), accountingDate: day("2026-05-05"), documentKind: "RECTIFICATION", rectifiedInvoiceId: "sup-1", subtotal: -1000, taxAmount: -210, totalAmount: -1210 }),
    ];
    const q2 = compute(lines, {}, "2026-04-01", "2026-07-01");
    // El abono (−210, casilla 41) y la factura que compensa (+210) se anulan: deducible total cero.
    expect(q2.deductibleCents).toBe(0);
    expect(q2.deductible.rectification.tax).toBe(-21_000);
    expect(q2.deductible.domesticCurrent.tax).toBe(21_000);
  });
});
