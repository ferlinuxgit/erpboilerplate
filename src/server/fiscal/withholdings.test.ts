import { describe, expect, it } from "vitest";

import {
  allocateWithholding,
  allocationChecks,
  computeModelo111,
  computeModelo115,
  computeModelo123,
  computeModelo180,
  computeModelo190,
  computeModelo193,
  itemsInRange,
  professionalSubkey,
  type WithholdingItem,
} from "@/server/fiscal/withholdings";

function item(overrides: Partial<WithholdingItem>): WithholdingItem {
  return {
    source: "supplierInvoice",
    sourceId: "doc",
    documentLabel: "FR-1",
    model: "111",
    date: "2026-02-10",
    allocation: "registration",
    recipientTaxId: "12345678Z",
    recipientName: "Ana Abogada",
    block: "economic",
    inKind: false,
    baseCents: 100_000,
    withheldCents: 15_000,
    rate: 15,
    key190: "G",
    subkey190: "01",
    ...overrides,
  };
}

const payroll = (overrides: Partial<WithholdingItem>) => item({ source: "payroll", block: "work", key190: "A", subkey190: null, recipientTaxId: "11111111H", recipientName: "Luis Empleado", ...overrides });
const box = (boxes: Array<{ box: string; amount: number }>, code: string) => boxes.find((entry) => entry.box === code)?.amount;

describe("computeModelo111", () => {
  it("separa trabajo y actividades económicas, dinerario y en especie, con sus casillas oficiales", () => {
    const result = computeModelo111([
      payroll({ baseCents: 200_000, withheldCents: 30_000 }),
      payroll({ recipientTaxId: "22222222J", recipientName: "Eva", baseCents: 150_000, withheldCents: 15_000 }),
      payroll({ inKind: true, baseCents: 10_000, withheldCents: 1_500 }),
      item({ baseCents: 100_000, withheldCents: 15_000 }),
      item({ sourceId: "doc2", baseCents: 50_000, withheldCents: 7_500 }),
      item({ model: "115", baseCents: 80_000, withheldCents: 15_200 }),
    ]);
    expect(box(result.boxes, "01")).toBe(2);
    expect(box(result.boxes, "02")).toBe(3500);
    expect(box(result.boxes, "03")).toBe(450);
    expect(box(result.boxes, "04")).toBe(1);
    expect(box(result.boxes, "05")).toBe(100);
    expect(box(result.boxes, "06")).toBe(15);
    // Dos facturas del mismo profesional: un solo perceptor.
    expect(box(result.boxes, "07")).toBe(1);
    expect(box(result.boxes, "08")).toBe(1500);
    expect(box(result.boxes, "09")).toBe(225);
    expect(box(result.boxes, "28")).toBe(690);
    expect(box(result.boxes, "30")).toBe(690);
    expect(result.resultCents).toBe(69_000);
  });

  it("numera las casillas de 01 a 30 sin huecos y deja la imagen en 25-27", () => {
    const result = computeModelo111([item({ block: "image", inKind: true, baseCents: 40_000, withheldCents: 9_600 })]);
    expect(result.boxes.map((entry) => entry.box)).toEqual(Array.from({ length: 30 }, (_, index) => String(index + 1).padStart(2, "0")));
    expect(box(result.boxes, "25")).toBe(1);
    expect(box(result.boxes, "26")).toBe(400);
    expect(box(result.boxes, "27")).toBe(96);
    expect(box(result.boxes, "28")).toBe(96);
  });

  it("resta la casilla 29 en una complementaria", () => {
    const result = computeModelo111([item({})], { previousCents: 10_000 });
    expect(box(result.boxes, "29")).toBe(100);
    expect(box(result.boxes, "30")).toBe(50);
  });
});

describe("computeModelo115 y computeModelo123", () => {
  it("115: perceptores, base, retención y resultado en las casillas 01-05", () => {
    const result = computeModelo115([
      item({ model: "115", baseCents: 80_000, withheldCents: 15_200, rate: 19 }),
      item({ model: "115", sourceId: "b", date: "2026-03-01", baseCents: 80_000, withheldCents: 15_200, rate: 19 }),
      item({}),
    ]);
    expect(result.boxes.map((entry) => [entry.box, entry.amount])).toEqual([["01", 1], ["02", 1600], ["03", 304], ["04", 0], ["05", 304]]);
  });

  it("123: dividendos y resto de rentas en las 14 casillas del diseño de 2024", () => {
    const result = computeModelo123([
      item({ model: "123", source: "capitalIncome", capitalKind: "dividend", baseCents: 1_000_000, withheldCents: 190_000 }),
      item({ model: "123", source: "capitalIncome", capitalKind: "dividend", recipientTaxId: "22222222J", baseCents: 500_000, withheldCents: 95_000 }),
      item({ model: "123", source: "capitalIncome", capitalKind: "interest", baseCents: 20_000, withheldCents: 3_800 }),
    ]);
    expect(result.boxes).toHaveLength(14);
    expect(box(result.boxes, "01")).toBe(2);
    expect(box(result.boxes, "02")).toBe(1);
    expect(box(result.boxes, "03")).toBe(3);
    expect(box(result.boxes, "06")).toBe(15_200);
    expect(box(result.boxes, "07")).toBe(2850);
    expect(box(result.boxes, "08")).toBe(38);
    expect(box(result.boxes, "09")).toBe(2888);
    expect(box(result.boxes, "12")).toBe(2888);
    expect(box(result.boxes, "14")).toBe(2888);
  });
});

