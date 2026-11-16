import { describe, expect, it } from "vitest";

import { getCountryPack } from "@/lib/country-packs";
import { getCountryFiscalProfile, isFullComplianceCountry, usesPgcChart } from "@/lib/country-packs/profile";
import { countryFromTaxId, describeTaxIdProblemForCountry, spanishTaxpayerTypeFromTaxId } from "@/lib/country-packs/tax-id";
import { igicExemptRegime } from "@/lib/country-packs/igic";
import { taxTerritoryOf } from "@/lib/country-packs/territory";
import { allVatRates, COUNTRY_VAT_RATES, countryVatRates, standardVatRate } from "@/lib/country-packs/vat-rates";
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
      if (rates.system === "VAT") expect(rates.standard > 0 || (rates.allRates?.length ?? 0) > 0, code).toBe(true);
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

describe("Canarias, Ceuta y Melilla", () => {
  it("deduce el territorio del código postal o la provincia", () => {
    expect(taxTerritoryOf({ countryCode: "ES", postalCode: "38001" })).toBe("ES-CN");
    expect(taxTerritoryOf({ countryCode: "ES", postalCode: "35002" })).toBe("ES-CN");
    expect(taxTerritoryOf({ countryCode: "ES", postalCode: "51001" })).toBe("ES-CE");
    expect(taxTerritoryOf({ countryCode: "ES", postalCode: "52001" })).toBe("ES-ML");
    expect(taxTerritoryOf({ countryCode: "ES", province: "Santa Cruz de Tenerife" })).toBe("ES-CN");
    expect(taxTerritoryOf({ countryCode: "ES", province: "Las Palmas" })).toBe("ES-CN");
    // Baleares y la península: IVA.
    expect(taxTerritoryOf({ countryCode: "ES", postalCode: "07001", province: "Illes Balears" })).toBe("ES");
    expect(taxTerritoryOf({ countryCode: "ES", postalCode: "28013" })).toBe("ES");
    expect(taxTerritoryOf({ countryCode: "FR", postalCode: "35000" })).toBe("FR");
    expect(taxTerritoryOf({ countryCode: "ES-CN" })).toBe("ES-CN");
    expect(taxTerritoryOf({ countryCode: "" })).toBeNull();
  });

  it("perfil: España con su impuesto, sin modelos de IVA, recargo ni VIES", () => {
    const canarias = getCountryFiscalProfile("ES-CN");
    expect(canarias).toMatchObject({ countryCode: "ES", territory: "ES-CN", territoryName: "Canarias", taxLabel: "IGIC", isEu: false, level: "full", timezone: "Atlantic/Canary" });
    expect(canarias.features).toMatchObject({ taxReports: "es-aeat", vatReturns: false, eInvoicing: "verifactu", equivalenceSurcharge: false, incomeTaxWithholding: true, vies: false });
    expect(getCountryFiscalProfile("ES-ML")).toMatchObject({ taxLabel: "IPSI", territoryName: "Melilla" });
    expect(getCountryFiscalProfile("ES").features.vatReturns).toBe(true);
  });

  it("plantillas con IGIC / IPSI y las retenciones de IRPF, sin recargo", () => {
    const canarias = getCountryPack("ES-CN").template;
    expect(canarias.accounts.length).toBe(getCountryPack("ES").template.accounts.length);
    expect(canarias.taxes.map((entry) => [entry.name, entry.isDefault ?? false])).toEqual([
      ["IGIC especial incrementado 15%", false],
      ["IGIC incrementado 9,5%", false],
      ["IGIC general 7%", true],
      ["IGIC reducido 3%", false],
      ["IGIC tipo cero 0%", false],
      ["Retención IRPF 15%", false],
      ["Retención IRPF 7%", false],
      ["Retención alquiler 19%", false],
    ]);
    const ceuta = getCountryPack("ES-CE").template;
    const ipsi = ceuta.taxes.filter((entry) => entry.kind === "VAT");
    expect(ipsi.every((entry) => entry.name.startsWith("IPSI"))).toBe(true);
    // Ordenanza de Ceuta: 4 % general de servicios, propuesto por defecto.
    expect(ipsi.filter((entry) => entry.isDefault).map((entry) => entry.name)).toEqual(["IPSI general 4%"]);
    expect(ipsi.map((entry) => Number(entry.rate))).toEqual([10, 9, 6, 4, 2, 1, 0.5]);
    expect(allVatRates("ES-ML")).toEqual([10, 8, 4, 2, 1, 0.5]);
    expect(ceuta.taxes.some((entry) => entry.kind === "SURCHARGE")).toBe(false);
  });

  it("entre península y Canarias / Ceuta / Melilla: exportación, no sujeta o importación", () => {
    // Desde la península a Canarias.
    expect(suggestSalesVatTreatment({ countryCode: "ES", postalCode: "38001", taxId: "B12345674" })).toBe("EXPORT");
    expect(suggestSalesVatTreatment({ countryCode: "ES", postalCode: "38001", taxId: "B12345674" }, { businessType: "services" })).toBe("NOT_SUBJECT");
    expect(suggestSalesVatTreatment({ countryCode: "ES", postalCode: "38001", taxId: null }, { businessType: "services" })).toBe("DOMESTIC");
    // Desde Canarias: la península y la UE son exportación (Canarias no está en el espacio IVA).
    expect(suggestSalesVatTreatment({ countryCode: "ES", postalCode: "38200", taxId: "B12345674" }, { homeCountry: "ES-CN" })).toBe("DOMESTIC");
    expect(suggestSalesVatTreatment({ countryCode: "ES", postalCode: "28013", taxId: "B12345674" }, { homeCountry: "ES-CN" })).toBe("EXPORT");
    expect(suggestSalesVatTreatment({ countryCode: "FR", taxId: "FR40303265045" }, { homeCountry: "ES-CN" })).toBe("EXPORT");
    // Compras.
    expect(suggestSupplierVatTreatment({ countryCode: "ES", postalCode: "51001", supplierKind: "GOODS" })).toBe("IMPORT");
    expect(suggestSupplierVatTreatment({ countryCode: "ES", postalCode: "35001", supplierKind: "SERVICES" })).toBe("REVERSE_CHARGE");
    expect(suggestSupplierVatTreatment({ countryCode: "ES", postalCode: "28013", supplierKind: "GOODS" }, { homeCountry: "ES-CN" })).toBe("IMPORT");
    expect(suggestSupplierVatTreatment({ countryCode: "DE", supplierKind: "GOODS" }, { homeCountry: "ES-ML" })).toBe("IMPORT");
  });

  it("autorepercusión con el tipo general del territorio", () => {
    expect(standardVatRate("ES-CN")).toBe(7);
    expect(standardVatRate("ES-CE")).toBe(4);
    expect(allVatRates("ES-CN")).toEqual([15, 9.5, 7, 3, 0]);
  });
});

describe("regímenes del IGIC", () => {
  it("comerciante minorista y REPEP venden exento en Canarias; fuera de Canarias no aplica", () => {
    expect(igicExemptRegime("ES-CN", "comerciante_minorista")).toBe(true);
    expect(igicExemptRegime("ES-CN", "pequeno_empresario")).toBe(true);
    expect(igicExemptRegime("ES-CN", "general")).toBe(false);
    expect(igicExemptRegime("ES", "pequeno_empresario")).toBe(false);
    const context = { homeCountry: "ES-CN", salesExempt: true };
    expect(suggestSalesVatTreatment({ countryCode: "ES", postalCode: "38001", taxId: "B12345674" }, context)).toBe("EXEMPT");
    // Exportar desde Canarias sigue siendo exportación.
    expect(suggestSalesVatTreatment({ countryCode: "ES", postalCode: "28013", taxId: "B12345674" }, context)).toBe("EXPORT");
  });
});
