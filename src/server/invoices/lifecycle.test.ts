import { describe, expect, it } from "vitest";

import {
  defaultSalesVatTreatment,
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