describe("computeModelo190", () => {
  const items = [
    payroll({ date: "2026-01-31", baseCents: 200_000, withheldCents: 30_000 }),
    payroll({ date: "2026-02-28", baseCents: 200_000, withheldCents: 30_000 }),
    payroll({ date: "2026-02-28", inKind: true, baseCents: 5_000, withheldCents: 750 }),
    payroll({ date: "2026-05-31", key190: "E", subkey190: "04", recipientTaxId: "33333333P", recipientName: "Marta Administradora", baseCents: 300_000, withheldCents: 105_000 }),
    item({ date: "2026-04-10", baseCents: 100_000, withheldCents: 7_000, rate: 7, subkey190: professionalSubkey(7) }),
  ];

  it("agrupa por perceptor, clave y subclave y cuadra con los 111", () => {
    const result = computeModelo190(items, {
      periods: [
        { period: "2026-Q1", resultCents: 60_750, filed: true },
        { period: "2026-Q2", resultCents: 112_000, filed: false },
      ],
      personalData: new Map([["11111111H", { birthYear: 1985, familySituation: 3, contractType: 1 }]]),
    });
    expect(result.recipients).toHaveLength(3);
    const employee = result.recipients.find((row) => row.key === "A");
    expect(employee).toMatchObject({ cashCents: 400_000, withheldCents: 60_000, inKindCents: 5_000, inKindWithheldCents: 750, personal: { birthYear: 1985 } });
    expect(result.recipients.find((row) => row.key === "E")).toMatchObject({ subkey: "04", withheldCents: 105_000 });
    expect(result.recipients.find((row) => row.key === "G")).toMatchObject({ subkey: "03" });
    expect(result.totalWithheldCents).toBe(172_750);
    expect(result.reconciliation.balanced).toBe(true);
    expect(result.checks.filter((check) => check.status === "blocking")).toEqual([]);
  });

  it("avisa de forma bloqueante si la suma de los 111 no coincide", () => {
    const result = computeModelo190(items, { periods: [{ period: "2026-Q1", resultCents: 50_000, filed: true }] });
    expect(result.reconciliation).toMatchObject({ balanced: false, differenceCents: 122_750 });
    expect(result.checks.find((check) => check.code === "model-190-reconciliation")?.status).toBe("blocking");
    // Sin datos personales del empleado: aviso, no bloqueo.
    expect(result.checks.find((check) => check.code === "model-190-personal-data")?.status).toBe("warning");
  });

  it("bloquea los perceptores sin NIF", () => {
    const result = computeModelo190([item({ recipientTaxId: null })], { periods: [{ period: "2026-Q1", resultCents: 15_000, filed: false }] });
    expect(result.checks.find((check) => check.code === "model-190-missing-tax-id")?.status).toBe("blocking");
  });

  it("subclave G: 03 para el tipo reducido del 7 % y 01 para el resto", () => {
    expect(professionalSubkey(7)).toBe("03");
    expect(professionalSubkey(15)).toBe("01");
    expect(professionalSubkey(null)).toBe("01");
  });
});

describe("computeModelo180 y computeModelo193", () => {
  it("180: un registro por arrendador con su inmueble y el último tipo aplicado", () => {
    const rent = (overrides: Partial<WithholdingItem>) => item({ model: "115", recipientTaxId: "B12345678", recipientName: "Locales SL", rate: 19, baseCents: 100_000, withheldCents: 19_000, ...overrides });
    const result = computeModelo180(
      [rent({ date: "2026-01-05" }), rent({ date: "2026-02-05" }), rent({ recipientTaxId: "44444444A", recipientName: "Casero sin ficha" })],
      {
        periods: [{ period: "2026-Q1", resultCents: 57_000, filed: false }],
        properties: new Map([["B12345678", [{ situation: "1", cadastralReference: "9872023VH5797S0001WX", address: "Calle Mayor 1", postalCode: "28001", city: "Madrid", province: "Madrid" }]]]),
      },
    );
    expect(result.recipients.find((row) => row.taxId === "B12345678")).toMatchObject({ baseCents: 200_000, withheldCents: 38_000, rate: 19, modality: "1", property: { cadastralReference: "9872023VH5797S0001WX" } });
    expect(result.reconciliation.balanced).toBe(true);
    expect(result.checks.find((check) => check.code === "model-180-missing-property")?.status).toBe("warning");
  });

  it("193: dividendos con clave A/02 e intereses con clave B/03, y cuadre con los 123", () => {
    const capital = (overrides: Partial<WithholdingItem>) => item({ model: "123", source: "capitalIncome", rate: 19, ...overrides });
    const result = computeModelo193(
      [
        capital({ capitalKind: "dividend", baseCents: 1_000_000, withheldCents: 190_000 }),
        capital({ capitalKind: "interest", baseCents: 20_000, withheldCents: 3_800 }),
      ],
      { periods: [{ period: "2026-Q1", resultCents: 190_000, filed: true }] },
    );
    expect(result.recipients.map((row) => [row.key, row.nature, row.withheldCents])).toEqual([["A", "02", 190_000], ["B", "03", 3_800]]);
    expect(result.checks[0]).toMatchObject({ code: "model-193-reconciliation", status: "blocking" });
  });
});

