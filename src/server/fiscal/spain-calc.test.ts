import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { buildSupplierInvoiceLines, normalizePostingLines } from "@/server/accounting/auto-post";
import { buildModelo303Boxes, buildModelo303VolumeBoxes, buildModelo390Summary, computeIssuedVat, computeModelo303Compensation, computeModelo303Totals, computeSupplierVat, modelo349RequiresMonthly, type IssuedLineInput, type SupplierLineInput } from "@/server/fiscal/spain-calc";
import { attachCashAccruals, groupCashCollections, groupThirdPartyOperations, issuedInvoiceFiscalFilter, modelo349SaleKey, normalizeVatCompensationOpening, supplierInvoiceFiscalFilter } from "@/server/fiscal/spain";

vi.mock("@/server/audit", () => ({ recordAudit: vi.fn() }));

const issueDate = new Date(Date.UTC(2026, 3, 10));

function issued(overrides: Partial<IssuedLineInput>): IssuedLineInput {
  return { invoiceId: "inv-1", number: "F-1", issueDate, totalAmount: 121, treatment: "DOMESTIC", quantity: 1, unitPrice: 100, taxRate: 21, ...overrides };
}

function received(overrides: Partial<SupplierLineInput>): SupplierLineInput {
  return { invoiceId: "sup-1", number: "P-1", issueDate, totalAmount: 121, treatment: "DOMESTIC", subtotal: 100, taxAmount: 21, taxRate: 21, taxDeductiblePct: 100, ...overrides };
}

function box(boxes: ReturnType<typeof buildModelo303Boxes>, code: string) {
  return boxes.find((entry) => entry.box === code)?.amount;
}

