import { describe, expect, it } from "vitest";

import { getCountryPack } from "@/lib/country-packs";
import { getCountryFiscalProfile, isFullComplianceCountry, usesPgcChart } from "@/lib/country-packs/profile";
import { countryFromTaxId, describeTaxIdProblemForCountry, spanishTaxpayerTypeFromTaxId } from "@/lib/country-packs/tax-id";
import { COUNTRY_VAT_RATES, countryVatRates } from "@/lib/country-packs/vat-rates";
import { isIntraCommunity, suggestSalesVatTreatment, suggestSupplierVatTreatment } from "@/lib/country-packs/vat-treatment";
import { EU_MEMBER_CODES } from "@/lib/countries";

describe("perfil fiscal por país", () => {
  it("España tiene cumplimiento completo con modelos AEAT y VERI*FACTU", () => {
    const spain = getCountryFiscalProfile("es");
    expect(spain.level).toBe("full");
    expect(spain.features.taxReports).toBe("es-aeat");
    expect(spain.features.eInvoicing).toBe("verifactu");
    expect(spain.features.nationalTaxIdValidation).toBe("es");
    expect(spain.currency).toBe("EUR");
    expect(spain.taxLabel).toBe("IVA");
    expect(isFullComplianceCountry("ES")).toBe(true);
  });

  it("cualquier otro país funciona en nivel básico sin funciones españolas", () => {
    const france = getCountryFiscalProfile("FR");
    expect(france.level).toBe("basic");
    expect(france.features).toMatchObject({ taxReports: null, eInvoicing: null, equivalenceSurcharge: false, incomeTaxWithholding: false, vies: true });
    expect(france.taxLabel).toBe("TVA");
    expect(getCountryFiscalProfile("MX")).toMatchObject({ currency: "MXN", isEu: false, features: { vies: false } });
    // País sin datos: también funciona, con valores neutros.
    expect(getCountryFiscalProfile("KZ")).toMatchObject({ level: "basic", taxSystem: "NONE", timezone: "UTC" });
  });

  it("vacío o desconocido cae en España (valor por defecto de la empresa)", () => {
    expect(getCountryFiscalProfile(null).countryCode).toBe("ES");
    expect(getCountryFiscalProfile("EL").countryCode).toBe("GR");
  });

  it("todas las plantillas usan el plan contable por grupos", () => {
    expect(usesPgcChart("ES")).toBe(true);
    expect(usesPgcChart("US")).toBe(true);
  });

  it("el paquete completo incluye la plantilla contable del país", () => {
    expect(getCountryPack("ES").template.id).toBe("ES_GENERAL");
    expect(getCountryPack("DE").template.id).toBe("GENERIC");
    expect(getCountryPack("DE").template.taxes[0]).toMatchObject({ rate: "19.000", isDefault: true });
  });
});

describe("tabla de tipos de IVA", () => {
  it("cubre todos los estados de la UE", () => {
    for (const code of EU_MEMBER_CODES) expect(countryVatRates(code), code).not.toBeNull();
  });

  it("tiene tipos coherentes", () => {
    for (const [code, rates] of Object.entries(COUNTRY_VAT_RATES)) {
      expect(rates.standard, code).toBeGreaterThanOrEqual(0);
      expect(rates.standard, code).toBeLessThan(30);
      if (rates.system === "VAT") expect(rates.standard, code).toBeGreaterThan(0);
    }
    expect(countryVatRates("ES")).toMatchObject({ standard: 21, reduced: [10], superReduced: 4 });
  });
});

