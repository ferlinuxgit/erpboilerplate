import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cálculo completo de un modelo (`calculateSpanishFiscalSummary`) con una base de datos simulada:
 * cada consulta devuelve las filas preparadas para su tabla, SIN aplicar el `where`. Por tanto
 * valida el reparto por periodos que se hace en código (devengo, hora local, encadenado de
 * compensaciones, conciliación), no los filtros SQL.
 */
const tables = vi.hoisted(() => ({ rows: new Map<unknown, (call: number) => unknown[]>(), calls: new Map<unknown, number>() }));

vi.mock("@/lib/db", () => {
  function chain(rows: unknown[]): Record<string, unknown> {
    const self: Record<string, unknown> = {
      from: (table: unknown) => {
        const call = (tables.calls.get(table) ?? 0) + 1;
        tables.calls.set(table, call);
        return chain(tables.rows.get(table)?.(call) ?? []);
      },
      then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
    };
    for (const method of ["innerJoin", "leftJoin", "where", "groupBy", "limit", "orderBy"]) self[method] = () => self;
    return self;
  }
  return { db: { select: () => chain([]) } };
});
vi.mock("@/server/audit", () => ({ recordAudit: vi.fn() }));

import { company, companySettings, fiscalReport, invoiceLine, invoicePayment, journalLine, supplierInvoice, supplierInvoiceLine, supplierInvoicePayment } from "@/db/schema";
import { calculateSpanishFiscalSummary } from "@/server/fiscal/spain";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function sale(id: string, issueDate: Date, base: number, extra: Record<string, unknown> = {}) {
  return {
    lineId: `line-${id}`, quantity: "1", unitPrice: String(base), taxRate: "21", discountPct: "0", retentionRate: "0",
    invoiceId: id, number: `F-${id}`, issueDate, operationDate: null, issuedAt: issueDate, invoiceType: "INVOICE",
    totalAmount: String(base * 1.21), status: "ISSUED", vatTreatment: "DOMESTIC", countryCode: "ES", ...extra,
  };
}

function purchase(id: string, accountingDate: Date, base: number, tax: number) {
  return {
    subtotal: String(base), taxAmount: String(tax), taxRate: "21", taxDeductiblePct: "100", retentionAmount: "0", retentionRate: "0",
    expenseAccountCode: "600", invoiceId: id, number: `P-${id}`, issueDate: accountingDate, accountingDate, voidedAt: null,
    prorrataPct: null, totalAmount: String(base + tax), vatTreatment: "DOMESTIC", countryCode: "ES",
  };
}

const box = (boxes: Array<{ box: string; amount: number }>, code: string) => boxes.find((entry) => entry.box === code)?.amount;

beforeEach(() => {
  tables.calls.clear();
  tables.rows.clear();
  tables.rows.set(company, () => [{ countryCode: "ES", postalCode: "28001", province: "Madrid" }]);
  tables.rows.set(companySettings, () => [{ fiscalRegime: "general", taxPeriodicity: "quarterly", siiEnabled: false, verifactuMode: "verifactu", prorrataPct: "100", taxpayerType: "company", vatCompensationOpening: null }]);
  tables.rows.set(fiscalReport, () => []);
  tables.rows.set(invoiceLine, () => [
    sale("feb", day("2026-02-10"), 1000),
    // Expedida el 3 de abril por una operación del 30 de marzo: se devenga en el primer trimestre.
    sale("devengo", day("2026-04-03"), 1000, { operationDate: day("2026-03-30"), issuedAt: new Date("2026-04-03T09:00:00.000Z") }),
    // Ticket del 1 de abril a las 00:30 de Madrid (31-03 22:30 UTC): segundo trimestre.
    sale("ticket", new Date("2026-03-31T22:30:00.000Z"), 100),
    sale("abr", day("2026-04-15"), 4900),
  ]);
  // Primera consulta: facturas registradas; segunda: anulaciones (ninguna).
  tables.rows.set(supplierInvoiceLine, (call) => (call % 2 === 1 ? [purchase("q1", day("2026-02-15"), 5809.52, 1220), purchase("q2", day("2026-05-03"), 238.1, 50)] : []));
  // Diario del segundo trimestre: los asientos van con la fecha de expedición (1.029 + 21 + 210).
  tables.rows.set(journalLine, () => [{ group: "477", debit: "0", credit: "1260.00" }, { group: "472", debit: "50.00", credit: "0" }]);
});