describe("Modelo 303 computation", () => {
  it("fills 4/10/21 buckets with their current AEAT boxes and flags the expired 5 % rate", () => {
    const result = computeIssuedVat([
      issued({ invoiceId: "a", unitPrice: 100, taxRate: 4 }),
      issued({ invoiceId: "b", unitPrice: 100, taxRate: 5 }),
      issued({ invoiceId: "c", unitPrice: 100, taxRate: 10 }),
      issued({ invoiceId: "d", unitPrice: 100, taxRate: 21 }),
    ]);
    const boxes = buildModelo303Boxes(result, computeSupplierVat([], 100), { periodYear: 2026 });
    expect([box(boxes, "01"), box(boxes, "03"), box(boxes, "04"), box(boxes, "06"), box(boxes, "07"), box(boxes, "09")]).toEqual([100, 4, 100, 10, 100, 21]);
    // Desde 2025 el 5 % no tiene casilla (153-155 quedaron sin tipo asignado): se marca para revisar.
    expect(box(boxes, "153")).toBeUndefined();
    expect(box(boxes, "REV")).toBe(5);
    expect(box(boxes, "27")).toBe(40);
    // Un periodo de 2024 conserva el diseño de entonces.
    const boxes2024 = buildModelo303Boxes(result, computeSupplierVat([], 100), { periodYear: 2024 });
    expect([box(boxes2024, "153"), box(boxes2024, "155")]).toEqual([100, 5]);
  });

  it("declares the 0,5 % surcharge in 168-170 from 2025 (16-18 until 2024)", () => {
    const result = computeIssuedVat([issued({
      taxRate: 4,
      taxes: [
        { rate: 4, kind: "VAT", operation: "ADD", baseAmount: "100.00", amount: "4.00" },
        { rate: 0.5, kind: "SURCHARGE", operation: "ADD", baseAmount: "100.00", amount: "0.50" },
      ],
    })]);
    const supplier = computeSupplierVat([], 100);
    const boxes = buildModelo303Boxes(result, supplier, { periodYear: 2026 });
    expect([box(boxes, "168"), box(boxes, "170"), box(boxes, "16")]).toEqual([100, 0.5, undefined]);
    const boxes2024 = buildModelo303Boxes(result, supplier, { periodYear: 2024 });
    expect([box(boxes2024, "16"), box(boxes2024, "18")]).toEqual([100, 0.5]);
  });

  it("puts recargo de equivalencia in its own boxes and in the accrued total (reconciles with 477)", () => {
    const result = computeIssuedVat([issued({
      taxes: [
        { rate: 21, kind: "VAT", operation: "ADD", baseAmount: "100.00", amount: "21.00" },
        { rate: 5.2, kind: "SURCHARGE", operation: "ADD", baseAmount: "100.00", amount: "5.20" },
      ],
    })]);
    const supplier = computeSupplierVat([], 100);
    const boxes = buildModelo303Boxes(result, supplier, { periodYear: 2026 });
    expect(box(boxes, "22")).toBe(100);
    expect(box(boxes, "24")).toBe(5.2);
    // 477 recibe 21 + 5,20 del asiento de la factura.
    expect(computeModelo303Totals(result, supplier).accruedCents).toBe(2620);
  });

  it("self-assesses intra-EU acquisitions (10/11 and 36/37) and reverse charge (12/13 and 28/29) so the net effect is zero", () => {
    const supplier = computeSupplierVat([
      received({ invoiceId: "eu", treatment: "INTRA_EU", subtotal: 1000, taxAmount: 0, taxRate: 0 }),
      received({ invoiceId: "isp", treatment: "REVERSE_CHARGE", subtotal: 500, taxAmount: 0, taxRate: 0 }),
    ], 100);
    const boxes = buildModelo303Boxes(computeIssuedVat([]), supplier, { periodYear: 2026 });
    expect([box(boxes, "10"), box(boxes, "11"), box(boxes, "12"), box(boxes, "13")]).toEqual([1000, 210, 500, 105]);
    expect([box(boxes, "36"), box(boxes, "37"), box(boxes, "28"), box(boxes, "29")]).toEqual([1000, 210, 500, 105]);
    expect(box(boxes, "46")).toBe(0);
    expect(supplier.defaultRateLines).toBe(2);
  });

  it("applies line deductibility and prorrata exactly like the accounting entry (472)", () => {
    const lines = [
      received({ invoiceId: "x", subtotal: 5.15, taxAmount: 1.08, taxDeductiblePct: 33 }),
      received({ invoiceId: "x", subtotal: 7.35, taxAmount: 1.54, taxDeductiblePct: 33 }),
    ];
    const supplier = computeSupplierVat(lines, 80);
    const posted = normalizePostingLines(buildSupplierInvoiceLines({
      accounts: { purchase: "600", supplier: "400", vatInput: "472", vatOutput: "477", withholdingPayable: "4751" },
      expenseLines: lines.map((line) => ({ accountId: "600", subtotal: Number(line.subtotal), taxAmount: Number(line.taxAmount), taxDeductiblePct: Number(line.taxDeductiblePct) })),
      totalAmount: 15.12,
      prorrataPct: 80,
      vatTreatment: "DOMESTIC",
    }));
    const posted472 = posted.find((line) => line.accountId === "472")?.debit;
    expect(supplier.deductibleCents).toBe(Math.round(Number(posted472) * 100));
    const boxes = buildModelo303Boxes(computeIssuedVat([]), supplier, { periodYear: 2026 });
    expect(box(boxes, "29")).toBe(Number(posted472));
  });

  it("splits withholdings practiced into 111 (professionals) and 115 (rent, account 621)", () => {
    const supplier = computeSupplierVat([
      received({ invoiceId: "lawyer", retentionAmount: 15, retentionRate: 15, expenseAccountCode: "623" }),
      received({ invoiceId: "rent", subtotal: 1000, taxAmount: 210, retentionAmount: 190, retentionRate: 19, expenseAccountCode: "621" }),
    ], 100);
    expect([...supplier.professional.values()]).toEqual([{ rate: 15, base: 10000, tax: 1500 }]);
    expect([...supplier.rent.values()]).toEqual([{ rate: 19, base: 100000, tax: 19000 }]);
  });

  it("collects withholdings suffered on sales separately (account 473)", () => {
    const result = computeIssuedVat([issued({ retentionRate: 15 })]);
    expect([...result.withholdings.values()]).toEqual([{ rate: 15, base: 10000, tax: 1500 }]);
  });

  it("reports intra-EU deliveries, exports and exempt operations as informative boxes", () => {
    const result = computeIssuedVat([
      issued({ invoiceId: "eu", treatment: "INTRA_EU", taxRate: 0, unitPrice: 300 }),
      issued({ invoiceId: "ex", treatment: "EXPORT", taxRate: 0, unitPrice: 200 }),
      issued({ invoiceId: "zero", treatment: "DOMESTIC", taxRate: 0, unitPrice: 50 }),
    ]);
    const supplier = computeSupplierVat([], 100);
    const boxes2026 = buildModelo303Boxes(result, supplier, { periodYear: 2026 });
    expect([box(boxes2026, "59"), box(boxes2026, "60"), box(boxes2026, "EXE"), box(boxes2026, "150")]).toEqual([300, 200, 50, undefined]);
    const boxes2024 = buildModelo303Boxes(result, supplier, { periodYear: 2024 });
    expect(box(boxes2024, "150")).toBe(50);
  });

  it("puts B2B services to EU companies (INTRA_EU_SERVICES) in box 59 together with intra-EU deliveries, not in 120", () => {
    const result = computeIssuedVat([
      issued({ invoiceId: "goods", treatment: "INTRA_EU", taxRate: 0, unitPrice: 300 }),
      issued({ invoiceId: "services", treatment: "INTRA_EU_SERVICES", taxRate: 0, unitPrice: 200 }),
    ]);
    const boxes = buildModelo303Boxes(result, computeSupplierVat([], 100), { periodYear: 2026 });
    expect(box(boxes, "59")).toBe(500);
    expect(box(boxes, "120")).toBeUndefined();
    expect(box(boxes, "27")).toBe(0);
  });

  it("counts draft invoices so the user is warned", () => {
    expect(computeIssuedVat([issued({ status: "DRAFT" })]).draftInvoiceCount).toBe(1);
  });
});

