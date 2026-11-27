import { describe, expect, it } from "vitest";

import {
  defaultInvestmentGood,
  defaultSurchargeRate,
  isSupplierCreditBalance,
  looksLikeRectification,
  parseSupplierDocumentKind,
  rectificationLinesFrom,
  rectificationReferenceProblem,
  supplierCreditAllocationCents,
  supplierCreditRemainingCents,
  supplierLinesProblem,
  supplierOutstandingCents,
  supplierPaymentStatus,
  supplierTaxIdProblem,
  surchargeTreatmentProblem,
} from "@/server/supplier-invoices/document-rules";

describe("clase de documento", () => {
  it("cualquier valor desconocido es una factura normal", () => {
    expect(parseSupplierDocumentKind("RECTIFICATION")).toBe("RECTIFICATION");
    expect(parseSupplierDocumentKind("INVOICE")).toBe("INVOICE");
    expect(parseSupplierDocumentKind(undefined)).toBe("INVOICE");
    expect(parseSupplierDocumentKind("abono")).toBe("INVOICE");
  });
});

describe("supplierLinesProblem", () => {
  const line = (quantity: number, unitPrice: number) => ({ description: "Servicio", quantity, unitPrice });

  it("una factura normal sigue sin admitir cantidades ni precios negativos", () => {
    expect(supplierLinesProblem([line(1, 100)], "INVOICE")).toBeNull();
    expect(supplierLinesProblem([line(1, 0)], "INVOICE")).toBeNull();
    expect(supplierLinesProblem([line(-1, 100)], "INVOICE")).toMatch(/mayor que cero/);
    expect(supplierLinesProblem([line(0, 100)], "INVOICE")).toMatch(/mayor que cero/);
    expect(supplierLinesProblem([line(1, -100)], "INVOICE")).toMatch(/no puede ser negativo/);
  });

  it("una rectificativa admite líneas negativas (abono) y positivas (diferencia al alza), pero no a cero", () => {
    expect(supplierLinesProblem([line(-1, 100)], "RECTIFICATION")).toBeNull();
    expect(supplierLinesProblem([line(1, -100)], "RECTIFICATION")).toBeNull();
    expect(supplierLinesProblem([line(-2, 50), line(1, 10)], "RECTIFICATION")).toBeNull();
    expect(supplierLinesProblem([line(0, 100)], "RECTIFICATION")).toMatch(/a cero/);
    expect(supplierLinesProblem([line(-1, 0)], "RECTIFICATION")).toMatch(/a cero/);
  });

  it("exige líneas, descripción e importes numéricos en las dos clases", () => {
    expect(supplierLinesProblem([], "RECTIFICATION")).toMatch(/al menos una línea/);
    expect(supplierLinesProblem([{ description: " ", quantity: 1, unitPrice: 1 }], "INVOICE")).toMatch(/descripción/);
    expect(supplierLinesProblem([line(Number.NaN, 1)], "RECTIFICATION")).toMatch(/números válidos/);
  });
});

describe("rectificationReferenceProblem", () => {
  it("una rectificativa necesita la factura rectificada, su número o un motivo", () => {
    expect(rectificationReferenceProblem({ kind: "RECTIFICATION" })).toMatch(/factura que se rectifica/);
    expect(rectificationReferenceProblem({ kind: "RECTIFICATION", rectifiedInvoiceId: "si-1" })).toBeNull();
    expect(rectificationReferenceProblem({ kind: "RECTIFICATION", rectifiedDocumentNumber: " F-1 " })).toBeNull();
    expect(rectificationReferenceProblem({ kind: "RECTIFICATION", rectificationReason: "Rappel anual" })).toBeNull();
    expect(rectificationReferenceProblem({ kind: "RECTIFICATION", rectifiedDocumentNumber: "  ", rectificationReason: "" })).not.toBeNull();
  });

  it("no se aplica a una factura normal", () => {
    expect(rectificationReferenceProblem({ kind: "INVOICE" })).toBeNull();
  });
});