describe("Modelo 303 completo (base de datos simulada)", () => {
  it("1T: incluye la factura de abril con operación en marzo y sale a compensar", async () => {
    const q1 = await calculateSpanishFiscalSummary("company-1", "303", "2026-Q1");
    expect(q1.outputTaxAmount).toBe(420);
    expect(q1.deductibleInputTaxAmount).toBe(1220);
    expect(q1.settlementAmount).toBe(-800);
    expect(q1.amountDue).toBe(-800);
    expect(q1.vatSettlement).toMatchObject({ pendingBefore: 0, applied: 0, pendingAfter: 0, result: -800, carryForward: 800, lastPeriod: false });
    expect(q1.sourceDocuments.salesInvoices.map((document) => document.number).sort()).toEqual(["F-devengo", "F-feb"]);
    expect(q1.sourceDocuments.salesInvoices.find((document) => document.number === "F-devengo")?.accrualDate).toBe("2026-03-30T00:00:00.000Z");
    expect(q1.automationChecks.some((check) => check.code === "accrual-shift")).toBe(true);
  });

  it("2T: compensa los 800 € del 1T (a ingresar 200), cuenta el ticket de madrugada y concilia por expedición", async () => {
    const q2 = await calculateSpanishFiscalSummary("company-1", "303", "2026-Q2");
    // 4.900 + 100 (ticket) al 21 %: la factura con operación en marzo no está.
    expect(q2.sourceDocuments.salesInvoices.map((document) => document.number).sort()).toEqual(["F-abr", "F-ticket"]);
    expect(q2.outputTaxAmount).toBe(1050);
    expect(q2.settlementAmount).toBe(1000);
    expect([box(q2.modelo303Boxes, "46"), box(q2.modelo303Boxes, "110"), box(q2.modelo303Boxes, "78"), box(q2.modelo303Boxes, "87"), box(q2.modelo303Boxes, "71")]).toEqual([1000, 800, 800, 0, 200]);
    expect(q2.amountDue).toBe(200);
    // La 477 se compara con lo expedido en el trimestre (incluida la factura declarada en el 1T).
    expect(q2.accountingReconciliation.outputVat).toEqual({ fiscalAmount: 1260, accountingAmount: 1260, difference: 0 });
    expect(q2.accountingReconciliation.balanced).toBe(true);
    expect(q2.automationChecks.find((check) => check.code === "accrual-shift")?.detail).toContain("1 expedida(s) en este periodo");
    // No es el último periodo: sin volumen de operaciones.
    expect(box(q2.modelo303Boxes, "88")).toBeUndefined();
    expect(q2.directDebitDate?.slice(0, 10)).toBe("2026-07-15");
  });

  it("2T con saldo de ejercicios anteriores configurado: se suma a la casilla 110", async () => {
    tables.rows.set(companySettings, () => [{ fiscalRegime: "general", taxPeriodicity: "quarterly", siiEnabled: false, verifactuMode: "verifactu", prorrataPct: "100", taxpayerType: "company", vatCompensationOpening: { "2026": "150.00", "2025": "999.00" } }]);
    const q2 = await calculateSpanishFiscalSummary("company-1", "303", "2026-Q2");
    expect([box(q2.modelo303Boxes, "110"), box(q2.modelo303Boxes, "78"), box(q2.modelo303Boxes, "71")]).toEqual([950, 950, 50]);
    expect(q2.vatSettlement?.openingAmount).toBe(150);
  });

  it("2T con el 1T presentado: usa el resultado de la foto y no mueve a ese periodo una factura emitida después", async () => {
    // 1T presentado el 2 de abril con −500 € (antes de emitirse la factura del día 3).
    tables.rows.set(fiscalReport, () => [{ code: "303", period: "2026-Q1", snapshotAt: new Date("2026-04-02T10:00:00.000Z"), filedResult: "-500" }]);
    const q2 = await calculateSpanishFiscalSummary("company-1", "303", "2026-Q2");
    expect(q2.sourceDocuments.salesInvoices.map((document) => document.number).sort()).toEqual(["F-abr", "F-devengo", "F-ticket"]);
    expect(q2.outputTaxAmount).toBe(1260);
    expect([box(q2.modelo303Boxes, "110"), box(q2.modelo303Boxes, "78"), box(q2.modelo303Boxes, "71")]).toEqual([500, 500, 710]);
    expect(q2.automationChecks.find((check) => check.code === "accrual-filed-period")?.detail).toContain("303 2026-Q1");
  });

  it("4T: último periodo, con el volumen de operaciones del año", async () => {
    const q4 = await calculateSpanishFiscalSummary("company-1", "303", "2026-Q4");
    expect(q4.vatSettlement).toMatchObject({ lastPeriod: true, pendingBefore: 0, result: 0 });
    expect([box(q4.modelo303Boxes, "80"), box(q4.modelo303Boxes, "88")]).toEqual([7000, 7000]);
  });
});