describe("fiscal document scope", () => {
  const dialect = new PgDialect();
  const start = new Date(Date.UTC(2026, 0, 1));
  const end = new Date(Date.UTC(2026, 3, 1));

  it("excludes void and draft supplier invoices from 303/390/347", () => {
    const query = dialect.sqlToQuery(supplierInvoiceFiscalFilter("company-1", start, end)!);
    expect(query.sql).toContain("not in");
    // Por fecha de registro (libro registro), igual que el 303; no por fecha de la factura.
    expect(query.sql).toContain('"accountingDate"');
    expect(query.sql).not.toContain('"issueDate"');
    expect(query.params).toEqual(expect.arrayContaining(["VOID", "DRAFT"]));
  });

  it("excludes void issued invoices", () => {
    const query = dialect.sqlToQuery(issuedInvoiceFiscalFilter("company-1", start, end)!);
    expect(query.sql).toContain("<>");
    expect(query.params).toContain("VOID");
  });
});

describe("Modelo 347: terceros declarados", () => {
  it("suma las fichas con el mismo NIF y compara el umbral en valor absoluto y de forma estricta", () => {
    const rows = groupThirdPartyOperations("customer", [
      { taxId: "B12345674", name: "Pérez S.L.", amount: "2000.00", quarter: 1 },
      { taxId: "es b-12345674", name: "Perez SL (tienda)", amount: "1500.00", quarter: 3 },
      { taxId: "A58818501", name: "Justo en el umbral", amount: "3005.06" },
      { taxId: "12345678Z", name: "Abonos", amount: "-4000.00" },
      { taxId: null, name: "Sin identificar A", amount: "3100.00" },
      { taxId: null, name: "Sin identificar B", amount: "900.00" },
    ]);
    expect(rows).toEqual([
      { type: "customer", taxId: "12345678Z", name: "Abonos", amount: -4000, quarters: [0, 0, 0, 0] },
      // Desglose trimestral: las dos fichas del mismo NIF suman, cada una en su trimestre.
      { type: "customer", taxId: "B12345674", name: "Pérez S.L.", amount: 3500, quarters: [2000, 0, 1500, 0] },
      { type: "customer", taxId: "Sin NIF", name: "Sin identificar A", amount: 3100, quarters: [0, 0, 0, 0] },
    ]);
  });

  it("avisa de los cobros en metálico solo por encima de 6.000 € por tercero", () => {
    const cash = groupCashCollections([
      { taxId: "B12345674", name: "Pérez S.L.", amount: "4000.00" },
      { taxId: "ES-B12345674", name: "Perez SL (tienda)", amount: "2500.00" },
      { taxId: "A58818501", name: "Justo en el límite", amount: "6000.00" },
    ]);
    expect([...cash]).toEqual([["B12345674", 6500]]);
  });
});

