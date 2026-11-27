import { describe, expect, it } from "vitest";

import { documentClassTitle, effectiveDocumentClass, resolveDocumentClass, simplifiedAllowedForTreatment } from "@/server/invoices/document-class";

const base = { vatTreatment: "DOMESTIC", totalAmount: 100, limit: 400 };

describe("clase de documento", () => {
  it("sin elección se deduce como siempre: con NIF completa, sin NIF simplificada", () => {
    expect(resolveDocumentClass({ ...base, customerTaxId: "B12345674" })).toEqual({ documentClass: "FULL", problem: null });
    expect(resolveDocumentClass({ ...base, customerTaxId: " " })).toEqual({ documentClass: "SIMPLIFIED", problem: null });
  });

  it("un ticket del TPV con NIF es una simplificada cualificada", () => {
    expect(resolveDocumentClass({ ...base, customerTaxId: "B12345674", ticket: true }).documentClass).toBe("SIMPLIFIED_QUALIFIED");
  });

  it("un ticket con NIF por encima del límite o intracomunitario sale como factura completa, sin fallar", () => {
    expect(resolveDocumentClass({ ...base, customerTaxId: "B12345674", ticket: true, totalAmount: 400.01 }).documentClass).toBe("FULL");
    expect(resolveDocumentClass({ ...base, customerTaxId: "FR12345678901", ticket: true, vatTreatment: "INTRA_EU" }).documentClass).toBe("FULL");
    expect(resolveDocumentClass({ ...base, customerTaxId: "B12345674", ticket: true, totalAmount: -300 }).documentClass).toBe("SIMPLIFIED_QUALIFIED");
  });

  it("la completa y la cualificada elegidas a mano exigen NIF", () => {
    expect(resolveDocumentClass({ ...base, requested: "FULL", customerTaxId: null }).problem).toMatch(/NIF del cliente/);
    expect(resolveDocumentClass({ ...base, requested: "SIMPLIFIED_QUALIFIED", customerTaxId: null }).problem).toMatch(/art\. 7\.2/);
    expect(resolveDocumentClass({ ...base, requested: "SIMPLIFIED_QUALIFIED", customerTaxId: "B12345674" }).documentClass).toBe("SIMPLIFIED_QUALIFIED");
    expect(resolveDocumentClass({ ...base, requested: "SIMPLIFIED", customerTaxId: "B12345674" }).documentClass).toBe("SIMPLIFIED");
  });

  it("no cabe simplificada en intracomunitarias ni con inversión del sujeto pasivo", () => {
    for (const vatTreatment of ["INTRA_EU", "INTRA_EU_SERVICES", "REVERSE_CHARGE"]) {
      expect(simplifiedAllowedForTreatment(vatTreatment)).toBe(false);
      expect(resolveDocumentClass({ ...base, vatTreatment, requested: "SIMPLIFIED", customerTaxId: "B12345674" }).problem).toMatch(/art\. 4\.4/);
      expect(resolveDocumentClass({ ...base, vatTreatment, requested: "SIMPLIFIED_QUALIFIED", customerTaxId: "B12345674" }).problem).toMatch(/art\. 4\.4/);
    }
    expect(simplifiedAllowedForTreatment(null)).toBe(true);
    expect(simplifiedAllowedForTreatment("EXEMPT")).toBe(true);
  });

  it("una clase desconocida se trata como automática", () => {
    expect(resolveDocumentClass({ ...base, requested: "OTRA", customerTaxId: null }).documentClass).toBe("SIMPLIFIED");
  });

  it("facturas antiguas sin clase guardada: se deduce del NIF congelado", () => {
    expect(effectiveDocumentClass({ documentClass: null, customerTaxId: "B12345674" })).toBe("FULL");
    expect(effectiveDocumentClass({ documentClass: null, customerTaxId: null })).toBe("SIMPLIFIED");
    expect(effectiveDocumentClass({ documentClass: "SIMPLIFIED_QUALIFIED", customerTaxId: "B12345674" })).toBe("SIMPLIFIED_QUALIFIED");
  });

  it("título impreso", () => {
    expect(documentClassTitle("FULL")).toBe("Factura");
    expect(documentClassTitle("SIMPLIFIED_QUALIFIED")).toBe("Factura simplificada");
  });
});
