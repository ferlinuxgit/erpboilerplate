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

import { company, companySettings, fiscalReport, invoiceLine, journalLine, supplierInvoiceLine } from "@/db/schema";
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
  it("es informativo, sin numeración de casillas, y resume las liquidaciones del año", async () => {
    const annual = await calculateSpanishFiscalSummary("company-1", "390", "2026");
    expect(annual.amountDue).toBeNull();
    expect(annual.vatSettlement).toBeUndefined();
    const rows = annual.annualSummaryBoxes ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.box === "")).toBe(true);
    const amount = (label: string) => rows.find((row) => row.label.startsWith(label))?.amount;
    expect(amount("Total cuotas devengadas")).toBe(1470);
    expect(amount("Total cuotas deducibles")).toBe(1270);
    expect(amount("Liquidaciones · suma de resultados a ingresar")).toBe(200);
    expect(amount("Liquidaciones · saldo a compensar o devolver")).toBe(0);
    expect(annual.warnings.some((warning) => warning.includes("sin numeración oficial"))).toBe(true);
  });
});