describe("Modelo 303: cuotas a compensar (casillas 110, 78 y 87)", () => {
  it("T1 −800 y T2 +1.000 → se aplican 800 y se ingresan 200", () => {
    const t2 = computeModelo303Compensation({ openingCents: 0, previousResultsCents: [-80_000], resultCents: 100_000 });
    expect(t2).toEqual({ pendingBeforeCents: 80_000, appliedCents: 80_000, pendingAfterCents: 0, resultCents: 20_000, generatedCents: 0, carryForwardCents: 0 });
  });

  it("no aplica más que el resultado positivo y arrastra el resto (87 = 110 − 78)", () => {
    const t2 = computeModelo303Compensation({ openingCents: 0, previousResultsCents: [-80_000], resultCents: 30_000 });
    expect(t2).toMatchObject({ pendingBeforeCents: 80_000, appliedCents: 30_000, pendingAfterCents: 50_000, resultCents: 0, carryForwardCents: 50_000 });
    // T3: lo consumido en T2 ya no está pendiente.
    const t3 = computeModelo303Compensation({ openingCents: 0, previousResultsCents: [-80_000, 30_000], resultCents: 70_000 });
    expect(t3).toMatchObject({ pendingBeforeCents: 50_000, appliedCents: 50_000, pendingAfterCents: 0, resultCents: 20_000 });
  });

  it("un periodo negativo no aplica nada: su saldo se suma al pendiente sin entrar en la casilla 87", () => {
    const t2 = computeModelo303Compensation({ openingCents: 0, previousResultsCents: [-80_000], resultCents: -20_000 });
    expect(t2).toEqual({ pendingBeforeCents: 80_000, appliedCents: 0, pendingAfterCents: 80_000, resultCents: -20_000, generatedCents: 20_000, carryForwardCents: 100_000 });
  });

  it("parte del saldo de ejercicios anteriores configurado en la empresa", () => {
    const t1 = computeModelo303Compensation({ openingCents: 50_000, previousResultsCents: [], resultCents: 120_000 });
    expect(t1).toMatchObject({ pendingBeforeCents: 50_000, appliedCents: 50_000, resultCents: 70_000 });
    expect(normalizeVatCompensationOpening({ "2026": "500.00", "2025": 0, abc: 10, "2027": "x" })).toEqual({ "2026": 500 });
    expect(normalizeVatCompensationOpening(null)).toEqual({});
  });

  it("lleva la compensación a las casillas 64, 66, 110, 78, 87, 69 y 71", () => {
    const issuedVat = computeIssuedVat([issued({ unitPrice: 10_000, taxRate: 21 })]);
    const supplierVat = computeSupplierVat([received({ subtotal: 5_238.1, taxAmount: 1_100, totalAmount: 6_338.1 })], 100);
    const compensation = computeModelo303Compensation({ openingCents: 0, previousResultsCents: [-80_000], resultCents: computeModelo303Totals(issuedVat, supplierVat).resultCents });
    const boxes = buildModelo303Boxes(issuedVat, supplierVat, { periodYear: 2026, compensation });
    expect([box(boxes, "46"), box(boxes, "64"), box(boxes, "66"), box(boxes, "110"), box(boxes, "78"), box(boxes, "87"), box(boxes, "69"), box(boxes, "71")])
      .toEqual([1000, 1000, 1000, 800, 800, 0, 200, 200]);
  });
});