describe("allocateWithholding", () => {
  const base = { fallbackDate: "2026-03-20", fallbackKind: "registration" as const, payableCents: 106_000, baseCents: 100_000, withheldCents: 15_000 };

  it("sin criterio de pago, todo va a la fecha de registro", () => {
    expect(allocateWithholding({ ...base, basis: "fallback", payments: [{ date: "2026-04-10", cents: 106_000 }] })).toEqual([
      { date: "2026-03-20", allocation: "registration", baseCents: 100_000, withheldCents: 15_000 },
    ]);
  });

  it("con criterio de pago, la factura pagada va a la fecha del pago", () => {
    expect(allocateWithholding({ ...base, basis: "payment", payments: [{ date: "2026-04-10", cents: 106_000 }] })).toEqual([
      { date: "2026-04-10", allocation: "payment", baseCents: 100_000, withheldCents: 15_000 },
    ]);
  });

  it("sin pago, se queda en la fecha de registro y se marca como impagada", () => {
    expect(allocateWithholding({ ...base, basis: "payment", payments: [] })).toEqual([
      { date: "2026-03-20", allocation: "registration-unpaid", baseCents: 100_000, withheldCents: 15_000 },
    ]);
  });

  it("reparte los pagos parciales sin perder céntimos", () => {
    const portions = allocateWithholding({
      ...base,
      basis: "payment",
      payments: [{ date: "2026-04-10", cents: 35_333 }, { date: "2026-07-02", cents: 35_333 }],
    });
    expect(portions.map((portion) => portion.allocation)).toEqual(["payment", "payment", "registration-unpaid"]);
    expect(portions.reduce((total, portion) => total + portion.withheldCents, 0)).toBe(15_000);
    expect(portions.reduce((total, portion) => total + portion.baseCents, 0)).toBe(100_000);
    expect(portions[0]).toMatchObject({ date: "2026-04-10", withheldCents: 5_000 });
  });

  it("si el periodo de registro ya está presentado, no la mueve al periodo del pago", () => {
    const filedPeriodOf = (date: string) => (date < "2026-04-01" ? "2026-Q1" : null);
    expect(allocateWithholding({ ...base, basis: "payment", payments: [{ date: "2026-04-10", cents: 106_000 }], filedPeriodOf })).toEqual([
      { date: "2026-03-20", allocation: "registration-filed", baseCents: 100_000, withheldCents: 15_000 },
    ]);
    // Pagada dentro del mismo periodo presentado: imputación normal por pago.
    expect(allocateWithholding({ ...base, basis: "payment", payments: [{ date: "2026-03-25", cents: 106_000 }], filedPeriodOf })[0]).toMatchObject({ date: "2026-03-25", allocation: "payment" });
  });

  it("las rectificativas negativas van por su fecha de registro", () => {
    expect(allocateWithholding({ ...base, basis: "payment", payableCents: -106_000, baseCents: -100_000, withheldCents: -15_000, payments: [] })[0]).toMatchObject({ allocation: "registration", withheldCents: -15_000 });
  });

  it("nóminas: por devengo mensual o por fecha de pago", () => {
    const slip = { fallbackDate: "2026-12-31", fallbackKind: "accrual" as const, payableCents: 150_000, baseCents: 200_000, withheldCents: 30_000, payments: [{ date: "2027-01-03", cents: 150_000 }] };
    expect(allocateWithholding({ ...slip, basis: "fallback" })[0]).toMatchObject({ date: "2026-12-31", allocation: "accrual" });
    expect(allocateWithholding({ ...slip, basis: "payment" })[0]).toMatchObject({ date: "2027-01-03", allocation: "payment" });
  });
});

describe("itemsInRange y allocationChecks", () => {
  it("filtra por fecha civil con fin excluido", () => {
    const list = [item({ date: "2026-03-31" }), item({ date: "2026-04-01" })];
    expect(itemsInRange(list, "2026-01-01", "2026-04-01")).toHaveLength(1);
  });

  it("avisa del criterio de registro y de las facturas sin pago", () => {
    expect(allocationChecks([item({})], "registration").map((check) => check.code)).toEqual(["withholding-registration-basis"]);
    expect(allocationChecks([item({ allocation: "registration-unpaid" })], "payment").map((check) => check.code)).toEqual(["withholding-unpaid"]);
    expect(allocationChecks([payroll({ allocation: "accrual" })], "registration")).toEqual([]);
  });
});
