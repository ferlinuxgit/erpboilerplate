import { describe, expect, it } from "vitest";

import { matchRentalProperty } from "@/server/payroll/rental-match";
import { buildPayrollReceipt } from "@/server/payroll/receipt-model";
import { renderPayrollReceiptPdf } from "@/server/payroll/receipt-pdf";
import { readModelo190Extra } from "@/server/payroll/schemas";

const base = {
  period: "2026-06",
  concept: "Paga extra de junio",
  slipType: "extra",
  accrualDate: "2026-06-30",
  company: { name: "Ejemplo SL", taxId: "B12345678", address: "Calle Mayor 1, 28001 Madrid" },
  employee: { name: "Ana López", taxId: "12345678Z", socialSecurityNumber: "281234567890", startDate: "2020-01-15" },
};

describe("recibo de salarios", () => {
  it("ordena devengos y deducciones y llega al mismo líquido", () => {
    const receipt = buildPayrollReceipt({
      ...base,
      grossAmount: 2000,
      inKindAmount: 200,
      inKindWithholdingAmount: 30,
      withholdingAmount: 300,
      employeeSocialSecurity: 127,
      employerSocialSecurity: 620,
      netAmount: 1523,
      otherDeductions: [{ kind: "union", concept: "Cuota sindical", amountCents: 20_00, accountCode: "4659" }],
    });
    expect(receipt.title).toBe("Paga extra · Paga extra de junio");
    expect(receipt.totalEarningsCents).toBe(2200_00);
    expect(receipt.netCents).toBe(1523_00);
    expect(receipt.deductions.map((line) => line.label)).toContain("Cuota sindical");
    expect(receipt.information).toEqual([{ label: "Seguridad Social a cargo de la empresa", cents: 620_00 }]);
  });

  it("separa la indemnización del finiquito", () => {
    const receipt = buildPayrollReceipt({ ...base, slipType: "settlement", concept: "Finiquito", grossAmount: 5000, severanceAmount: 3000, severanceExemptAmount: 3000, netAmount: 5000 });
    expect(receipt.title).toBe("Finiquito");
    expect(receipt.earnings).toEqual([
      { label: "Salario y complementos", cents: 2000_00 },
      { label: "Indemnización", cents: 3000_00, note: "exenta: 3.000,00 €" },
    ]);
  });

  it("genera el PDF", async () => {
    const pdf = await renderPayrollReceiptPdf(buildPayrollReceipt({ ...base, grossAmount: 1500, withholdingAmount: 150, netAmount: 1350 }));
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  }, 30_000);
});

describe("regla del inmueble alquilado (180)", () => {
  const rules = [
    { id: "local", matchAccountCode: "6210001", matchText: null },
    { id: "almacen", matchAccountCode: null, matchText: "Polígono Sur" },
    { id: "sin-regla", matchAccountCode: null, matchText: null },
  ];

  it("asocia por subcuenta o por texto, sin tildes ni mayúsculas", () => {
    expect(matchRentalProperty(rules, { expenseAccountCode: "6210001", description: "Alquiler", supplierNumber: null })).toBe("local");
    expect(matchRentalProperty(rules, { expenseAccountCode: "6210000", description: "Alquiler nave POLIGONO sur", supplierNumber: null })).toBe("almacen");
    expect(matchRentalProperty(rules, { expenseAccountCode: "6210000", description: "Alquiler", supplierNumber: "F-1" })).toBeNull();
  });

  it("exige las dos condiciones si el inmueble tiene las dos", () => {
    const both = [{ id: "x", matchAccountCode: "6210002", matchText: "Mayor" }];
    expect(matchRentalProperty(both, { expenseAccountCode: "6210002", description: "Calle Mayor", supplierNumber: null })).toBe("x");
    expect(matchRentalProperty(both, { expenseAccountCode: "6210002", description: "Calle Menor", supplierNumber: null })).toBeNull();
  });
});

describe("datos adicionales del 190", () => {
  it("lee los del ejercicio y descarta los no válidos", () => {
    const stored = { "2026": { reductionsCents: 100_00, descendantsUnder3: { total: 1, whole: 1 }, housingLoanCommunication: true }, "2025": { descendantsRest: { total: 1, whole: 3 } } };
    expect(readModelo190Extra(stored, 2026)).toMatchObject({ reductionsCents: 100_00, housingLoanCommunication: true });
    expect(readModelo190Extra(stored, 2025)).toBeNull();
    expect(readModelo190Extra(stored, 2024)).toBeNull();
  });
});