describe("Modelo 303: bases deducibles, rectificativas y último periodo", () => {
  it("las bases deducibles van sin prorratear; las cuotas, prorrateadas", () => {
    const supplierVat = computeSupplierVat([
      received({ invoiceId: "a", subtotal: 1000, taxAmount: 210, totalAmount: 1210 }),
      // Vehículo al 50 %: la cuota es deducible parcialmente, así que la base entra entera.
      received({ invoiceId: "b", subtotal: 200, taxAmount: 42, totalAmount: 242, taxDeductiblePct: 50 }),
      // No deducible y exenta: fuera de las bases deducibles.
      received({ invoiceId: "c", subtotal: 300, taxAmount: 63, totalAmount: 363, taxDeductiblePct: 0 }),
      received({ invoiceId: "d", subtotal: 400, taxAmount: 0, taxRate: 0, totalAmount: 400 }),
    ], 40);
    const boxes = buildModelo303Boxes(computeIssuedVat([]), supplierVat, { periodYear: 2026 });
    expect(box(boxes, "28")).toBe(1200);
    // 210 × 40 % + 42 × 50 % × 40 %
    expect(box(boxes, "29")).toBe(92.4);
    // La estructura prorrateada que usan los modelos canarios no cambia.
    expect(supplierVat.deductible.domesticCurrent.base).toBe(44_000);
  });

  it("las rectificativas emitidas van a las casillas 14-15 (y 25-26 con recargo), no a 01-09", () => {
    const surcharged = [{ rate: 21, kind: "VAT", operation: "ADD", baseAmount: -100, amount: -21 }, { rate: 5.2, kind: "SURCHARGE", operation: "ADD", baseAmount: -100, amount: -5.2 }];
    const issuedVat = computeIssuedVat([
      issued({ invoiceId: "a", unitPrice: 1000, taxRate: 21 }),
      issued({ invoiceId: "r1", invoiceType: "CREDIT_NOTE", quantity: -1, unitPrice: 200, taxRate: 21 }),
      issued({ invoiceId: "r2", invoiceType: "CREDIT_NOTE", quantity: -1, unitPrice: 100, taxRate: 21, taxes: surcharged }),
    ]);
    const boxes = buildModelo303Boxes(issuedVat, computeSupplierVat([], 100), { periodYear: 2026 });
    expect([box(boxes, "07"), box(boxes, "09")]).toEqual([1000, 210]);
    expect([box(boxes, "14"), box(boxes, "15")]).toEqual([-300, -63]);
    expect([box(boxes, "25"), box(boxes, "26")]).toEqual([-100, -5.2]);
    // El total devengado no cambia: 210 − 63 − 5,20.
    expect(box(boxes, "27")).toBe(141.8);
    // Sin rectificativas no aparecen las casillas de modificación.
    expect(box(buildModelo303Boxes(computeIssuedVat([issued({})]), computeSupplierVat([], 100), { periodYear: 2026 }), "14")).toBeUndefined();
  });

  it("añade el volumen de operaciones del año solo cuando se le pasa (último periodo)", () => {
    const year = computeIssuedVat([
      issued({ invoiceId: "a", unitPrice: 1000, taxRate: 21 }),
      issued({ invoiceId: "b", unitPrice: 500, taxRate: 0, treatment: "INTRA_EU" }),
      issued({ invoiceId: "c", unitPrice: 300, taxRate: 0, treatment: "EXPORT" }),
      issued({ invoiceId: "d", unitPrice: 200, taxRate: 0, treatment: "EXEMPT" }),
    ]);
    const quarter = computeIssuedVat([issued({ invoiceId: "a", unitPrice: 1000, taxRate: 21 })]);
    const boxes = buildModelo303Boxes(quarter, computeSupplierVat([], 100), { periodYear: 2026, yearIssued: year });
    expect([box(boxes, "80"), box(boxes, "93"), box(boxes, "94"), box(boxes, "83"), box(boxes, "88")]).toEqual([1000, 500, 300, 200, 2000]);
    expect(box(buildModelo303Boxes(quarter, computeSupplierVat([], 100), { periodYear: 2026 }), "88")).toBeUndefined();
    expect(buildModelo303VolumeBoxes(year, { numbered: false }).every((row) => row.box === "")).toBe(true);
  });
});