describe("tratamiento de IVA deducido", () => {
  it("ventas desde España", () => {
    expect(suggestSalesVatTreatment({ countryCode: "ES", taxId: "B12345674" })).toBe("DOMESTIC");
    expect(suggestSalesVatTreatment({ countryCode: null, taxId: null })).toBe("DOMESTIC");
    expect(suggestSalesVatTreatment({ countryCode: "FR", taxId: "FR40303265045" })).toBe("INTRA_EU");
    expect(suggestSalesVatTreatment({ countryCode: "FR", taxId: "" })).toBe("DOMESTIC");
    expect(suggestSalesVatTreatment({ countryCode: "FR", taxId: "FR40303265045" }, { businessType: "services" })).toBe("INTRA_EU_SERVICES");
    expect(suggestSalesVatTreatment({ countryCode: "MX", taxId: null })).toBe("EXPORT");
    expect(suggestSalesVatTreatment({ countryCode: "MX", taxId: "XAXX010101000" }, { businessType: "services" })).toBe("NOT_SUBJECT");
    expect(suggestSalesVatTreatment({ countryCode: "MX", taxId: null }, { businessType: "services" })).toBe("DOMESTIC");
  });

  it("ventas desde otros países", () => {
    expect(suggestSalesVatTreatment({ countryCode: "DE", taxId: "DE123456789" }, { homeCountry: "DE" })).toBe("DOMESTIC");
    expect(suggestSalesVatTreatment({ countryCode: "ES", taxId: "ESB12345674" }, { homeCountry: "DE" })).toBe("INTRA_EU");
    // Empresa fuera de la UE: no hay operaciones intracomunitarias.
    expect(suggestSalesVatTreatment({ countryCode: "ES", taxId: "ESB12345674" }, { homeCountry: "MX" })).toBe("EXPORT");
    expect(isIntraCommunity("MX", "ES")).toBe(false);
    expect(isIntraCommunity("PT", "ES")).toBe(true);
  });

  it("compras", () => {
    expect(suggestSupplierVatTreatment({ countryCode: "ES" })).toBe("DOMESTIC");
    expect(suggestSupplierVatTreatment({ countryCode: "IE" })).toBe("INTRA_EU");
    expect(suggestSupplierVatTreatment({ countryCode: "US", supplierKind: "SERVICES" })).toBe("REVERSE_CHARGE");
    expect(suggestSupplierVatTreatment({ countryCode: "CN", supplierKind: "GOODS" })).toBe("IMPORT");
    expect(suggestSupplierVatTreatment({ countryCode: "PT" }, { homeCountry: "PT" })).toBe("DOMESTIC");
    expect(suggestSupplierVatTreatment({ countryCode: "ES" }, { homeCountry: "PT" })).toBe("INTRA_EU");
  });
});

describe("identificador fiscal", () => {
  it("deduce el país del NIF-IVA o del formato español", () => {
    expect(countryFromTaxId("PT 501 964 843")).toBe("PT");
    expect(countryFromTaxId("EL094259216")).toBe("GR");
    expect(countryFromTaxId("ESB12345674")).toBe("ES");
    expect(countryFromTaxId("B12345674")).toBe("ES");
    expect(countryFromTaxId("12345678Z")).toBe("ES");
    expect(countryFromTaxId("X1234567L")).toBe("ES");
    expect(countryFromTaxId("GB123456789")).toBe("GB");
    expect(countryFromTaxId("12-3456789")).toBeNull();
    expect(countryFromTaxId("")).toBeNull();
  });

  it("deduce si un contribuyente español es autónomo o sociedad", () => {
    expect(spanishTaxpayerTypeFromTaxId("12345678Z")).toBe("individual");
    expect(spanishTaxpayerTypeFromTaxId("X1234567L")).toBe("individual");
    expect(spanishTaxpayerTypeFromTaxId("B12345674")).toBe("company");
    expect(spanishTaxpayerTypeFromTaxId("ESA58818501")).toBe("company");
    expect(spanishTaxpayerTypeFromTaxId("FR40303265045")).toBeNull();
  });

  it("valida con el algoritmo español solo en España", () => {
    expect(describeTaxIdProblemForCountry("B12345674", "ES")).toBeNull();
    expect(describeTaxIdProblemForCountry("1234", "ES")).toMatch(/CIF\/NIF/);
    expect(describeTaxIdProblemForCountry("FR40303265045", "FR")).toBeNull();
    expect(describeTaxIdProblemForCountry("XAXX010101000", "MX")).toBeNull();
    expect(describeTaxIdProblemForCountry("", "FR")).toMatch(/NIF-IVA/);
    expect(describeTaxIdProblemForCountry("ab", "US")).toMatch(/entre 4 y 20/);
  });
});
