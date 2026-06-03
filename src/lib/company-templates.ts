export type TemplateAccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

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
  role: string;
};

export type CompanyTemplateJournal = {
  code: string;
  name: string;
  role: string;
};

export type CompanyTemplateTax = {
  name: string;
  rate: string;
};

export type CompanyTemplateSeries = {
  type: TemplateDocumentType;
  prefix: string;
  nextNumber: number;
};

export type CompanyTemplate = {
  id: "ES_GENERAL" | "US_GENERAL";
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

export const companyTemplates = [
  {
    id: "ES_GENERAL",
    countryCode: "ES",
    label: "Espana - General",
    accounts: [
      { code: "430000", name: "Clientes", type: "ASSET", role: "Cuenta de clientes para facturas emitidas y cobros." },
      { code: "410000", name: "Acreedores por prestaciones de servicios", type: "LIABILITY", role: "Cuenta de proveedores y acreedores para compras y pagos." },
      { code: "572000", name: "Bancos e instituciones de credito c/c vista", type: "ASSET", role: "Cuenta bancaria para cobros, pagos y conciliacion." },
      { code: "700000", name: "Ventas de mercaderias", type: "REVENUE", role: "Ingresos por ventas en facturas de cliente." },
      { code: "600000", name: "Compras de mercaderias", type: "EXPENSE", role: "Gastos por compras en facturas de proveedor." },
      { code: "472000", name: "Hacienda Publica, IVA soportado", type: "ASSET", role: "IVA deducible de compras y facturas recibidas." },
      { code: "477000", name: "Hacienda Publica, IVA repercutido", type: "LIABILITY", role: "IVA devengado en facturas emitidas." },
      { code: "475100", name: "Hacienda Publica, acreedora por retenciones practicadas", type: "LIABILITY", role: "Retenciones fiscales pendientes de liquidar." },
      { code: "129000", name: "Resultado del ejercicio", type: "EQUITY", role: "Cuenta de cierre para resultado anual." },
    ],
    journals: [
      { code: "VEN", name: "Diario de ventas", role: "Asientos generados por facturas emitidas." },
      { code: "COM", name: "Diario de compras", role: "Asientos de compras y facturas recibidas." },
      { code: "BAN", name: "Diario de bancos", role: "Cobros, pagos y movimientos bancarios." },
      { code: "GEN", name: "Diario general", role: "Asientos manuales y operaciones generales." },
      { code: "CIE", name: "Diario de cierre", role: "Regularizacion y cierre fiscal." },
    ],
    taxes: [
      { name: "IVA general 21%", rate: "21.000" },
      { name: "IVA reducido 10%", rate: "10.000" },
      { name: "IVA superreducido 4%", rate: "4.000" },
      { name: "Retencion IRPF 15%", rate: "15.000" },
      { name: "Retencion IRPF 7%", rate: "7.000" },
      { name: "Retencion alquiler 19%", rate: "19.000" },
    ],
    documentSeries: commonSeries,
    settings: {
      fiscalRegime: "general",
      taxPeriodicity: "quarterly",
      defaultCustomerAccountCode: "430000",
      defaultSupplierAccountCode: "410000",
      defaultSalesAccountCode: "700000",
      defaultPurchaseAccountCode: "600000",
      defaultBankAccountCode: "572000",
      defaultVatOutputAccountCode: "477000",
      defaultVatInputAccountCode: "472000",
      defaultRetentionAccountCode: "475100",
    },
  },
  {
    id: "US_GENERAL",
    countryCode: "US",
    label: "United States - General",
    accounts: [
      { code: "1000", name: "Cash and bank", type: "ASSET", role: "Bank and cash account for receipts, payments and reconciliation." },
      { code: "1100", name: "Accounts receivable", type: "ASSET", role: "Customer balances from issued invoices." },
      { code: "1200", name: "Inventory", type: "ASSET", role: "Stock held for resale or production." },
      { code: "1300", name: "Input tax clearing", type: "ASSET", role: "Recoverable or clearing tax on purchases when applicable." },
      { code: "2000", name: "Accounts payable", type: "LIABILITY", role: "Vendor and supplier balances." },
      { code: "2100", name: "Sales tax payable", type: "LIABILITY", role: "Sales tax collected and payable to tax authorities." },
      { code: "2200", name: "Withholding payable", type: "LIABILITY", role: "Withholdings payable when applicable." },
      { code: "3000", name: "Owner equity", type: "EQUITY", role: "Owner equity and capital balances." },
      { code: "4000", name: "Sales revenue", type: "REVENUE", role: "Revenue from customer invoices." },
      { code: "5000", name: "Cost of goods sold", type: "EXPENSE", role: "Direct cost of goods or services sold." },
      { code: "6100", name: "General expenses", type: "EXPENSE", role: "Operating expenses not assigned to a specific account." },
      { code: "9990", name: "Current year earnings", type: "EQUITY", role: "Current year profit and loss closing account." },
    ],
    journals: [
      { code: "SAL", name: "Sales journal", role: "Entries generated by customer invoices." },
      { code: "PUR", name: "Purchases journal", role: "Vendor bills and purchase operations." },
      { code: "BNK", name: "Bank journal", role: "Receipts, payments and bank movements." },
      { code: "GEN", name: "General journal", role: "Manual and general entries." },
      { code: "CLS", name: "Closing journal", role: "Year-end closing entries." },
    ],
    taxes: [{ name: "Sales tax 0%", rate: "0.000" }],
    documentSeries: commonSeries,
    settings: {
      fiscalRegime: "general",
      taxPeriodicity: "monthly",
      defaultCustomerAccountCode: "1100",
      defaultSupplierAccountCode: "2000",
      defaultSalesAccountCode: "4000",
      defaultPurchaseAccountCode: "5000",
      defaultBankAccountCode: "1000",
      defaultVatOutputAccountCode: "2100",
      defaultVatInputAccountCode: "1300",
      defaultRetentionAccountCode: "2200",
    },
  },
] as const satisfies readonly CompanyTemplate[];

export function getCompanyTemplate(countryCode: string): CompanyTemplate | null {
  return companyTemplates.find((template) => template.countryCode === countryCode.toUpperCase()) ?? null;
}