describe("Modelo 390: numeración oficial (instrucciones y diseño de registro de 2025)", () => {
  const annualBox = (rows: ReturnType<typeof buildModelo390Summary>, code: string) => rows.find((row) => row.box === code)?.amount;

  it("numera devengado, deducible y resultado, y encadena las liquidaciones del año", () => {
    const issuedVat = computeIssuedVat([issued({ unitPrice: 10_000, taxRate: 21 })]);
    const supplierVat = computeSupplierVat([received({ subtotal: 1000, taxAmount: 210, totalAmount: 1210 })], 100);
    const rows = buildModelo390Summary(issuedVat, supplierVat, {
      openingCents: 10_000,
      periodResults: [{ period: "2026-Q1", resultCents: -80_000 }, { period: "2026-Q2", resultCents: 100_000 }, { period: "2026-Q3", resultCents: 50_000 }, { period: "2026-Q4", resultCents: -30_000 }],
    });
    expect(rows.every((row) => row.box !== "")).toBe(true);
    // Régimen ordinario: 01-06 siempre; el 21 % en 05 y 06. Totales 33, 34 y 47.
    expect([annualBox(rows, "01"), annualBox(rows, "03"), annualBox(rows, "05"), annualBox(rows, "06")]).toEqual([0, 0, 10_000, 2100]);
    expect([annualBox(rows, "33"), annualBox(rows, "34"), annualBox(rows, "47")]).toEqual([10_000, 2100, 2100]);
    // Deducible interior corriente al 21 %: 605 y 606, con sus totales 48 y 49.
    expect([annualBox(rows, "605"), annualBox(rows, "606"), annualBox(rows, "48"), annualBox(rows, "49")]).toEqual([1000, 210, 1000, 210]);
    expect([annualBox(rows, "64"), annualBox(rows, "65"), annualBox(rows, "84")]).toEqual([210, 1890, 1890]);
    // 85: saldo del ejercicio anterior; 86 = 84 − 85.
    expect([annualBox(rows, "85"), annualBox(rows, "86")]).toEqual([100, 1790]);
    // 1T: −800 (más 100 de saldo inicial = 900 a compensar). 2T: 1.000 − 900 = 100; 3T: 500 → 600 a
    // ingresar en el año. 4T deja 300 a compensar o devolver.
    expect([annualBox(rows, "95"), annualBox(rows, "97")]).toEqual([600, 300]);
    // Volumen de operaciones: 99 y total 108.
    expect([annualBox(rows, "99"), annualBox(rows, "108")]).toEqual([10_000, 10_000]);
  });

  it("separa adquisiciones intracomunitarias de bienes y de servicios, la inversión del sujeto pasivo y las rectificativas", () => {
    const issuedVat = computeIssuedVat([
      issued({ invoiceId: "a", unitPrice: 1000, taxRate: 10 }),
      issued({ invoiceId: "r", unitPrice: -100, taxRate: 10, invoiceType: "CREDIT_NOTE" }),
    ]);
    const supplierVat = computeSupplierVat([
      received({ invoiceId: "bienes", treatment: "INTRA_EU", subtotal: 500, taxAmount: 0, totalAmount: 500, expenseAccountCode: "600" }),
      received({ invoiceId: "servicios", treatment: "INTRA_EU", subtotal: 300, taxAmount: 0, totalAmount: 300, expenseAccountCode: "623" }),
      received({ invoiceId: "isp", treatment: "REVERSE_CHARGE", subtotal: 200, taxAmount: 0, totalAmount: 200, expenseAccountCode: "607" }),
      received({ invoiceId: "abono", documentKind: "RECTIFICATION", subtotal: -50, taxAmount: -10.5, totalAmount: -60.5 }),
    ], 100);
    const rows = buildModelo390Summary(issuedVat, supplierVat);
    expect([annualBox(rows, "03"), annualBox(rows, "04"), annualBox(rows, "29"), annualBox(rows, "30")]).toEqual([1000, 100, -100, -10]);
    expect([annualBox(rows, "25"), annualBox(rows, "26"), annualBox(rows, "551"), annualBox(rows, "552"), annualBox(rows, "27"), annualBox(rows, "28")]).toEqual([500, 105, 300, 63, 200, 42]);
    // Deducible: bienes UE 629-630 (total 56-57), servicios UE 637-638 (total 597-598), ISP en interiores.
    expect([annualBox(rows, "629"), annualBox(rows, "57"), annualBox(rows, "637"), annualBox(rows, "598"), annualBox(rows, "606")]).toEqual([500, 105, 300, 63, 42]);
    expect([annualBox(rows, "639"), annualBox(rows, "62")]).toEqual([-50, -10.5]);
    // 47 = cuotas de ventas (90) + autorepercutidas (210); 64 = 105 + 63 + 42 − 10,5.
    expect([annualBox(rows, "47"), annualBox(rows, "64")]).toEqual([300, 199.5]);
  });

  it("lleva lo devengado en criterio de caja a 643-648 y el recargo a sus casillas; un tipo sin casilla se marca REV", () => {
    const issuedVat = computeIssuedVat([
      issued({ invoiceId: "caja", unitPrice: 1000, taxRate: 21, cashAccounting: true, portion: { from: 0, to: 0.5 } }),
      issued({ invoiceId: "general", unitPrice: 100, taxRate: 21 }),
      issued({ invoiceId: "viejo", unitPrice: 100, taxRate: 5 }),
      issued({ invoiceId: "recargo", taxRate: 21, taxes: [
        { rate: 21, kind: "VAT", operation: "ADD", baseAmount: "100.00", amount: "21.00" },
        { rate: 5.2, kind: "SURCHARGE", operation: "ADD", baseAmount: "100.00", amount: "5.20" },
      ] }),
    ]);
    const rows = buildModelo390Summary(issuedVat, computeSupplierVat([], 100), {
      cashYearIssued: computeIssuedVat([issued({ invoiceId: "caja", unitPrice: 1000, taxRate: 21 })]),
      volumeIssued: computeIssuedVat([issued({ invoiceId: "general", unitPrice: 100, taxRate: 21 })]),
      cashInfo: { salesBaseCents: 100_000, salesTaxCents: 21_000, purchaseBaseCents: 0, purchaseTaxCents: 0 },
      prorrata: { totalCents: 110_000, deductibleCents: 110_000, pct: 100 },
    });
    expect([annualBox(rows, "647"), annualBox(rows, "648"), annualBox(rows, "05"), annualBox(rows, "06")]).toEqual([500, 105, 200, 42]);
    expect([annualBox(rows, "601"), annualBox(rows, "602")]).toEqual([100, 5.2]);
    expect(rows.find((row) => row.box === "REV")?.amount).toBe(5);
    // Volumen: 99 régimen general, 653 criterio de caja por la regla general, 108 total.
    expect([annualBox(rows, "99"), annualBox(rows, "653"), annualBox(rows, "108")]).toEqual([100, 1000, 1100]);
    expect([annualBox(rows, "654"), annualBox(rows, "655"), annualBox(rows, "656")]).toEqual([1000, 210, undefined]);
    expect([annualBox(rows, "115"), annualBox(rows, "116")]).toEqual([1100, 1100]);
    expect(rows.find((row) => row.box === "115")?.label).toContain("casilla 118: 100 %");
  });
});

