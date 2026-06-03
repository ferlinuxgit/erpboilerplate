import { describe, expect, it } from "vitest";

import { companyProfileSchema } from "@/server/schemas/forms";

const validProfile = {
  name: "ERP Demo",
  legalName: "ERP Demo SL",
  vatNumber: "B12345674",
  fiscalAddress: "Calle Mayor 1",
  fiscalAddressLine2: "",
  postalCode: "28013",
  city: "Madrid",
  province: "Madrid",
  countryCode: "ES",
  timezone: "Europe/Madrid",
  baseCurrencyCode: "EUR",
  email: "administracion@example.com",
  phone: "+34910000000",
  website: "https://example.com",
  invoiceFooter: "Registro mercantil de Madrid.",
};

describe("companyProfileSchema", () => {
  it("accepts a complete Spanish company profile", () => {
    expect(companyProfileSchema.safeParse(validProfile).success).toBe(true);
  });

  it("allows fiscal identity fields to be completed progressively", () => {
    const parsed = companyProfileSchema.safeParse({
      ...validProfile,
      legalName: "",
      vatNumber: "",
      fiscalAddress: "",
      postalCode: "",
      city: "",
      province: "",
      email: "",
      website: "",
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects invalid Spanish CIF/NIF values when provided", () => {
    const parsed = companyProfileSchema.safeParse({ ...validProfile, vatNumber: "B12345678" });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(["vatNumber"]);
  });

  it("rejects invalid website URLs", () => {
    const parsed = companyProfileSchema.safeParse({ ...validProfile, website: "example.com" });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(["website"]);
  });
});
