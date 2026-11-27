import { describe, expect, it } from "vitest";

import type { InvoicePartySnapshot } from "@/db/schema";
import {
  cashPaymentProblem,
  chronologicalOrderProblem,
  civilDateKey,
  equivalenceSurchargeProblem,
  intraEuCustomerProblem,
  isEntityTaxId,
  issueWarnings,
  issuerDataProblem,
  paymentTermDays,
  paymentTermWarning,
  recipientDataProblem,
  simplifiedLimitProblem,
  spanishTaxIdCheckDigitWarning,
  viesValidationProblem,
} from "@/server/invoices/issue-checks";

const party = (values: Partial<InvoicePartySnapshot>): InvoicePartySnapshot => ({
  name: "Empresa", legalName: "Empresa S.L.", taxId: "B12345674", address: "Calle Mayor 1", addressLine2: null, postalCode: "28001", city: "Madrid", province: "Madrid", countryCode: "ES", ...values,
});

describe("comprobaciones antes de emitir", () => {
  it("exige nombre, NIF y domicilio completos del emisor", () => {
    expect(issuerDataProblem(party({}))).toBeNull();
    expect(issuerDataProblem(party({ taxId: null, postalCode: " " }))).toContain("cif/nif, código postal");
    // Fuera de España la provincia no es obligatoria.
    expect(issuerDataProblem(party({ countryCode: "FR", province: null }))).toBeNull();
  });

  it("exige el domicilio del destinatario a entidades y a clientes extranjeros con NIF-IVA, no a particulares", () => {
    expect(isEntityTaxId("B12345674")).toBe(true);
    expect(isEntityTaxId("12345678Z")).toBe(false);
    expect(isEntityTaxId("X1234567L")).toBe(false);
    expect(recipientDataProblem(party({ address: null }), "ES")).toContain("falta dirección");
    expect(recipientDataProblem(party({ taxId: "12345678Z", address: null, city: null }), "ES")).toBeNull();
    expect(recipientDataProblem(party({ taxId: null, address: null }), "ES")).toBeNull();
    expect(recipientDataProblem(party({ taxId: "DE123456789", countryCode: "DE", postalCode: null }), "ES")).toBeNull();
    expect(recipientDataProblem(party({ taxId: "DE123456789", countryCode: "DE", city: null }), "ES")).toContain("población");
  });

  it("limita la factura sin NIF a 400 € o al límite configurado, nunca más de 3.000 €", () => {
    expect(simplifiedLimitProblem({ customerTaxId: "B12345674", totalAmount: 50_000, limit: 400 })).toBeNull();
    expect(simplifiedLimitProblem({ customerTaxId: null, totalAmount: 400, limit: 400 })).toBeNull();
    expect(simplifiedLimitProblem({ customerTaxId: " ", totalAmount: 400.01, limit: 400 })).toContain("400,00 €");
    expect(simplifiedLimitProblem({ customerTaxId: null, totalAmount: 2_900, limit: 3_000 })).toBeNull();
    expect(simplifiedLimitProblem({ customerTaxId: null, totalAmount: 3_500, limit: 10_000 })).toContain("3.000,00 €");
    // Una devolución (rectificativa de simplificada) cuenta en valor absoluto.
    expect(simplifiedLimitProblem({ customerTaxId: null, totalAmount: -500, limit: 400 })).not.toBeNull();
  });

  it("pide el recargo de equivalencia en las líneas de bienes con IVA", () => {
    const vat = { kind: "VAT", operation: "ADD", rate: 21 };
    const surcharge = { kind: "SURCHARGE", operation: "ADD", rate: 5.2 };
    expect(equivalenceSurchargeProblem([{ description: "Camisetas", isService: false, taxes: [vat, surcharge] }])).toBeNull();
    expect(equivalenceSurchargeProblem([{ description: "Camisetas", isService: false, taxes: [vat] }])).toContain("«Camisetas»");
    // Servicios, líneas sin artículo y líneas exentas no llevan recargo.
    expect(equivalenceSurchargeProblem([
      { description: "Transporte", isService: true, taxes: [vat] },
      { description: "Texto libre", isService: null, taxes: [vat] },
      { description: "Libro exento", isService: false, taxes: [] },
    ])).toBeNull();
  });

  it("no deja emitir con fecha anterior a la última factura de la serie", () => {
    const last = { number: "FA000010", issueDate: new Date("2026-11-20T00:00:00.000Z") };
    expect(chronologicalOrderProblem({ issueDate: new Date("2026-11-20T00:00:00.000Z"), lastIssued: last })).toBeNull();
    expect(chronologicalOrderProblem({ issueDate: new Date("2026-11-27T10:00:00.000Z"), lastIssued: last })).toBeNull();
    expect(chronologicalOrderProblem({ issueDate: new Date("2026-11-19T00:00:00.000Z"), lastIssued: last })).toContain("20/11/2026");
    expect(chronologicalOrderProblem({ issueDate: new Date("2026-11-19T00:00:00.000Z"), lastIssued: null })).toBeNull();
  });

  it("toma el día civil en hora peninsular para los instantes y tal cual para las fechas de formulario", () => {
    // Ticket del TPV a las 00:30 del 1 de abril en Madrid (22:30 UTC del 31 de marzo).
    expect(civilDateKey(new Date("2026-03-31T22:30:00.000Z"))).toBe("2026-04-01");
    expect(civilDateKey(new Date("2026-04-01T00:00:00.000Z"))).toBe("2026-04-01");
    expect(civilDateKey(new Date("2026-12-31T23:30:00.000Z"))).toBe("2027-01-01");
  });

  it("no deja cobrar en efectivo operaciones de 1.000 € o más (10.000 € si es un particular no residente)", () => {
    expect(cashPaymentProblem({ methodType: "CASH", invoiceTotal: 999.99, customerCountry: "ES" })).toBeNull();
    expect(cashPaymentProblem({ methodType: "CASH", invoiceTotal: 1000, customerCountry: "ES" })).toContain("1.000 €");
    expect(cashPaymentProblem({ methodType: "TRANSFER", invoiceTotal: 50_000, customerCountry: "ES" })).toBeNull();
    expect(cashPaymentProblem({ methodType: "CASH", invoiceTotal: 5_000, customerCountry: "FR", customerTaxId: null })).toBeNull();
    expect(cashPaymentProblem({ methodType: "CASH", invoiceTotal: 12_000, customerCountry: "FR", customerTaxId: null })).toContain("10.000 €");
  });
});