describe("Modelo 303: rectificación de deducciones y criterio de caja", () => {
  it("lleva las rectificativas recibidas a las casillas 40-41 y no a 28-29", () => {
    const supplierVat = computeSupplierVat([
      received({ invoiceId: "compra", subtotal: 1000, taxAmount: 210, totalAmount: 1210 }),
      received({ invoiceId: "abono", documentKind: "RECTIFICATION", subtotal: -200, taxAmount: -42, totalAmount: -242, prorrataPct: 50 }),
    ], 100);
    const boxes = buildModelo303Boxes(computeIssuedVat([]), supplierVat, { periodYear: 2026 });
    expect([box(boxes, "28"), box(boxes, "29")]).toEqual([1000, 210]);
    // Base sin prorratear y cuota con la prorrata de la rectificativa, con su signo.
    expect([box(boxes, "40"), box(boxes, "41"), box(boxes, "45")]).toEqual([-200, -21, 189]);
    // Una anulación (sign −1) de una factura normal sigue restando en 28-29.
    const voided = computeSupplierVat([received({ sign: -1, voidedAt: issueDate })], 100);
    const voidedBoxes = buildModelo303Boxes(computeIssuedVat([]), voided, { periodYear: 2026 });
    expect([box(voidedBoxes, "29"), box(voidedBoxes, "41")]).toEqual([-21, undefined]);
  });

  it("informa 62-63 y 74-75, y la casilla 81 del volumen en el último periodo", () => {
    const issuedVat = computeIssuedVat([issued({ unitPrice: 1000, cashAccounting: true, portion: { from: 0, to: 0.25 } })]);
    const boxes = buildModelo303Boxes(issuedVat, computeSupplierVat([], 100), {
      periodYear: 2026,
      cashInfo: { salesBaseCents: 100_000, salesTaxCents: 21_000, purchaseBaseCents: 50_000, purchaseTaxCents: 10_500 },
      yearIssued: computeIssuedVat([issued({ invoiceId: "exenta", unitPrice: 300, taxRate: 0, treatment: "EXEMPT" })]),
      cashYearIssued: computeIssuedVat([issued({ unitPrice: 1000 })]),
    });
    // Devengado: solo el 25 % cobrado.
    expect([box(boxes, "07"), box(boxes, "09")]).toEqual([250, 52.5]);
    expect([box(boxes, "62"), box(boxes, "63"), box(boxes, "74"), box(boxes, "75")]).toEqual([1000, 210, 500, 105]);
    expect([box(boxes, "80"), box(boxes, "81"), box(boxes, "83"), box(boxes, "88")]).toEqual([0, 1000, 300, 1300]);
  });
});

