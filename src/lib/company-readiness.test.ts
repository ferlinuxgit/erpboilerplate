import { describe, expect, it } from "vitest";

import { companyInvoiceReadiness, isValidIban, isValidSeriesPrefix, normalizeIban, parseBusinessType } from "@/lib/company-readiness";
import { onboardingFieldsSchema, onboardingStepPayloadSchema } from "@/lib/onboarding";

describe("company invoice readiness", () => {
  it("lists the missing issuer data in Spanish", () => {
    expect(companyInvoiceReadiness({ legalName: "Talleres Pérez S.L.", vatNumber: " " })).toEqual({
      ready: false,
      missing: ["CIF/NIF", "Dirección fiscal", "Código postal", "Ciudad", "Provincia"],
    });
  });

  it("is ready when every required field is filled", () => {
    expect(companyInvoiceReadiness({ legalName: "A", vatNumber: "B12345674", fiscalAddress: "Calle 1", postalCode: "28013", city: "Madrid", province: "Madrid" }).ready).toBe(true);
  });
});

describe("business type", () => {
  it("defaults to both for unknown values", () => {
    expect(parseBusinessType("services")).toBe("services");
    expect(parseBusinessType("retail")).toBe("both");
    expect(parseBusinessType(null)).toBe("both");
  });
});

describe("IBAN and series prefix validation", () => {
  it("accepts valid IBANs with spaces and rejects bad check digits or lengths", () => {
    expect(isValidIban("ES91 2100 0418 4502 0005 1332")).toBe(true);
    expect(normalizeIban("es91 2100-0418 4502 0005 1332")).toBe("ES9121000418450200051332");
    expect(isValidIban("ES92 2100 0418 4502 0005 1332")).toBe(false);
    expect(isValidIban("ES91 2100 0418 4502 0005 133")).toBe(false);
    expect(isValidIban("DE89 3704 0044 0532 0130 00")).toBe(true);
  });

  it("accepts short alphanumeric series prefixes", () => {
    expect(isValidSeriesPrefix("FA")).toBe(true);
    expect(isValidSeriesPrefix("F-")).toBe(true);
    expect(isValidSeriesPrefix("")).toBe(false);
    expect(isValidSeriesPrefix("FACTURAS2026X")).toBe(false);
    expect(isValidSeriesPrefix("F A")).toBe(false);
  });
});

describe("setup wizard validation", () => {
  it("enforces required fiscal data with actionable messages", () => {
    const result = onboardingFieldsSchema.pick({ legalName: true, vatNumber: true, postalCode: true }).safeParse({ legalName: "", vatNumber: "B1234567", postalCode: "280" });
    expect(result.success).toBe(false);
    const messages = result.success ? [] : result.error.issues.map((issue) => issue.message);
    expect(messages.some((message) => message.includes("razón social"))).toBe(true);
    expect(messages.some((message) => message.includes("CIF completo sería"))).toBe(true);
    expect(messages.some((message) => message.includes("5 cifras"))).toBe(true);
  });

  it("accepts partial step payloads so a half-filled wizard is never lost", () => {
    expect(onboardingStepPayloadSchema.safeParse({ legalName: "Mi taller" }).success).toBe(true);
    expect(onboardingStepPayloadSchema.safeParse({ iban: "" }).success).toBe(true);
    expect(onboardingStepPayloadSchema.safeParse({ iban: "ES00 1234" }).success).toBe(false);
  });
});