describe("Modelo 390 completo (base de datos simulada)", () => {
  it("es informativo, con la numeración oficial, y resume las liquidaciones del año", async () => {
    const annual = await calculateSpanishFiscalSummary("company-1", "390", "2026");
    expect(annual.amountDue).toBeNull();
    expect(annual.vatSettlement).toBeUndefined();
    const rows = annual.annualSummaryBoxes ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.box !== "")).toBe(true);
    // 47 total devengado, 64 suma de deducciones, 95 a ingresar en los 303 y 97 saldo final.
    expect([box(rows, "47"), box(rows, "64"), box(rows, "95"), box(rows, "97")]).toEqual([1470, 1270, 200, 0]);
    expect(annual.warnings.some((warning) => warning.includes("numeración del modelo 390"))).toBe(true);
    // Empresa en régimen general y sin prorrata: ni criterio de caja propio ni regularizaciones.
    expect(annual.cashAccounting).toMatchObject({ ownRegime: false, salesBase: 0, purchaseBase: 0 });
    expect(annual.prorrata).toBeUndefined();
  });
});

describe("Criterio de caja en el 303 (base de datos simulada)", () => {
  const regime = (fiscalRegime: string, extra: Record<string, unknown> = {}) => tables.rows.set(companySettings, () => [{
    fiscalRegime, taxPeriodicity: "quarterly", siiEnabled: false, verifactuMode: "verifactu", prorrataPct: "100", taxpayerType: "company", vatCompensationOpening: null, ...extra,
  }]);

  beforeEach(() => {
    regime("cash_accounting");
    tables.rows.set(invoiceLine, () => [
      // Febrero: 1.000 + 210. Se cobra la mitad en marzo y el resto en mayo.
      sale("feb", day("2026-02-10"), 1000),
      // Entrega intracomunitaria de marzo: excluida del régimen, va por la regla general.
      sale("ue", day("2026-03-05"), 500, { taxRate: "0", vatTreatment: "INTRA_EU", countryCode: "FR", totalAmount: "500" }),
      // Abril: 2.000 + 420, sin cobrar.
      sale("abr", day("2026-04-15"), 2000),
    ]);
    tables.rows.set(invoicePayment, () => [
      { invoiceId: "feb", amount: "605.00", date: new Date("2026-03-20T10:00:00.000Z") },
      { invoiceId: "feb", amount: "605.00", date: new Date("2026-05-08T10:00:00.000Z") },
    ]);
    tables.rows.set(supplierInvoiceLine, (call) => (call % 2 === 1 ? [purchase("q1", day("2026-02-15"), 1000, 210)] : []));
    tables.rows.set(supplierInvoicePayment, () => [{ invoiceId: "q1", amount: "1210.00", date: new Date("2026-04-02T10:00:00.000Z") }]);
    tables.rows.set(journalLine, () => [{ group: "477", debit: "0", credit: "210.00" }, { group: "472", debit: "210.00", credit: "0" }]);
  });

  it("1T: solo devenga la mitad cobrada; la compra sin pagar no se deduce todavía", async () => {
    const q1 = await calculateSpanishFiscalSummary("company-1", "303", "2026-Q1");
    expect([box(q1.modelo303Boxes, "07"), box(q1.modelo303Boxes, "09"), box(q1.modelo303Boxes, "27")]).toEqual([500, 105, 105]);
    expect([box(q1.modelo303Boxes, "28"), box(q1.modelo303Boxes, "29")]).toEqual([0, 0]);
    expect(q1.settlementAmount).toBe(105);
    // Informativas: lo que se habría devengado por la regla general.
    expect([box(q1.modelo303Boxes, "62"), box(q1.modelo303Boxes, "63"), box(q1.modelo303Boxes, "74"), box(q1.modelo303Boxes, "75")]).toEqual([1000, 210, 1000, 210]);
    expect(box(q1.modelo303Boxes, "59")).toBe(500);
    expect(q1.cashAccounting).toMatchObject({ ownRegime: true, salesBase: 1000, salesTax: 210, purchaseBase: 1000, purchaseTax: 210 });
    expect(q1.automationChecks.find((check) => check.code === "cash-accounting")?.status).toBe("ok");
    // La conciliación con el diario sigue la fecha de factura: 210 de 477 y 210 de 472.
    expect(q1.accountingReconciliation.outputVat.fiscalAmount).toBe(210);
    expect(q1.accountingReconciliation.inputVat.fiscalAmount).toBe(210);
    expect(q1.accountingReconciliation.balanced).toBe(true);
  });

  it("2T: devenga el segundo cobro, deduce la compra al pagarla y compensa nada del 1T", async () => {
    const q2 = await calculateSpanishFiscalSummary("company-1", "303", "2026-Q2");
    // Segundo cobro de la factura de febrero; la de abril sigue sin cobrar.
    expect([box(q2.modelo303Boxes, "07"), box(q2.modelo303Boxes, "09")]).toEqual([500, 105]);
    expect([box(q2.modelo303Boxes, "28"), box(q2.modelo303Boxes, "29")]).toEqual([1000, 210]);
    expect(q2.settlementAmount).toBe(-105);
    // 1T salió a ingresar 105: no deja saldo a compensar.
    expect(box(q2.modelo303Boxes, "110")).toBe(0);
    expect([box(q2.modelo303Boxes, "62"), box(q2.modelo303Boxes, "63")]).toEqual([2000, 420]);
    expect(q2.sourceDocuments.salesInvoices.map((document) => [document.number, document.taxAmount])).toEqual([["F-feb", 105]]);
  });

  it("4T: sin cobros nuevos no devenga nada, y el volumen del año va en la casilla 81", async () => {
    const q4 = await calculateSpanishFiscalSummary("company-1", "303", "2026-Q4");
    expect(box(q4.modelo303Boxes, "27")).toBe(0);
    expect([box(q4.modelo303Boxes, "80"), box(q4.modelo303Boxes, "81"), box(q4.modelo303Boxes, "93"), box(q4.modelo303Boxes, "88")]).toEqual([0, 3000, 500, 3500]);
  });

  it("4T del año siguiente: la factura de abril sin cobrar se devenga el 31 de diciembre", async () => {
    const q4 = await calculateSpanishFiscalSummary("company-1", "303", "2027-Q4");
    expect([box(q4.modelo303Boxes, "07"), box(q4.modelo303Boxes, "09")]).toEqual([2000, 420]);
    expect(q4.cashAccounting?.deadlineSalesInvoices).toBe(1);
    expect(q4.automationChecks.some((check) => check.code === "cash-accounting-deadline")).toBe(true);
  });

  it("un 1T ya presentado sin criterio de caja no se vuelve a repartir por cobros", async () => {
    tables.rows.set(fiscalReport, () => [{ code: "303", period: "2026-Q1", snapshotAt: new Date("2026-04-10T10:00:00.000Z"), filedResult: "0", cashOwn: null }]);
    const q2 = await calculateSpanishFiscalSummary("company-1", "303", "2026-Q2");
    // La factura de febrero se declaró entera en el 1T: su cobro de mayo no devenga nada en el 2T,
    // y la compra de febrero tampoco se deduce otra vez.
    expect(box(q2.modelo303Boxes, "27")).toBe(0);
    expect(box(q2.modelo303Boxes, "29")).toBe(0);
  });

  it("empresa en régimen general: solo difiere al pago las facturas de proveedores acogidos", async () => {
    regime("general");
    tables.rows.set(supplierInvoice, () => [{ id: "q1" }]);
    tables.rows.set(supplierInvoiceLine, (call) => (call % 2 === 1
      ? [{ ...purchase("q1", day("2026-02-15"), 1000, 210), supplierCashAccounting: true }, purchase("normal", day("2026-02-20"), 100, 21)]
      : []));
    const q1 = await calculateSpanishFiscalSummary("company-1", "303", "2026-Q1");
    // Ventas por la regla general (210); de las compras solo se deduce la que no está en criterio de caja.
    expect([box(q1.modelo303Boxes, "27"), box(q1.modelo303Boxes, "29")]).toEqual([210, 21]);
    expect([box(q1.modelo303Boxes, "62"), box(q1.modelo303Boxes, "74"), box(q1.modelo303Boxes, "75")]).toEqual([undefined, 1000, 210]);
    expect(q1.cashAccounting?.ownRegime).toBe(false);
    const q2 = await calculateSpanishFiscalSummary("company-1", "303", "2026-Q2");
    expect(box(q2.modelo303Boxes, "29")).toBe(210);
  });
});

