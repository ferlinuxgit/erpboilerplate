import type { EInvoiceData } from "@/server/einvoice/model";

/** Facturas de ejemplo compartidas por los tests de Facturae, UBL y firma. NIF ficticios con letra de control válida. */

export const issuer: EInvoiceData["issuer"] = {
  name: "Talleres Norte",
  legalName: "Talleres Norte, S.L.",
  taxId: "B12345674",
  address: "Calle Mayor 1",
  addressLine2: "2.º B",
  postalCode: "28013",
  city: "Madrid",
  province: "Madrid",
  countryCode: "ES",
  email: "facturas@talleresnorte.example",
  phone: "910000000",
  website: "https://talleresnorte.example",
};

export const companyCustomer: EInvoiceData["customer"] = {
  name: "Suministros Levante, S.A.",
  taxId: "A58818501",
  address: "Avenida del Puerto 20",
  postalCode: "46021",
  city: "Valencia",
  province: "Valencia",
  countryCode: "ES",
};

export const townHall: EInvoiceData["customer"] = {
  name: "Ayuntamiento de Villaejemplo",
  taxId: "P2807900B",
  address: "Plaza de la Villa 1",
  postalCode: "28005",
  city: "Villaejemplo",
  province: "Madrid",
  countryCode: "ES",
};

export function baseInvoice(overrides: Partial<EInvoiceData> = {}): EInvoiceData {
  return {
    number: "F2026-000012",
    issueDate: "2026-11-20",
    dueDate: "2026-12-20",
    currency: "EUR",
    isCreditNote: false,
    issuer,
    customer: companyCustomer,
    issuerTerritory: "ES",
    lines: [
      { description: "Revisión anual de maquinaria", quantity: 2, unitPrice: 150, discountPct: 10, taxes: [{ name: "IVA 21 %", rate: 21, kind: "VAT", operation: "ADD" }] },
      { description: "Aceite <sintético> & filtros", quantity: 3, unitPrice: 19.99, discountPct: 0, taxes: [{ name: "IVA 21 %", rate: 21, kind: "VAT", operation: "ADD" }] },
      { description: "Manual técnico", quantity: 1, unitPrice: 40, discountPct: 0, taxes: [{ name: "IVA 4 %", rate: 4, kind: "VAT", operation: "ADD" }] },
    ],
    // Bases: 270,00 + 59,97 + 40,00 = 369,97. IVA 21 % sobre 329,97 = 69,29; IVA 4 % sobre 40 = 1,60.
    storedTotal: 440.86,
    vatTreatment: "DOMESTIC",
    legalLiterals: [],
    payment: { type: "BANK_TRANSFER", iban: "ES91 2100 0418 4502 0005 1332" },
    verifactuUrl: "https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?nif=B12345674&numserie=F2026-000012&fecha=20-11-2026&importe=440.86",
    ...overrides,
  };
}
