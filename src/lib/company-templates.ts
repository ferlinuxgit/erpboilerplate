import { countryName } from "@/lib/countries";
import { countryVatRates } from "@/lib/country-packs/vat-rates";
import esPgc2024Accounts from "@/server/seeds/es/pgc-2024.json";

export type TemplateAccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE" | "MIXED";

export type TemplateDocumentType =
  | "SALES_QUOTE"
  | "SALES_ORDER"
  | "DELIVERY_NOTE"
  | "SALES_INVOICE"
  | "CREDIT_NOTE"
  | "PURCHASE_ORDER"
  | "GOODS_RECEIPT"
  | "SUPPLIER_INVOICE"
  | "SUPPLIER_CREDIT_NOTE"
  | "PAYMENT"
  | "RECEIPT";

export type CompanyTemplateAccount = {
  code: string;
  name: string;
  type: TemplateAccountType;
  role?: string;
  parentCode?: string | null;
  level?: number;
  isPostable?: boolean;
  isActive?: boolean;
  source?: string;
  templateVersion?: string;
};

export type CompanyTemplateJournal = {
  code: string;
  name: string;
  role: string;
};

export type CompanyTemplateTax = {
  name: string;
  rate: string;
  /** Igual que `tax.kind`: VAT (IVA), SURCHARGE (recargo de equivalencia), WITHHOLDING (IRPF) u OTHER. */
  kind?: "VAT" | "SURCHARGE" | "WITHHOLDING" | "OTHER";
  /** ADD suma a la factura (IVA, recargo); SUBTRACT resta (retenciones). */
  operation?: "ADD" | "SUBTRACT";
  /** IVA propuesto por defecto en las líneas nuevas (solo al crear el impuesto). */
  isDefault?: boolean;
};

export type CompanyTemplateSeries = {
  type: TemplateDocumentType;
  prefix: string;
  nextNumber: number;
};

export type CompanyTemplate = {
  id: "ES_GENERAL" | "GENERIC";
  countryCode: string;
  label: string;
  accounts: readonly CompanyTemplateAccount[];
  journals: readonly CompanyTemplateJournal[];
  taxes: readonly CompanyTemplateTax[];
  documentSeries: readonly CompanyTemplateSeries[];
  settings: {
    fiscalRegime: string;
    taxPeriodicity: string;
    defaultCustomerAccountCode: string;
    defaultSupplierAccountCode: string;
    defaultSalesAccountCode: string;
    defaultPurchaseAccountCode: string;
    defaultBankAccountCode: string;
    defaultVatOutputAccountCode: string;
    defaultVatInputAccountCode: string;
    defaultRetentionAccountCode: string;
  };
};

const commonSeries = [
  { type: "SALES_QUOTE", prefix: "QUO-", nextNumber: 1 },
  { type: "SALES_ORDER", prefix: "SO-", nextNumber: 1 },
  { type: "DELIVERY_NOTE", prefix: "DN-", nextNumber: 1 },
  { type: "SALES_INVOICE", prefix: "INV-", nextNumber: 1 },
  { type: "CREDIT_NOTE", prefix: "CN-", nextNumber: 1 },
  { type: "PURCHASE_ORDER", prefix: "PO-", nextNumber: 1 },
  { type: "GOODS_RECEIPT", prefix: "GR-", nextNumber: 1 },
  { type: "SUPPLIER_INVOICE", prefix: "BILL-", nextNumber: 1 },
  { type: "SUPPLIER_CREDIT_NOTE", prefix: "SCN-", nextNumber: 1 },
  { type: "PAYMENT", prefix: "PAY-", nextNumber: 1 },
  { type: "RECEIPT", prefix: "RCPT-", nextNumber: 1 },
] as const satisfies readonly CompanyTemplateSeries[];

const esPgcAccounts = (esPgc2024Accounts as readonly CompanyTemplateAccount[]).map((account) => ({
  ...account,
  isActive: ["129", "4100", "4300", "472", "4751", "477", "572", "600", "700"].includes(account.code),
  source: "ES_PGC",
  templateVersion: "PGC-2024-BOE-A-2007-19884",
}));

