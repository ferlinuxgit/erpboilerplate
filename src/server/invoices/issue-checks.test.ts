import { describe, expect, it } from "vitest";

import type { InvoicePartySnapshot } from "@/db/schema";
import {
  cashPaymentProblem,
  chronologicalOrderProblem,
  civilDateKey,
  equivalenceSurchargeProblem,
  isEntityTaxId,
  issuerDataProblem,
  recipientDataProblem,
  simplifiedLimitProblem,
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
