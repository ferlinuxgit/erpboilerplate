import { describe, expect, it } from "vitest";

import {
  defaultSalesVatTreatment,
  vatTreatmentLegalNote,
  derivePaymentStatus,
  isDraftNumber,
  outstandingCents,
  provisionalDraftNumber,
} from "@/server/invoices/lifecycle";

describe("invoice lifecycle helpers", () => {
  it("genera números provisionales reconocibles que no consumen la serie", () => {
    const number = provisionalDraftNumber("1a2b3c4d-5e6f-4000-8000-000000000000");
    expect(number).toBe("BORRADOR-1A2B3C4D");
    expect(isDraftNumber(number)).toBe(true);
    expect(isDraftNumber("FA000001")).toBe(false);
  });

  it("calcula el saldo pendiente descontando rectificativas y cobros", () => {
    expect(outstandingCents({ totalCents: 37400, creditedCents: -12100, paidCents: 10000 })).toBe(15300);
    expect(outstandingCents({ totalCents: 37400, creditedCents: -37400, paidCents: 0 })).toBe(0);
  });

  it("deriva el estado de cobro", () => {
    expect(derivePaymentStatus({ totalCents: 10000, creditedCents: 0, paidCents: 0 })).toBe("PENDING");
    expect(derivePaymentStatus({ totalCents: 10000, creditedCents: 0, paidCents: 4000 })).toBe("PARTIAL");
    expect(derivePaymentStatus({ totalCents: 10000, creditedCents: -6000, paidCents: 4000 })).toBe("PAID");
    expect(derivePaymentStatus({ totalCents: 10000, creditedCents: -10000, paidCents: 0 })).toBe("VOID");
  });

  it("propone el tratamiento de IVA según el país del cliente", () => {
    expect(defaultSalesVatTreatment("ES")).toBe("DOMESTIC");
    expect(defaultSalesVatTreatment("fr")).toBe("INTRA_EU");
    expect(defaultSalesVatTreatment("US")).toBe("EXPORT");
    expect(defaultSalesVatTreatment(null)).toBe("DOMESTIC");
  });
});

describe("servicios intracomunitarios", async () => {
  const { customerDefaultVatTreatment, isSalesVatTreatment, vatTreatmentLegalNotes, verifactuSalesVatTreatment } = await import("@/server/invoices/lifecycle");

  it("distingue bienes (art. 25) y servicios B2B (inversión del sujeto pasivo)", () => {
    expect(isSalesVatTreatment("INTRA_EU_SERVICES")).toBe(true);
    expect(vatTreatmentLegalNotes.INTRA_EU).toContain("art. 25");
    expect(vatTreatmentLegalNotes.INTRA_EU_SERVICES).toContain("Inversión del sujeto pasivo");
    expect(vatTreatmentLegalNotes.INTRA_EU_SERVICES).toContain("art. 69");
    // VERI*FACTU: servicios intracomunitarios = no sujeta por reglas de localización (N2).
    expect(verifactuSalesVatTreatment("INTRA_EU_SERVICES")).toBe("NOT_SUBJECT");
    expect(verifactuSalesVatTreatment("INTRA_EU")).toBe("INTRA_EU");
  });

  it("usa el tratamiento habitual del cliente antes que el de su país", () => {
    expect(customerDefaultVatTreatment({ countryCode: "FR", defaultVatTreatment: "INTRA_EU_SERVICES" })).toBe("INTRA_EU_SERVICES");
    expect(customerDefaultVatTreatment({ countryCode: "FR", taxId: "FR40303265045", defaultVatTreatment: null })).toBe("INTRA_EU");
    expect(customerDefaultVatTreatment(null)).toBe("DOMESTIC");
  });

  it("deduce el tratamiento del país del cliente respecto al de la empresa", () => {
    // Consumidor final de otro país de la UE (sin NIF-IVA): IVA del país de la empresa.
    expect(customerDefaultVatTreatment({ countryCode: "FR", taxId: null })).toBe("DOMESTIC");
    // Empresa de servicios: los clientes UE con NIF-IVA van por inversión del sujeto pasivo.
    expect(customerDefaultVatTreatment({ countryCode: "DE", taxId: "DE123456789" }, { businessType: "services" })).toBe("INTRA_EU_SERVICES");
    // Fuera de la UE: bienes → exportación; servicios a empresa → no sujeta.
    expect(customerDefaultVatTreatment({ countryCode: "US", taxId: "12-3456789" })).toBe("EXPORT");
    expect(customerDefaultVatTreatment({ countryCode: "US", taxId: "12-3456789" }, { businessType: "services" })).toBe("NOT_SUBJECT");
    // Empresa portuguesa: un cliente portugués es nacional y uno español, intracomunitario.
    expect(customerDefaultVatTreatment({ countryCode: "PT", taxId: "PT501964843" }, { homeCountry: "PT" })).toBe("DOMESTIC");
    expect(customerDefaultVatTreatment({ countryCode: "ES", taxId: "B12345674" }, { homeCountry: "PT" })).toBe("INTRA_EU");
    expect(defaultSalesVatTreatment("PT", "PT")).toBe("DOMESTIC");
    expect(defaultSalesVatTreatment("PT")).toBe("INTRA_EU");
  });
});

describe("mención legal según el país del emisor", () => {
  it("cita la Ley del IVA en España, la Directiva en la UE y un texto neutro fuera", () => {
    expect(vatTreatmentLegalNote("INTRA_EU", "ES")).toContain("Ley 37/1992");
    expect(vatTreatmentLegalNote("INTRA_EU", "PT")).toContain("art. 138 Directiva 2006/112/CE");
    expect(vatTreatmentLegalNote("EXPORT", "MX")).toBe("Exportación exenta de impuestos.");
    expect(vatTreatmentLegalNote("DOMESTIC", "FR")).toBeNull();
    expect(vatTreatmentLegalNote("EXPORT", "ES-CN")).toContain("Ley 20/1991");
    expect(vatTreatmentLegalNote("NOT_SUBJECT", "ES-ML")).toContain("IPSI");
  });
});