describe("Modelo 349: clave de las ventas", () => {
  it("una entrega intracomunitaria es E aunque la línea no lleve artículo; S solo si el artículo es un servicio", () => {
    expect(modelo349SaleKey("INTRA_EU", null)).toBe("E");
    expect(modelo349SaleKey("INTRA_EU", false)).toBe("E");
    expect(modelo349SaleKey("INTRA_EU", true)).toBe("S");
    expect(modelo349SaleKey("INTRA_EU_SERVICES", null)).toBe("S");
    expect(modelo349SaleKey("INTRA_EU_SERVICES", false)).toBe("S");
  });
});

describe("Filtros fiscales: límites de periodo en hora local", () => {
  const dialect = new PgDialect();
  const isoParams = (params: unknown[]) => params.map((param) => (param instanceof Date ? param.toISOString() : param));

  it("el segundo trimestre empieza a las 00:00 de Madrid del 1 de abril (22:00 UTC del 31 de marzo)", () => {
    const query = dialect.sqlToQuery(issuedInvoiceFiscalFilter("company-1", new Date(Date.UTC(2026, 3, 1)), new Date(Date.UTC(2026, 6, 1)))!);
    expect(isoParams(query.params)).toEqual(expect.arrayContaining(["2026-03-31T22:00:00.000Z", "2026-06-30T22:00:00.000Z"]));
    const canary = dialect.sqlToQuery(supplierInvoiceFiscalFilter("company-1", new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 3, 1)), "Atlantic/Canary")!);
    expect(isoParams(canary.params)).toEqual(expect.arrayContaining(["2026-01-01T00:00:00.000Z", "2026-03-31T23:00:00.000Z"]));
  });
});

describe("Modelo 347: registros separados y criterio de caja", () => {
  it("separa en filas propias las operaciones con marca, mirando el umbral sobre el total del tercero", () => {
    const rows = groupThirdPartyOperations("supplier", [
      { taxId: "B12345678", name: "Proveedor", amount: 2000, quarter: 1 },
      { taxId: "ES-B12345678", name: "Proveedor (otra ficha)", amount: 1500, quarter: 2, flags: { reverseCharge: true } },
      { taxId: "B12345678", name: "Proveedor", amount: 500, quarter: 3, flags: { lease: true } },
      { taxId: "A00000000", name: "Pequeño", amount: 3000, quarter: 1, flags: { lease: true } },
    ]);
    // 4.000 € en total: se declara, en tres registros. El de 3.000 € no llega al umbral.
    expect(rows.map((row) => [row.taxId, row.amount, row.flags ?? null])).toEqual([
      ["B12345678", 2000, null],
      ["B12345678", 1500, { reverseCharge: true }],
      ["B12345678", 500, { lease: true }],
    ]);
    expect(rows[1].quarters).toEqual([0, 1500, 0, 0]);
  });

  it("las operaciones en criterio de caja van en cómputo anual, con el importe devengado según el régimen", () => {
    const operations = groupThirdPartyOperations("customer", [
      { taxId: "B12345678", name: "Cliente", amount: 6050, quarter: 1, flags: { cashAccounting: true } },
    ]);
    expect(operations[0]).toMatchObject({ amount: 6050, quarters: [0, 0, 0, 0], flags: { cashAccounting: true } });
    const withAccruals = attachCashAccruals("customer", operations, [
      { taxId: "B-12345678", name: "Cliente", cents: 242_000 },
      { taxId: "B12345678", name: "Cliente", cents: 121_000 },
      // Solo cobros de facturas del año anterior: fila nueva si supera el umbral; si no, nada.
      { taxId: "B99999999", name: "Cobrado del año pasado", cents: 400_000 },
      { taxId: "B11111111", name: "Poco", cents: 100_000 },
    ]);
    expect(withAccruals.map((row) => [row.taxId, row.amount, row.cashAccrualAmount])).toEqual([
      ["B12345678", 6050, 3630],
      ["B99999999", 0, 4000],
    ]);
  });
});

describe("Modelo 349: umbral de periodicidad mensual (art. 81.2 RIVA)", () => {
  it("es mensual si algún trimestre supera 50.000 € de entregas y servicios", () => {
    expect(modelo349RequiresMonthly([4_000_000, 5_000_000, 1_000])).toBe(false);
    expect(modelo349RequiresMonthly([4_000_000, 5_000_001])).toBe(true);
    expect(modelo349RequiresMonthly([])).toBe(false);
  });
});