describe("límite de la simplificada según la clase de documento", () => {
  it("se aplica a las dos clases simplificadas y nunca a la completa", () => {
    expect(simplifiedLimitProblem({ documentClass: "FULL", customerTaxId: null, totalAmount: 5_000, limit: 400 })).toBeNull();
    expect(simplifiedLimitProblem({ documentClass: "SIMPLIFIED", customerTaxId: "B12345674", totalAmount: 401, limit: 400 })).toContain("factura completa");
    expect(simplifiedLimitProblem({ documentClass: "SIMPLIFIED_QUALIFIED", customerTaxId: "B12345674", totalAmount: 401, limit: 400 })).toContain("400,00 €");
    expect(simplifiedLimitProblem({ documentClass: "SIMPLIFIED_QUALIFIED", customerTaxId: "B12345674", totalAmount: 400, limit: 400 })).toBeNull();
  });
});

describe("operaciones intracomunitarias", () => {
  it("el cliente debe ser de otro país de la UE", () => {
    expect(intraEuCustomerProblem({ customerCountry: "FR", issuerCountry: "ES" })).toBeNull();
    expect(intraEuCustomerProblem({ customerCountry: "ES", issuerCountry: "ES" })).toMatch(/OTRO país/);
    expect(intraEuCustomerProblem({ customerCountry: "US", issuerCountry: "ES" })).toMatch(/no es de la UE/);
    expect(intraEuCustomerProblem({ customerCountry: null, issuerCountry: "ES" })).not.toBeNull();
  });

  it("VIES: válido y reciente, o hace falta confirmación", () => {
    const at = new Date("2026-11-27T10:00:00Z");
    expect(viesValidationProblem({ status: "VALID", checkedAt: new Date("2026-10-01T00:00:00Z"), at })).toBeNull();
    expect(viesValidationProblem({ status: "VALID", checkedAt: new Date("2026-06-01T00:00:00Z"), at })).toMatch(/más de 90 días/);
    expect(viesValidationProblem({ status: "INVALID", checkedAt: new Date("2026-11-20T00:00:00Z"), at })).toMatch(/NO consta/);
    expect(viesValidationProblem({ status: null, checkedAt: null, at })).toMatch(/no está comprobado/);
    expect(viesValidationProblem({ status: "UNAVAILABLE", checkedAt: new Date("2026-11-20T00:00:00Z"), at })).toMatch(/no está comprobado/);
  });
});