export const companyTemplates = [
  {
    id: "ES_GENERAL",
    countryCode: "ES",
    label: "Espana - General",
    accounts: esPgcAccounts,
    journals: [
      { code: "VEN", name: "Diario de ventas", role: "Asientos generados por facturas emitidas." },
      { code: "COM", name: "Diario de compras", role: "Asientos de compras y facturas recibidas." },
      { code: "BAN", name: "Diario de bancos", role: "Cobros, pagos y movimientos bancarios." },
      { code: "GEN", name: "Diario general", role: "Asientos manuales y operaciones generales." },
      { code: "CIE", name: "Diario de cierre", role: "Regularizacion y cierre fiscal." },
    ],
    taxes: [
      { name: "IVA general 21%", rate: "21.000", kind: "VAT", operation: "ADD", isDefault: true },
      { name: "IVA reducido 10%", rate: "10.000", kind: "VAT", operation: "ADD" },
      { name: "IVA superreducido 4%", rate: "4.000", kind: "VAT", operation: "ADD" },
      // Recargo de equivalencia (art. 161 LIVA) de cada tipo de IVA: 21 % → 5,2 %, 10 % → 1,4 %, 4 % → 0,5 %.
      { name: "Recargo de equivalencia 5,2%", rate: "5.200", kind: "SURCHARGE", operation: "ADD" },
      { name: "Recargo de equivalencia 1,4%", rate: "1.400", kind: "SURCHARGE", operation: "ADD" },
      { name: "Recargo de equivalencia 0,5%", rate: "0.500", kind: "SURCHARGE", operation: "ADD" },
      // Retenciones: restan del total. Al reaplicar se reconocen también por su nombre antiguo sin tilde para corregir las ya creadas.
      { name: "Retención IRPF 15%", rate: "15.000", kind: "WITHHOLDING", operation: "SUBTRACT" },
      { name: "Retención IRPF 7%", rate: "7.000", kind: "WITHHOLDING", operation: "SUBTRACT" },
      { name: "Retención alquiler 19%", rate: "19.000", kind: "WITHHOLDING", operation: "SUBTRACT" },
    ],
    documentSeries: commonSeries,
    settings: {
      fiscalRegime: "general",
      taxPeriodicity: "quarterly",
      defaultCustomerAccountCode: "4300",
      defaultSupplierAccountCode: "4100",
      defaultSalesAccountCode: "700",
      defaultPurchaseAccountCode: "600",
      defaultBankAccountCode: "572",
      defaultVatOutputAccountCode: "477",
      defaultVatInputAccountCode: "472",
      defaultRetentionAccountCode: "4751",
    },
  },
] as const satisfies readonly CompanyTemplate[];

/** Plantillas con plan contable, impuestos y ajustes propios de su país (cumplimiento completo). */
export function hasCountrySpecificTemplate(countryCode: string | null | undefined) {
  const code = normalizeTemplateCountry(countryCode);
  return companyTemplates.some((template) => template.countryCode === code);
}

/**
 * Plantilla de la empresa según su país. Nunca falta: los países sin plantilla propia reciben la
 * genérica (mismo esquema contable por grupos, que es el que usan los asientos automáticos, y los
 * tipos de IVA del país), así cualquier empresa puede facturar y contabilizar desde el primer día.
 */
export function getCompanyTemplate(countryCode: string | null | undefined): CompanyTemplate {
  const code = normalizeTemplateCountry(countryCode);
  return companyTemplates.find((template) => template.countryCode === code) ?? buildGenericTemplate(code);
}

function normalizeTemplateCountry(countryCode: string | null | undefined) {
  const code = (countryCode ?? "").trim().toUpperCase();
  if (code === "EL") return "GR";
  return code || "ES";
}