describe("supplierPaymentStatus", () => {
  const now = new Date("2026-06-01T00:00:00.000Z");
  const overdue = new Date("2026-05-01T00:00:00.000Z");

  it("mantiene las reglas de una factura a pagar", () => {
    expect(supplierPaymentStatus(100, 0, null, now)).toBe("PENDING");
    expect(supplierPaymentStatus(100, 0, overdue, now)).toBe("OVERDUE");
    expect(supplierPaymentStatus(100, 40, overdue, now)).toBe("PARTIAL");
    expect(supplierPaymentStatus(100, 100, overdue, now)).toBe("PAID");
  });

  it("un abono (total negativo o cero) nunca queda pendiente ni vencido", () => {
    expect(supplierPaymentStatus(-121, 0, null, now)).toBe("PAID");
    expect(supplierPaymentStatus(-121, 0, overdue, now)).toBe("PAID");
    expect(supplierPaymentStatus(0, 0, overdue, now)).toBe("PAID");
  });

  it("saldo a favor: total negativo de un documento no anulado", () => {
    expect(isSupplierCreditBalance({ totalAmount: "-121.00", status: "POSTED" })).toBe(true);
    expect(isSupplierCreditBalance({ totalAmount: "-121.00", status: "VOID" })).toBe(false);
    expect(isSupplierCreditBalance({ totalAmount: 121 })).toBe(false);
  });
});

describe("supplierTaxIdProblem", () => {
  it("exige el NIF de un proveedor nacional salvo ticket o factura simplificada", () => {
    expect(supplierTaxIdProblem({ taxId: "B12345674", supplierCountryCode: "ES" })).toBeNull();
    expect(supplierTaxIdProblem({ taxId: "  ", supplierCountryCode: "ES" })).toMatch(/NIF del proveedor/);
    expect(supplierTaxIdProblem({ taxId: null })).toMatch(/NIF del proveedor/);
    expect(supplierTaxIdProblem({ taxId: null, isSimplified: true })).toBeNull();
  });

  it("exige el NIF-IVA en adquisiciones intracomunitarias pero no a un proveedor de fuera de la UE", () => {
    expect(supplierTaxIdProblem({ taxId: null, supplierCountryCode: "FR", homeCountryCode: "ES", vatTreatment: "INTRA_EU" })).not.toBeNull();
    expect(supplierTaxIdProblem({ taxId: null, supplierCountryCode: "US", homeCountryCode: "ES", vatTreatment: "REVERSE_CHARGE" })).toBeNull();
    expect(supplierTaxIdProblem({ taxId: null, supplierCountryCode: "CN", homeCountryCode: "ES", vatTreatment: "IMPORT" })).toBeNull();
  });
});

describe("recargo de equivalencia y bienes de inversión", () => {
  it("el recargo solo se admite cuando el proveedor repercute IVA", () => {
    expect(surchargeTreatmentProblem("DOMESTIC", true)).toBeNull();
    expect(surchargeTreatmentProblem("IMPORT", true)).toBeNull();
    expect(surchargeTreatmentProblem("INTRA_EU", true)).toMatch(/recargo de equivalencia/);
    expect(surchargeTreatmentProblem("NOT_SUBJECT", true)).not.toBeNull();
    expect(surchargeTreatmentProblem("INTRA_EU", false)).toBeNull();
  });

  it("por defecto es bien de inversión lo que va a una cuenta del grupo 2", () => {
    expect(defaultInvestmentGood("21700000")).toBe(true);
    expect(defaultInvestmentGood("62900000")).toBe(false);
    expect(defaultInvestmentGood(null)).toBe(false);
  });
});

describe("rectificationLinesFrom", () => {
  it("propone el abono total: mismas líneas con la cantidad en negativo y sus tipos, cuentas y marcas", () => {
    const lines = rectificationLinesFrom([
      { description: "Tornillos", quantity: "3.000", unitPrice: "10.50", taxRate: "21.000", taxDeductiblePct: "100.000", retentionRate: "0.000", surchargeRate: "5.200", expenseAccountId: "acc-600", isInvestmentGood: false },
      { description: "Torno", quantity: "1.000", unitPrice: "900.00", taxRate: "21.000", taxDeductiblePct: "50.000", retentionRate: "0.000", expenseAccountId: null, isInvestmentGood: true },
    ]);
    expect(lines).toEqual([
      { description: "Tornillos", quantity: -3, unitPrice: 10.5, taxRate: 21, taxDeductiblePct: 100, retentionRate: 0, surchargeRate: 5.2, expenseAccountId: "acc-600", isInvestmentGood: false },
      { description: "Torno", quantity: -1, unitPrice: 900, taxRate: 21, taxDeductiblePct: 50, retentionRate: 0, surchargeRate: 0, expenseAccountId: "", isInvestmentGood: true },
    ]);
  });
});