describe("avisos que no bloquean", () => {
  it("plazo de pago de más de 60 días", () => {
    expect(paymentTermWarning(60)).toBeNull();
    expect(paymentTermWarning(null)).toBeNull();
    expect(paymentTermWarning(90)).toMatch(/Ley 3\/2004/);
    expect(paymentTermDays(new Date("2026-01-01T00:00:00Z"), new Date("2026-04-01T00:00:00Z"))).toBe(90);
  });

  it("NIF español con el dígito de control mal", () => {
    expect(spanishTaxIdCheckDigitWarning("B12345674", "ES")).toBeNull();
    expect(spanishTaxIdCheckDigitWarning("B12345678", "ES")).toMatch(/control/);
    expect(spanishTaxIdCheckDigitWarning("12345678A", null)).toMatch(/control/);
    expect(spanishTaxIdCheckDigitWarning("12345678Z", "ES")).toBeNull();
    // Formato no español o cliente extranjero: no se opina.
    expect(spanishTaxIdCheckDigitWarning("FR12345678901", "FR")).toBeNull();
    expect(spanishTaxIdCheckDigitWarning("ABC", "ES")).toBeNull();
    expect(spanishTaxIdCheckDigitWarning(null, "ES")).toBeNull();
  });

  it("reúne los avisos de un borrador", () => {
    const base = { invoiceType: "INVOICE", customerTaxId: "FR12345678901", customerCountry: "FR", issuerCountry: "ES", issueDate: new Date("2026-11-27T00:00:00Z"), dueDate: null };
    const intra = issueWarnings({ ...base, vatTreatment: "INTRA_EU", vies: null });
    expect(intra).toEqual([expect.objectContaining({ code: "VIES", requiresConfirmation: true })]);
    expect(issueWarnings({ ...base, vatTreatment: "INTRA_EU", vies: { status: "VALID", checkedAt: new Date("2026-11-01T00:00:00Z") } })).toEqual([]);
    expect(issueWarnings({ ...base, vatTreatment: "EXPORT" }).map((warning) => warning.code)).toEqual(["EXPORT_COUNTRY"]);
    expect(issueWarnings({ ...base, vatTreatment: "DOMESTIC", dueDate: new Date("2027-03-27T00:00:00Z") }).map((warning) => warning.code)).toEqual(["PAYMENT_TERM"]);
    expect(issueWarnings({ ...base, vatTreatment: "DOMESTIC", defaultTermDays: 90, customerTaxId: null }).map((warning) => warning.code)).toEqual([]);
    expect(issueWarnings({ ...base, vatTreatment: "DOMESTIC", hasUntaxedDomesticBase: true }).map((warning) => warning.code)).toEqual(["UNTAXED_BASE"]);
    expect(issueWarnings({ ...base, vatTreatment: "DOMESTIC", hasUntaxedDomesticBase: true, hasExemptionCause: true })).toEqual([]);
    expect(issueWarnings({ ...base, invoiceType: "CREDIT_NOTE", vatTreatment: "INTRA_EU", customerTaxId: "B12345678", customerCountry: "ES" }).map((warning) => warning.code)).toEqual(["TAX_ID"]);
  });
});
