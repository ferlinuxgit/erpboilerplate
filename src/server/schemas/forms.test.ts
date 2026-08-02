import { describe, expect, it } from "vitest";

import { companyProfileSchema, createCustomerSchema, createInvoiceSchema, updateInvoiceSchema } from "@/server/schemas/forms";

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
  logoDataUrl: "",
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

  it("rejects structurally invalid Spanish CIF/NIF values when provided", () => {
    const parsed = companyProfileSchema.safeParse({ ...validProfile, vatNumber: "B1234" });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(["vatNumber"]);
  });

  it("does not block a structurally valid CIF because of a local checksum mismatch", () => {
    const customer = createCustomerSchema.safeParse({
      name: "Cliente CIF",
      taxId: "B88265391",
      address: "Calle Mayor 1",
      addressLine2: "",
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
      countryCode: "ES",
      email: "",
      phone: "",
    });

    expect(customer.success).toBe(true);
    expect(companyProfileSchema.safeParse({ ...validProfile, vatNumber: "B88265391" }).success).toBe(true);
  });

  it("rejects invalid website URLs", () => {
    const parsed = companyProfileSchema.safeParse({ ...validProfile, website: "example.com" });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(["website"]);
  });

  it("accepts PNG and JPG logo data URLs", () => {
    const pngLogo = "data:image/png;base64,iVBORw0KGgo=";
    const jpegLogo = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

    expect(companyProfileSchema.safeParse({ ...validProfile, logoDataUrl: pngLogo }).success).toBe(true);
    expect(companyProfileSchema.safeParse({ ...validProfile, logoDataUrl: jpegLogo }).success).toBe(true);
  });

  it("rejects unsupported logo formats", () => {
    const parsed = companyProfileSchema.safeParse({ ...validProfile, logoDataUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(["logoDataUrl"]);
  });
});

describe("invoice payment method references", () => {
  const invoiceValues = {
    customerId: "64708b01-b675-4777-bdd8-e601ba62363e",
    issueDate: "2026-07-31",
    dueDate: "",
    totalAmount: 954,
    notes: "",
    paymentMethodIds: ["bank-payment-8b4276e9-39c0-4066-9431-90f5a8eca7c8"],
    lines: [{
      description: "Servicios informáticos",
      quantity: 1,
      unitPrice: 900,
      taxIds: ["bf29429e-939f-4a2a-b1e2-fe928ed1f497"],
    }],
  };

  it("accepts bank-account payment methods created by the migration when creating an invoice", () => {
    expect(createInvoiceSchema.safeParse(invoiceValues).success).toBe(true);
  });

  it("accepts bank-account payment methods created by the migration when editing an invoice", () => {
    expect(updateInvoiceSchema.safeParse({ ...invoiceValues, status: "DRAFT" }).success).toBe(true);
  });
});