describe("looksLikeRectification (OCR)", () => {
  it("reconoce rectificativas, abonos y notas de crédito", () => {
    expect(looksLikeRectification("FACTURA RECTIFICATIVA R-2026/004")).toBe(true);
    expect(looksLikeRectification("Nota de abono nº 12")).toBe(true);
    expect(looksLikeRectification("Nota de crédito")).toBe(true);
    expect(looksLikeRectification("CREDIT NOTE CN-0001")).toBe(true);
    expect(looksLikeRectification("Abono de factura F-2026-10")).toBe(true);
  });

  it("no confunde una factura normal ni un abono bancario de suscripción", () => {
    expect(looksLikeRectification("FACTURA F-2026/0001\nTotal 121,00")).toBe(false);
    expect(looksLikeRectification("Abono mensual de fibra 600 Mb")).toBe(false);
    expect(looksLikeRectification("Forma de pago: abono en cuenta")).toBe(false);
  });
});

describe("pendiente de pago y saldo a favor (compensación de abonos)", () => {
  it("lo pendiente de una factura es total − pagos − abonos compensados, nunca negativo", () => {
    expect(supplierOutstandingCents({ totalCents: 12_100, paidCents: 0 })).toBe(12_100);
    expect(supplierOutstandingCents({ totalCents: 12_100, paidCents: 5_000, creditedCents: 2_100 })).toBe(5_000);
    expect(supplierOutstandingCents({ totalCents: 12_100, paidCents: 10_000, creditedCents: 12_100 })).toBe(0);
  });

  it("una factura anulada o un abono no tienen nada pendiente", () => {
    expect(supplierOutstandingCents({ totalCents: 12_100, paidCents: 0, isVoid: true })).toBe(0);
    expect(supplierOutstandingCents({ totalCents: -12_100, paidCents: 0 })).toBe(0);
  });

  it("el saldo a favor de un abono es su importe menos lo ya compensado o devuelto", () => {
    expect(supplierCreditRemainingCents({ totalCents: -6_050, appliedCents: 0 })).toBe(6_050);
    expect(supplierCreditRemainingCents({ totalCents: -6_050, appliedCents: 6_000 })).toBe(50);
    expect(supplierCreditRemainingCents({ totalCents: -6_050, appliedCents: 9_000 })).toBe(0);
    expect(supplierCreditRemainingCents({ totalCents: -6_050, appliedCents: 0, isVoid: true })).toBe(0);
    // Una rectificativa al alza no es un abono.
    expect(supplierCreditRemainingCents({ totalCents: 6_050, appliedCents: 0 })).toBe(0);
  });

  it("un abono compensa hasta lo pendiente de la factura; el resto queda a favor", () => {
    // Abono de 100 contra una factura con 60 pendientes: se compensan 60 y quedan 40 a favor.
    expect(supplierCreditAllocationCents(10_000, 6_000)).toBe(6_000);
    expect(supplierCreditAllocationCents(3_000, 6_000)).toBe(3_000);
    // Factura ya pagada: no se compensa nada, todo el abono es saldo a favor.
    expect(supplierCreditAllocationCents(10_000, 0)).toBe(0);
  });

  it("la factura cubierta por su abono queda pagada sin pagos", () => {
    expect(supplierPaymentStatus(121, 121, new Date("2020-01-01"))).toBe("PAID");
    expect(supplierPaymentStatus(121, 21, null)).toBe("PARTIAL");
  });
});

describe("recargo de equivalencia por defecto", () => {
  it("propone el recargo del tipo de IVA (art. 161 LIVA) y nada para tipos desconocidos", () => {
    expect(defaultSurchargeRate(21)).toBe(5.2);
    expect(defaultSurchargeRate(10)).toBe(1.4);
    expect(defaultSurchargeRate(4)).toBe(0.5);
    expect(defaultSurchargeRate(0)).toBe(0);
    expect(defaultSurchargeRate(7)).toBe(0);
  });
});