describe("Prorrata definitiva en el último 303 (base de datos simulada)", () => {
  beforeEach(() => {
    tables.rows.set(invoiceLine, () => [
      sale("gravada", day("2026-02-10"), 8000),
      sale("exenta", day("2026-11-10"), 2000, { taxRate: "0", vatTreatment: "EXEMPT", totalAmount: "2000" }),
    ]);
    tables.rows.set(supplierInvoiceLine, (call) => (call % 2 === 1
      ? [{ ...purchase("q1", day("2026-02-15"), 1000, 210), prorrataPct: "90" }, { ...purchase("q4", day("2026-10-15"), 1000, 210), prorrataPct: "90" }]
      : []));
  });
  const settings = (extra: Record<string, unknown>) => tables.rows.set(companySettings, () => [{
    fiscalRegime: "general", taxPeriodicity: "quarterly", siiEnabled: false, verifactuMode: "verifactu", prorrataPct: "90", taxpayerType: "company", vatCompensationOpening: null, ...extra,
  }]);

  it("sin confirmar: la calcula (80 %) y avisa, pero no toca el resultado", async () => {
    settings({});
    const q4 = await calculateSpanishFiscalSummary("company-1", "303", "2026-Q4");
    expect(q4.prorrata).toMatchObject({ year: 2026, provisionalPct: 90, computedPct: 80, confirmedPct: null, regularizationAmount: null, previewRegularizationAmount: -42 });
    expect(box(q4.modelo303Boxes, "44")).toBeUndefined();
    expect(q4.deductibleInputTaxAmount).toBe(189);
    expect(q4.automationChecks.find((check) => check.code === "prorrata-final")?.status).toBe("warning");
  });

  it("confirmada: regulariza las deducciones de todo el año en la casilla 44", async () => {
    settings({ vatProrataFinal: { "2026": "80" } });
    const q4 = await calculateSpanishFiscalSummary("company-1", "303", "2026-Q4");
    // Deducido en el año con el 90 %: 378; con el 80 %: 336 → −42.
    expect([box(q4.modelo303Boxes, "29"), box(q4.modelo303Boxes, "44"), box(q4.modelo303Boxes, "45")]).toEqual([189, -42, 147]);
    expect(q4.prorrata).toMatchObject({ confirmedPct: 80, regularizationAmount: -42 });
    expect(q4.settlementAmount).toBe(-147);
    // Los periodos que no son el último no llevan regularización.
    const q1 = await calculateSpanishFiscalSummary("company-1", "303", "2026-Q1");
    expect(q1.prorrata).toBeUndefined();
    expect(box(q1.modelo303Boxes, "44")).toBeUndefined();
  });
});
