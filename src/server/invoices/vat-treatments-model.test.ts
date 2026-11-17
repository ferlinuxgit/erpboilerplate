import { describe, expect, it } from "vitest";

import { companySalesVatTreatments, defaultSalesVatTreatments, orderTreatments, visibleVatTreatmentOptions } from "@/server/invoices/vat-treatments-model";

describe("tratamientos de IVA en uso", () => {
  it("automáticos según lo que vende la empresa", () => {
    expect(defaultSalesVatTreatments({ businessType: "products" })).toEqual(["DOMESTIC", "INTRA_EU", "EXPORT"]);
    expect(defaultSalesVatTreatments({ businessType: "services" })).toEqual(["DOMESTIC", "INTRA_EU_SERVICES", "NOT_SUBJECT"]);
    expect(defaultSalesVatTreatments({ businessType: "both" })).toEqual(["DOMESTIC", "INTRA_EU", "INTRA_EU_SERVICES", "EXPORT", "NOT_SUBJECT"]);
    expect(defaultSalesVatTreatments({ businessType: "services", salesExempt: true })).toContain("EXEMPT");
  });

  it("la elección guardada manda, siempre con el nacional y en el orden del catálogo", () => {
    expect(orderTreatments(["REVERSE_CHARGE", "nada", "INTRA_EU"])).toEqual(["DOMESTIC", "INTRA_EU", "REVERSE_CHARGE"]);
    expect(companySalesVatTreatments(["EXPORT"], { businessType: "services" })).toEqual(["DOMESTIC", "EXPORT"]);
    expect(companySalesVatTreatments(null, { businessType: "products" })).toEqual(["DOMESTIC", "INTRA_EU", "EXPORT"]);
  });

  it("el diálogo de la factura muestra los que usa y el elegido aunque no esté entre ellos", () => {
    expect(visibleVatTreatmentOptions(["DOMESTIC", "EXPORT"], "DOMESTIC").map((option) => option.value)).toEqual(["DOMESTIC", "EXPORT"]);
    expect(visibleVatTreatmentOptions(["DOMESTIC"], "REVERSE_CHARGE").map((option) => option.value)).toEqual(["DOMESTIC", "REVERSE_CHARGE"]);
    expect(visibleVatTreatmentOptions(undefined, "DOMESTIC")).toHaveLength(7);
  });
});