/** Cuentas cuyo nombre en el PGC es propio de España: en la plantilla genérica se usan nombres neutros. */
const genericAccountNames: Record<string, string> = {
  "470": "Administración tributaria, deudora por diversos conceptos",
  "4700": "Administración tributaria, deudora por impuestos indirectos",
  "4708": "Administración tributaria, deudora por subvenciones concedidas",
  "4709": "Administración tributaria, deudora por devolución de impuestos",
  "472": "Impuesto soportado (IVA/VAT)",
  "473": "Retenciones y pagos a cuenta",
  "475": "Administración tributaria, acreedora por conceptos fiscales",
  "4750": "Administración tributaria, acreedora por impuestos indirectos",
  "4751": "Administración tributaria, acreedora por retenciones practicadas",
  "4752": "Administración tributaria, acreedora por impuesto sobre beneficios",
  "4758": "Administración tributaria, acreedora por subvenciones a reintegrar",
  "477": "Impuesto repercutido (IVA/VAT)",
  "570": "Caja, moneda local",
  "572": "Bancos e instituciones de crédito c/c vista, moneda local",
  "574": "Bancos e instituciones de crédito, cuentas de ahorro, moneda local",
};

const genericAccounts: readonly CompanyTemplateAccount[] = esPgcAccounts.map((account) => ({
  ...account,
  name: genericAccountNames[account.code] ?? account.name,
  source: "GENERIC",
  templateVersion: "GENERIC-2026",
}));

function formatRate(rate: number) {
  return `${rate.toLocaleString("es-ES", { maximumFractionDigits: 3 })}%`;
}

function rateString(rate: number) {
  return rate.toFixed(3);
}

/** Impuestos de la plantilla genérica a partir de la tabla de tipos del país. */
export function genericTemplateTaxes(countryCode: string): CompanyTemplateTax[] {
  const rates = countryVatRates(countryCode);
  if (!rates || rates.system !== "VAT" || rates.standard <= 0) {
    // Sin IVA nacional conocido (EE. UU., Brasil, países sin tabla): se factura sin impuesto y el
    // usuario añade el suyo si lo necesita.
    return [{ name: "Sin impuesto 0%", rate: rateString(0), kind: "VAT", operation: "ADD", isDefault: true }];
  }
  const taxes: CompanyTemplateTax[] = [
    { name: `${rates.label} general ${formatRate(rates.standard)}`, rate: rateString(rates.standard), kind: "VAT", operation: "ADD", isDefault: true },
  ];
  for (const rate of rates.reduced ?? []) {
    taxes.push({ name: `${rates.label} reducido ${formatRate(rate)}`, rate: rateString(rate), kind: "VAT", operation: "ADD" });
  }
  if (rates.superReduced) {
    taxes.push({ name: `${rates.label} superreducido ${formatRate(rates.superReduced)}`, rate: rateString(rates.superReduced), kind: "VAT", operation: "ADD" });
  }
  return taxes;
}

export function buildGenericTemplate(countryCode: string): CompanyTemplate {
  return {
    id: "GENERIC",
    countryCode,
    label: `General (${countryName(countryCode)})`,
    accounts: genericAccounts,
    journals: [
      { code: "VEN", name: "Diario de ventas", role: "Asientos generados por facturas emitidas." },
      { code: "COM", name: "Diario de compras", role: "Asientos de compras y facturas recibidas." },
      { code: "BAN", name: "Diario de bancos", role: "Cobros, pagos y movimientos bancarios." },
      { code: "GEN", name: "Diario general", role: "Asientos manuales y operaciones generales." },
      { code: "CIE", name: "Diario de cierre", role: "Regularizacion y cierre fiscal." },
    ],
    taxes: genericTemplateTaxes(countryCode),
    documentSeries: commonSeries,
    settings: {
      fiscalRegime: "general",
      taxPeriodicity: "quarterly",
      defaultCustomerAccountCode: "4300",
      defaultSupplierAccountCode: "4100",
      defaultSalesAccountCode: "700",
      defaultPurchaseAccountCode: "600",
      defaultBankAccountCode: "572",
      defaultVatOutputAccountCode: "477",
      defaultVatInputAccountCode: "472",
      defaultRetentionAccountCode: "4751",
    },
  };
}
