import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";

// ACCOUNTANT = gestor/asesor externo; VIEWER = solo lectura (ver `src/lib/rbac.ts`).
export const membershipRoleEnum = pgEnum("membership_role", ["OWNER", "ADMIN", "MEMBER", "ACCOUNTANT", "VIEWER"]);
export const customerStatusEnum = pgEnum("customer_status", ["ACTIVE", "INACTIVE"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["DRAFT", "SENT", "PAID", "OVERDUE", "VOID"]);
export const partnerTypeEnum = pgEnum("partner_type", ["CUSTOMER", "SUPPLIER", "BOTH"]);
export const documentTypeEnum = pgEnum("document_type", [
  "SALES_QUOTE",
  "SALES_ORDER",
  "DELIVERY_NOTE",
  "SALES_INVOICE",
  "CREDIT_NOTE",
  "PURCHASE_ORDER",
  "GOODS_RECEIPT",
  "SUPPLIER_INVOICE",
  "SUPPLIER_CREDIT_NOTE",
  "PAYMENT",
  "RECEIPT",
]);
export const paymentStatusEnum = pgEnum("payment_status", ["PENDING", "PARTIAL", "PAID", "OVERDUE", "VOID"]);
export const stockMovementTypeEnum = pgEnum("stock_movement_type", ["IN", "OUT", "ADJUSTMENT", "TRANSFER"]);
export const reconciliationStatusEnum = pgEnum("reconciliation_status", ["PENDING", "RECONCILED"]);
export const accountTypeEnum = pgEnum("account_type", ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE", "MIXED"]);
export const fiscalReportStatusEnum = pgEnum("fiscal_report_status", ["DRAFT", "READY", "FILED"]);
export const paymentMethodTypeEnum = pgEnum("payment_method_type", ["BANK_TRANSFER", "CARD", "CASH", "DIRECT_DEBIT"]);
// REJECTED: presupuesto rechazado por el cliente (solo presupuestos).
export const salesDocumentStatusEnum = pgEnum("sales_document_status", ["DRAFT", "SENT", "CONFIRMED", "DELIVERED", "INVOICED", "PAID", "VOID", "REJECTED"]);

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt", { withTimezone: true, mode: "date" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: timestamp("accessTokenExpiresAt", { withTimezone: true, mode: "date" }),
    refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", { withTimezone: true, mode: "date" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [unique("account_provider_id_account_id_unique").on(table.providerId, table.accountId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expiresAt", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [unique("verification_identifier_value_unique").on(table.identifier, table.value)],
);

export const tenant = pgTable("tenant", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ownerId: text("ownerId").notNull().references(() => user.id, { onDelete: "cascade" }),
  plan: text("plan").notNull().default("free"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const membership = pgTable(
  "membership",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
    tenantId: text("tenantId").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    role: membershipRoleEnum("role").notNull().default("MEMBER"),
    createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [unique("membership_user_tenant_unique").on(table.userId, table.tenantId), index("membership_tenant_idx").on(table.tenantId)],
);

export const company = pgTable("company", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenantId").notNull().references(() => tenant.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  legalName: text("legalName"),
  vatNumber: text("vatNumber"),
  fiscalAddress: text("fiscalAddress"),
  fiscalAddressLine2: text("fiscalAddressLine2"),
  postalCode: text("postalCode"),
  city: text("city"),
  province: text("province"),
  email: text("email"),
  phone: text("phone"),
  website: text("website"),
  logoDataUrl: text("logoDataUrl"),
  invoiceFooter: text("invoiceFooter"),
  // Identificador de acreedor SEPA (AT-02) para remesas de adeudos directos: ES + control + sufijo + NIF.
  sepaCreditorId: text("sepaCreditorId"),
  countryCode: text("countryCode").notNull().default("ES"),
  timezone: text("timezone").notNull().default("Europe/Madrid"),
  baseCurrencyCode: text("baseCurrencyCode").notNull().default("EUR"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const fiscalYear = pgTable(
  "fiscal_year",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    startsAt: timestamp("startsAt", { withTimezone: true, mode: "date" }).notNull(),
    endsAt: timestamp("endsAt", { withTimezone: true, mode: "date" }).notNull(),
    isClosed: boolean("isClosed").notNull().default(false),
    closedAt: timestamp("closedAt", { withTimezone: true, mode: "date" }),
  },
  (table) => [unique("fiscal_year_company_code_unique").on(table.companyId, table.code), index("fiscal_year_company_dates_idx").on(table.companyId, table.startsAt, table.endsAt)],
);

export const country = pgTable("country", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
});

export const currency = pgTable("currency", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
  decimals: integer("decimals").notNull().default(2),
});

export const exchangeRate = pgTable(
  "exchange_rate",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
    fromCurrencyCode: text("fromCurrencyCode").notNull(),
    toCurrencyCode: text("toCurrencyCode").notNull(),
    rate: numeric("rate", { precision: 18, scale: 8 }).notNull(),
    rateDate: timestamp("rateDate", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [index("exchange_rate_company_date_idx").on(table.companyId, table.rateDate)],
);

export const permission = pgTable("permission", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  key: text("key").notNull().unique(),
  description: text("description").notNull(),
});

export const rolePermission = pgTable(
  "role_permission",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    role: membershipRoleEnum("role").notNull(),
    permissionKey: text("permissionKey").notNull(),
  },
  (table) => [unique("role_permission_unique").on(table.role, table.permissionKey)],
);

export const auditLog = pgTable("audit_log", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenantId").notNull(),
  companyId: text("companyId"),
  actorUserId: text("actorUserId"),
  action: text("action").notNull(),
  entityName: text("entityName").notNull(),
  entityId: text("entityId").notNull(),
  payload: text("payload"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  index("audit_log_tenant_created_idx").on(table.tenantId, table.createdAt.desc()),
  index("audit_log_entity_idx").on(table.entityName, table.entityId),
]);

export const documentSeries = pgTable(
  "document_series",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
    fiscalYearId: text("fiscalYearId").notNull().references(() => fiscalYear.id, { onDelete: "cascade" }),
    type: documentTypeEnum("type").notNull(),
    // Código corto de la serie ("GEN", "T", "EXP"…): identifica la misma serie en todos los ejercicios
    // (la numeración es correlativa por tipo + código) y es único por empresa, ejercicio y tipo.
    code: text("code").notNull().default("GEN"),
    // Nombre visible ("General", "Tickets", "Exportación"…).
    name: text("name").notNull().default("General"),
    prefix: text("prefix").notNull(),
    format: text("format").notNull().default("{PREFIX}{NUMBER:6}"),
    nextNumber: integer("nextNumber").notNull().default(1),
    // Serie que se usa si el documento no elige otra. Como mucho una por empresa, ejercicio y tipo.
    // Por defecto true: las altas automáticas (plantillas, onboarding, rectificativas) crean la serie general.
    isDefault: boolean("isDefault").notNull().default(true),
    // Una serie desactivada no se puede elegir ni reservar, pero conserva su numeración.
    isActive: boolean("isActive").notNull().default(true),
  },
  (table) => [
    unique("document_series_company_year_type_code_unique").on(table.companyId, table.fiscalYearId, table.type, table.code),
    uniqueIndex("document_series_one_default_idx")
      .on(table.companyId, table.fiscalYearId, table.type)
      .where(sql`${table.isDefault}`),
    check("document_series_default_active", sql`NOT ${table.isDefault} OR ${table.isActive}`),
  ],
);

export const documentAttachment = pgTable("document_attachment", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  documentType: documentTypeEnum("documentType").notNull(),
  documentId: text("documentId").notNull(),
  fileUrl: text("fileUrl").notNull(),
  fileName: text("fileName").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const itemCategory = pgTable("item_category", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [unique("item_category_company_code_unique").on(table.companyId, table.code)]);

export const unitOfMeasure = pgTable("unit_of_measure", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [unique("unit_of_measure_company_code_unique").on(table.companyId, table.code)]);

export const bankAccount = pgTable("bank_account", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  iban: text("iban").notNull(),
  bankName: text("bankName").notNull(),
  // Subcuenta contable (grupo 57) donde se registran los cobros, pagos y movimientos de esta cuenta.
  // Si es null se usa la cuenta de bancos por defecto de la empresa (572).
  accountId: text("accountId").references((): AnyPgColumn => accountChart.id, { onDelete: "set null" }),
  isActive: boolean("isActive").notNull().default(true),
  archivedAt: timestamp("archivedAt", { withTimezone: true, mode: "date" }),
  // BIC/SWIFT de la entidad (ordenante de las remesas SEPA). Opcional: SEPA permite omitirlo.
  bic: text("bic"),
  // Mapeo de columnas del último extracto CSV/Excel importado en esta cuenta (se propone la próxima vez).
  importMapping: jsonb("importMapping").$type<BankImportMappingSnapshot>(),
}, (table) => [unique("bank_account_company_iban_unique").on(table.companyId, table.iban)]);

/** Columnas (índice base 0) y formatos de un extracto CSV/Excel de un banco concreto. */
export type BankImportMappingSnapshot = {
  headerRow: number;
  dateColumn: number;
  valueDateColumn?: number | null;
  /** Importe con signo en una sola columna… */
  amountColumn?: number | null;
  /** …o cargos y abonos en columnas separadas. */
  debitColumn?: number | null;
  creditColumn?: number | null;
  descriptionColumns: number[];
  balanceColumn?: number | null;
  referenceColumn?: number | null;
  dateFormat: "DMY" | "MDY" | "YMD";
  decimalSeparator: "," | ".";
  /** Algunos bancos exportan los cargos en positivo: invierte el signo del importe. */
  invertSign?: boolean;
  headers?: string[];
};

export const paymentMethod = pgTable("payment_method", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  bankAccountId: text("bankAccountId").references(() => bankAccount.id, { onDelete: "set null" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  type: paymentMethodTypeEnum("type").notNull().default("BANK_TRANSFER"),
  bankAccountNumber: text("bankAccountNumber"),
  isDefault: boolean("isDefault").notNull().default(false),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  unique("payment_method_company_code_unique").on(table.companyId, table.code),
  uniqueIndex("payment_method_company_default_unique").on(table.companyId).where(sql`${table.isDefault} = true`),
  index("payment_method_bank_account_idx").on(table.bankAccountId),
]);

export const taxRetention = pgTable("tax_retention", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  rate: numeric("rate", { precision: 6, scale: 3 }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const companySettings = pgTable("company_settings", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }).unique(),
  logoUrl: text("logoUrl"),
  paymentTermsDays: integer("paymentTermsDays").notNull().default(30),
  fiscalRegime: text("fiscalRegime").notNull().default("general"),
  taxPeriodicity: text("taxPeriodicity").notNull().default("quarterly"),
  siiEnabled: boolean("siiEnabled").notNull().default(false),
  verifactuMode: text("verifactuMode").notNull().default("pending"),
  // Fecha desde la que se generan registros VeriFactu (facturas con fecha de expedición >= esta). null = desde la activación.
  verifactuSince: timestamp("verifactuSince", { withTimezone: true, mode: "date" }),
  // Tipo de contribuyente: "company" (sociedad, IS) o "individual" (autónomo en IRPF: modelo 130).
  taxpayerType: text("taxpayerType").notNull().default("company"),
  prorrataPct: numeric("prorrataPct", { precision: 6, scale: 3 }).notNull().default("100"),
  defaultCustomerAccountCode: text("defaultCustomerAccountCode").notNull().default("4300"),
  defaultSupplierAccountCode: text("defaultSupplierAccountCode").notNull().default("4100"),
  defaultSalesAccountCode: text("defaultSalesAccountCode").notNull().default("700"),
  defaultPurchaseAccountCode: text("defaultPurchaseAccountCode").notNull().default("600"),
  defaultBankAccountCode: text("defaultBankAccountCode").notNull().default("572"),
  pdfShowLogo: boolean("pdfShowLogo").notNull().default(true),
  pdfShowEmail: boolean("pdfShowEmail").notNull().default(true),
  pdfShowPhone: boolean("pdfShowPhone").notNull().default(true),
  pdfShowWebsite: boolean("pdfShowWebsite").notNull().default(true),
  pdfShowCustomerNumber: boolean("pdfShowCustomerNumber").notNull().default(true),
  pdfShowPaymentMethod: boolean("pdfShowPaymentMethod").notNull().default(true),
  pdfShowTaxBreakdown: boolean("pdfShowTaxBreakdown").notNull().default(true),
  // Qué vende la empresa: "products", "services" o "both". Adapta navegación y avisos del panel.
  businessType: text("businessType").notNull().default("both"),
  // Puesta en marcha: completada con el asistente o pospuesta por el usuario (no se vuelve a redirigir).
  onboardingCompletedAt: timestamp("onboardingCompletedAt", { withTimezone: true, mode: "date" }),
  onboardingDismissedAt: timestamp("onboardingDismissedAt", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const partner = pgTable("partner", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  type: partnerTypeEnum("type").notNull().default("CUSTOMER"),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  taxId: text("taxId"),
  taxIdNormalized: text("taxIdNormalized"),
  address: text("address"),
  addressLine2: text("addressLine2"),
  city: text("city"),
  province: text("province"),
  postalCode: text("postalCode"),
  countryCode: text("countryCode").notNull().default("ES"),
  paymentTermsDays: integer("paymentTermsDays"),
  paymentMethodId: text("paymentMethodId").references(() => paymentMethod.id, { onDelete: "set null" }),
  defaultAccountId: text("defaultAccountId").references(() => accountChart.id, { onDelete: "set null" }),
  // Valores por defecto de las facturas recibidas de este proveedor (OCR y alta manual).
  // Cuenta de gasto habitual (grupo 6/2). null = el usuario la elige en cada factura.
  defaultExpenseAccountId: text("defaultExpenseAccountId").references((): AnyPgColumn => accountChart.id, { onDelete: "set null" }),
  // Retención IRPF habitual (%), p. ej. 15 para un profesional o 19 para un alquiler. null = sin retención.
  defaultRetentionRate: numeric("defaultRetentionRate", { precision: 6, scale: 3 }),
  // Porcentaje de IVA deducible habitual (p. ej. 50 para un vehículo de uso mixto). null = 100 %.
  defaultTaxDeductiblePct: numeric("defaultTaxDeductiblePct", { precision: 6, scale: 3 }),
  // Tratamiento de IVA habitual de sus facturas. null = automático según el país.
  defaultVatTreatment: text("defaultVatTreatment"),
  currencyCode: text("currencyCode").notNull().default("EUR"),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  check("partner_default_vat_treatment_valid", sql`${table.defaultVatTreatment} IS NULL OR ${table.defaultVatTreatment} IN ('DOMESTIC', 'INTRA_EU', 'REVERSE_CHARGE', 'IMPORT', 'NOT_SUBJECT')`),
  unique("partner_company_number_unique").on(table.companyId, table.number),
  index("partner_company_name_idx").on(table.companyId, table.name),
  index("partner_company_tax_id_idx").on(table.companyId, table.taxId),
  uniqueIndex("partner_company_country_tax_normalized_unique")
    .on(table.companyId, table.countryCode, table.taxIdNormalized)
    .where(sql`${table.taxIdNormalized} IS NOT NULL`),
]);

export const partnerNumberSequence = pgTable("partner_number_sequence", {
  companyId: text("companyId").primaryKey().references(() => company.id, { onDelete: "cascade" }),
  nextNumber: integer("nextNumber").notNull().default(1),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const journalEntryNumberSequence = pgTable("journal_entry_number_sequence", {
  companyId: text("companyId").primaryKey().references(() => company.id, { onDelete: "cascade" }),
  nextNumber: integer("nextNumber").notNull().default(1),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const customer = pgTable("customer", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  partnerId: text("partnerId").references(() => partner.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  status: customerStatusEnum("status").notNull().default("ACTIVE"),
  // Condiciones de facturación por defecto (los días de pago viven en partner.paymentTermsDays).
  // Retención IRPF habitual (%) que se propone en las líneas nuevas. null = sin retención.
  defaultRetentionRate: numeric("defaultRetentionRate", { precision: 6, scale: 3 }),
  // Tratamiento de IVA habitual. null = automático según el país.
  defaultVatTreatment: text("defaultVatTreatment"),
  // Correo donde el cliente recibe las facturas (si es distinto del de contacto).
  invoiceEmail: text("invoiceEmail"),
  // IBAN del cliente (domiciliaciones). Opcional.
  iban: text("iban"),
  // Cliente en recargo de equivalencia (comerciante minorista).
  equivalenceSurcharge: boolean("equivalenceSurcharge").notNull().default(false),
  // Última comprobación del NIF-IVA en VIES (UE): VALID | INVALID | UNAVAILABLE.
  viesStatus: text("viesStatus"),
  viesName: text("viesName"),
  viesCheckedAt: timestamp("viesCheckedAt", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  index("customer_company_status_idx").on(table.companyId, table.status),
  index("customer_partner_idx").on(table.partnerId),
  check("customer_default_vat_treatment_valid", sql`${table.defaultVatTreatment} IS NULL OR ${table.defaultVatTreatment} IN ('DOMESTIC', 'INTRA_EU', 'INTRA_EU_SERVICES', 'EXPORT', 'EXEMPT', 'REVERSE_CHARGE', 'NOT_SUBJECT')`),
  check("customer_vies_status_valid", sql`${table.viesStatus} IS NULL OR ${table.viesStatus} IN ('VALID', 'INVALID', 'UNAVAILABLE')`),
]);

export const item = pgTable("item", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  categoryId: text("categoryId").references(() => itemCategory.id, { onDelete: "set null" }),
  unitOfMeasureId: text("unitOfMeasureId").references(() => unitOfMeasure.id, { onDelete: "set null" }),
  defaultTaxId: text("defaultTaxId").references(() => tax.id, { onDelete: "set null" }),
  defaultRetentionId: text("defaultRetentionId").references(() => taxRetention.id, { onDelete: "set null" }),
  salesAccountId: text("salesAccountId").references(() => accountChart.id, { onDelete: "set null" }),
  purchaseAccountId: text("purchaseAccountId").references(() => accountChart.id, { onDelete: "set null" }),
  isService: boolean("isService").notNull().default(false),
  salePrice: numeric("salePrice", { precision: 12, scale: 2 }).notNull().default("0"),
  costPrice: numeric("costPrice", { precision: 12, scale: 2 }).notNull().default("0"),
  averageCost: numeric("averageCost", { precision: 12, scale: 2 }).notNull().default("0"),
  minimumStock: numeric("minimumStock", { precision: 12, scale: 3 }).notNull().default("0"),
  isActive: boolean("isActive").notNull().default(true),
}, (table) => [unique("item_company_sku_unique").on(table.companyId, table.sku)]);

export const warehouse = pgTable("warehouse", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  isActive: boolean("isActive").notNull().default(true),
}, (table) => [unique("warehouse_company_code_unique").on(table.companyId, table.code)]);

export const stockMovement = pgTable("stock_movement", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  itemId: text("itemId").notNull().references(() => item.id, { onDelete: "restrict" }),
  warehouseId: text("warehouseId").notNull().references(() => warehouse.id, { onDelete: "restrict" }),
  movementType: stockMovementTypeEnum("movementType").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
  movedAt: timestamp("movedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  reason: text("reason").notNull().default("Ajuste operativo"),
  reference: text("reference"),
}, (table) => [unique("stock_movement_idempotency_unique").on(table.companyId, table.itemId, table.warehouseId, table.movementType, table.reference), index("stock_movement_snapshot_idx").on(table.companyId, table.itemId, table.warehouseId), index("stock_movement_company_moved_at_idx").on(table.companyId, table.movedAt)]);

export const stockLocation = pgTable(
  "stock_location",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
    itemId: text("itemId").notNull().references(() => item.id, { onDelete: "cascade" }),
    warehouseId: text("warehouseId").notNull().references(() => warehouse.id, { onDelete: "cascade" }),
    currentQuantity: numeric("currentQuantity", { precision: 12, scale: 3 }).notNull().default("0"),
    averageCost: numeric("averageCost", { precision: 12, scale: 2 }).notNull().default("0"),
    updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [unique("stock_location_unique").on(table.companyId, table.itemId, table.warehouseId)],
);

export const itemCostHistory = pgTable("item_cost_history", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  itemId: text("itemId").notNull().references(() => item.id, { onDelete: "cascade" }),
  unitCost: numeric("unitCost", { precision: 12, scale: 2 }).notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
  movementId: text("movementId").notNull().references(() => stockMovement.id, { onDelete: "cascade" }),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const invoice = pgTable(
  "invoice",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
    customerId: text("customerId").notNull().references(() => customer.id, { onDelete: "restrict" }),
    paymentMethodId: text("paymentMethodId").references(() => paymentMethod.id, { onDelete: "set null" }),
    paymentMethodName: text("paymentMethodName"),
    paymentMethodType: text("paymentMethodType"),
    paymentBankAccountNumber: text("paymentBankAccountNumber"),
    number: text("number").notNull(),
    issueDate: timestamp("issueDate", { withTimezone: true, mode: "date" }).notNull(),
    dueDate: timestamp("dueDate", { withTimezone: true, mode: "date" }),
    totalAmount: numeric("totalAmount", { precision: 12, scale: 2 }).notNull(),
    status: invoiceStatusEnum("status").notNull().default("DRAFT"),
    paymentStatus: paymentStatusEnum("paymentStatus").notNull().default("PENDING"),
    // Tratamiento IVA para modelos 303/390. null = automático según el país del cliente.
    vatTreatment: text("vatTreatment"),
    notes: text("notes"),
    // INVOICE (ordinaria) o CREDIT_NOTE (factura rectificativa, art. 15 RD 1619/2012).
    invoiceType: text("invoiceType").notNull().default("INVOICE"),
    // Momento de emisión: fija número definitivo, snapshot fiscal y asiento. null = borrador.
    issuedAt: timestamp("issuedAt", { withTimezone: true, mode: "date" }),
    // Rectificativas: factura original, causa (R1–R5), tipo (diferencias/sustitución) y motivo.
    rectifiedInvoiceId: text("rectifiedInvoiceId").references((): AnyPgColumn => invoice.id, { onDelete: "restrict" }),
    rectificationReason: text("rectificationReason"),
    rectificationType: text("rectificationType"),
    rectificationDescription: text("rectificationDescription"),
    // Datos fiscales de emisor y receptor congelados al emitir (el PDF se genera desde aquí).
    issuerSnapshot: jsonb("issuerSnapshot").$type<InvoicePartySnapshot>(),
    customerSnapshot: jsonb("customerSnapshot").$type<InvoicePartySnapshot>(),
    // Serie de numeración elegida (null = la serie por defecto del tipo). Al emitir se usa la serie con
    // el mismo código en el ejercicio de la fecha de emisión.
    seriesId: text("seriesId").references((): AnyPgColumn => documentSeries.id, { onDelete: "set null" }),
    // Documento comercial de origen (presupuesto, pedido o albarán), si la factura se generó desde él.
    salesQuoteId: text("salesQuoteId").references((): AnyPgColumn => salesQuote.id, { onDelete: "set null" }),
    salesOrderId: text("salesOrderId").references((): AnyPgColumn => salesOrder.id, { onDelete: "set null" }),
    deliveryNoteId: text("deliveryNoteId").references((): AnyPgColumn => deliveryNote.id, { onDelete: "set null" }),
    createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("invoice_company_number_unique").on(table.companyId, table.number),
    index("invoice_company_customer_idx").on(table.companyId, table.customerId),
    // Listas por fecha, rangos de fechas, panel (ventas por mes) y modelos fiscales.
    index("invoice_company_issue_date_idx").on(table.companyId, table.issueDate),
    // Filtro de estado de cobro y cartera pendiente del panel.
    index("invoice_company_payment_status_idx").on(table.companyId, table.paymentStatus),
    index("invoice_rectified_invoice_idx").on(table.rectifiedInvoiceId),
    index("invoice_delivery_note_idx").on(table.deliveryNoteId),
    check("invoice_vat_treatment_valid", sql`${table.vatTreatment} IS NULL OR ${table.vatTreatment} IN ('DOMESTIC', 'INTRA_EU', 'INTRA_EU_SERVICES', 'EXPORT', 'EXEMPT', 'REVERSE_CHARGE', 'NOT_SUBJECT')`),
    check("invoice_type_valid", sql`${table.invoiceType} IN ('INVOICE', 'CREDIT_NOTE')`),
    check("invoice_credit_note_link", sql`${table.invoiceType} = 'INVOICE' OR ${table.rectifiedInvoiceId} IS NOT NULL`),
    check("invoice_negative_only_credit_note", sql`${table.invoiceType} = 'CREDIT_NOTE' OR ${table.totalAmount} >= 0`),
    check("invoice_rectification_reason_valid", sql`${table.rectificationReason} IS NULL OR ${table.rectificationReason} IN ('R1', 'R2', 'R3', 'R4', 'R5')`),
    check("invoice_rectification_type_valid", sql`${table.rectificationType} IS NULL OR ${table.rectificationType} IN ('DIFFERENCES', 'SUBSTITUTION')`),
  ],
);

/** Datos fiscales congelados de una parte de la factura (emisor o cliente) en el momento de emitirla. */
export type InvoicePartySnapshot = {
  name: string;
  legalName?: string | null;
  taxId: string | null;
  address: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  countryCode: string | null;
  number?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
};

export const invoicePaymentMethod = pgTable("invoice_payment_method", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  invoiceId: text("invoiceId").notNull().references(() => invoice.id, { onDelete: "cascade" }),
  paymentMethodId: text("paymentMethodId").references(() => paymentMethod.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  type: paymentMethodTypeEnum("type").notNull(),
  bankAccountNumber: text("bankAccountNumber"),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  unique("invoice_payment_method_invoice_position_unique").on(table.invoiceId, table.position),
  unique("invoice_payment_method_invoice_method_unique").on(table.invoiceId, table.paymentMethodId),
  index("invoice_payment_method_invoice_idx").on(table.invoiceId),
  index("invoice_payment_method_method_idx").on(table.paymentMethodId),
]);

export const invoiceLine = pgTable("invoice_line", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  invoiceId: text("invoiceId").notNull().references(() => invoice.id, { onDelete: "cascade" }),
  itemId: text("itemId").references(() => item.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
  unitPrice: numeric("unitPrice", { precision: 12, scale: 2 }).notNull(),
  discountPct: numeric("discountPct", { precision: 6, scale: 3 }).notNull().default("0"),
  taxRate: numeric("taxRate", { precision: 6, scale: 3 }).notNull().default("0"),
  retentionRate: numeric("retentionRate", { precision: 6, scale: 3 }).notNull().default("0"),
  lineTotal: numeric("lineTotal", { precision: 12, scale: 2 }).notNull(),
}, (table) => [
  // Postgres no indexa las FK: sin esto, leer las líneas de una factura (o agregar ventas por periodo) recorre toda la tabla.
  index("invoice_line_invoice_idx").on(table.invoiceId),
]);

export const invoiceLineTax = pgTable("invoice_line_tax", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  invoiceLineId: text("invoiceLineId").notNull().references(() => invoiceLine.id, { onDelete: "cascade" }),
  taxId: text("taxId").references(() => tax.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  rate: numeric("rate", { precision: 6, scale: 3 }).notNull(),
  kind: text("kind").notNull(),
  operation: text("operation").notNull(),
  baseAmount: numeric("baseAmount", { precision: 12, scale: 2 }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  index("invoice_line_tax_line_idx").on(table.invoiceLineId),
  index("invoice_line_tax_tax_idx").on(table.taxId),
  check("invoice_line_tax_rate_nonnegative", sql`${table.rate} >= 0`),
  check("invoice_line_tax_operation_valid", sql`${table.operation} IN ('ADD', 'SUBTRACT')`),
]);

export const salesQuote = pgTable("sales_quote", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  customerId: text("customerId").notNull().references(() => customer.id, { onDelete: "restrict" }),
  number: text("number").notNull(),
  issueDate: timestamp("issueDate", { withTimezone: true, mode: "date" }).notNull(),
  validUntil: timestamp("validUntil", { withTimezone: true, mode: "date" }),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("taxAmount", { precision: 12, scale: 2 }).notNull().default("0"),
  retentionAmount: numeric("retentionAmount", { precision: 12, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("totalAmount", { precision: 12, scale: 2 }).notNull().default("0"),
  status: salesDocumentStatusEnum("status").notNull().default("DRAFT"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [unique("sales_quote_company_number_unique").on(table.companyId, table.number)]);

export const salesQuoteLine = pgTable("sales_quote_line", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  salesQuoteId: text("salesQuoteId").notNull().references(() => salesQuote.id, { onDelete: "cascade" }),
  itemId: text("itemId").references(() => item.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
  unitPrice: numeric("unitPrice", { precision: 12, scale: 2 }).notNull(),
  discountPct: numeric("discountPct", { precision: 6, scale: 3 }).notNull().default("0"),
  taxRate: numeric("taxRate", { precision: 6, scale: 3 }).notNull().default("0"),
  retentionRate: numeric("retentionRate", { precision: 6, scale: 3 }).notNull().default("0"),
  lineTotal: numeric("lineTotal", { precision: 12, scale: 2 }).notNull().default("0"),
});

export const salesOrder = pgTable("sales_order", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  customerId: text("customerId").notNull().references(() => customer.id, { onDelete: "restrict" }),
  salesQuoteId: text("salesQuoteId").references(() => salesQuote.id, { onDelete: "set null" }),
  number: text("number").notNull(),
  issueDate: timestamp("issueDate", { withTimezone: true, mode: "date" }).notNull(),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("taxAmount", { precision: 12, scale: 2 }).notNull().default("0"),
  retentionAmount: numeric("retentionAmount", { precision: 12, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("totalAmount", { precision: 12, scale: 2 }).notNull().default("0"),
  status: salesDocumentStatusEnum("status").notNull().default("DRAFT"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [unique("sales_order_company_number_unique").on(table.companyId, table.number)]);

export const salesOrderLine = pgTable("sales_order_line", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  salesOrderId: text("salesOrderId").notNull().references(() => salesOrder.id, { onDelete: "cascade" }),
  itemId: text("itemId").references(() => item.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
  unitPrice: numeric("unitPrice", { precision: 12, scale: 2 }).notNull(),
  discountPct: numeric("discountPct", { precision: 6, scale: 3 }).notNull().default("0"),
  taxRate: numeric("taxRate", { precision: 6, scale: 3 }).notNull().default("0"),
  retentionRate: numeric("retentionRate", { precision: 6, scale: 3 }).notNull().default("0"),
  lineTotal: numeric("lineTotal", { precision: 12, scale: 2 }).notNull().default("0"),
});

export const deliveryNote = pgTable("delivery_note", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  customerId: text("customerId").notNull().references(() => customer.id, { onDelete: "restrict" }),
  salesOrderId: text("salesOrderId").references(() => salesOrder.id, { onDelete: "set null" }),
  warehouseId: text("warehouseId").references(() => warehouse.id, { onDelete: "restrict" }),
  number: text("number").notNull(),
  issuedAt: timestamp("issuedAt", { withTimezone: true, mode: "date" }).notNull(),
  status: salesDocumentStatusEnum("status").notNull().default("DRAFT"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [unique("delivery_note_company_number_unique").on(table.companyId, table.number)]);

export const deliveryNoteLine = pgTable("delivery_note_line", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  deliveryNoteId: text("deliveryNoteId").notNull().references(() => deliveryNote.id, { onDelete: "cascade" }),
  salesOrderLineId: text("salesOrderLineId").references(() => salesOrderLine.id, { onDelete: "restrict" }),
  itemId: text("itemId").references(() => item.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
});

export const invoicePayment = pgTable("invoice_payment", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  invoiceId: text("invoiceId").notNull().references(() => invoice.id, { onDelete: "cascade" }),
  paymentId: text("paymentId").notNull().references(() => payment.id, { onDelete: "cascade" }),
  amountApplied: numeric("amountApplied", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [index("invoice_payment_company_invoice_idx").on(table.companyId, table.invoiceId), check("invoice_payment_amount_positive", sql`${table.amountApplied} > 0`)]);

export const purchaseOrder = pgTable("purchase_order", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  supplierPartnerId: text("supplierPartnerId").notNull().references(() => partner.id, { onDelete: "restrict" }),
  number: text("number").notNull(),
  status: text("status").notNull().default("DRAFT"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [unique("purchase_order_company_number_unique").on(table.companyId, table.number)]);

export const purchaseOrderLine = pgTable("purchase_order_line", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  purchaseOrderId: text("purchaseOrderId").notNull().references(() => purchaseOrder.id, { onDelete: "cascade" }),
  itemId: text("itemId").references(() => item.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
  unitPrice: numeric("unitPrice", { precision: 12, scale: 2 }).notNull(),
  lineTotal: numeric("lineTotal", { precision: 12, scale: 2 }).notNull(),
});

export const goodsReceipt = pgTable("goods_receipt", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  purchaseOrderId: text("purchaseOrderId").notNull().references(() => purchaseOrder.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  warehouseId: text("warehouseId").references(() => warehouse.id, { onDelete: "restrict" }),
  supplierDocumentNumber: text("supplierDocumentNumber"),
  notes: text("notes"),
  receivedAt: timestamp("receivedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  unique("goods_receipt_company_number_unique").on(table.companyId, table.number),
  index("goods_receipt_company_date_idx").on(table.companyId, table.receivedAt),
]);

export const goodsReceiptLine = pgTable("goods_receipt_line", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  goodsReceiptId: text("goodsReceiptId").notNull().references(() => goodsReceipt.id, { onDelete: "cascade" }),
  purchaseOrderLineId: text("purchaseOrderLineId").references(() => purchaseOrderLine.id, { onDelete: "restrict" }),
  itemId: text("itemId").references(() => item.id, { onDelete: "set null" }),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
});

export const supplierInvoice = pgTable("supplier_invoice", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  supplierPartnerId: text("supplierPartnerId").notNull().references(() => partner.id, { onDelete: "restrict" }),
  purchaseOrderId: text("purchaseOrderId").references(() => purchaseOrder.id, { onDelete: "set null" }),
  goodsReceiptId: text("goodsReceiptId").references(() => goodsReceipt.id, { onDelete: "set null" }),
  origin: text("origin").notNull().default("PURCHASE"),
  number: text("number").notNull(),
  supplierDocumentNumber: text("supplierDocumentNumber"),
  supplierDocumentNumberNormalized: text("supplierDocumentNumberNormalized"),
  supplierIdentityKey: text("supplierIdentityKey"),
  documentSha256: text("documentSha256"),
  idempotencyKey: text("idempotencyKey"),
  currencyCode: text("currencyCode").notNull().default("EUR"),
  issueDate: timestamp("issueDate", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  dueDate: timestamp("dueDate", { withTimezone: true, mode: "date" }),
  status: text("status").notNull().default("POSTED"),
  paymentStatus: paymentStatusEnum("paymentStatus").notNull().default("PENDING"),
  subtotalAmount: numeric("subtotalAmount", { precision: 12, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("taxAmount", { precision: 12, scale: 2 }).notNull().default("0"),
  retentionAmount: numeric("retentionAmount", { precision: 12, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("totalAmount", { precision: 12, scale: 2 }).notNull(),
  // Tratamiento IVA: DOMESTIC, INTRA_EU (adquisición intracomunitaria), REVERSE_CHARGE (ISP),
  // IMPORT, NOT_SUBJECT. null = automático según el país del proveedor.
  vatTreatment: text("vatTreatment"),
  notes: text("notes"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  unique("supplier_invoice_company_number_unique").on(table.companyId, table.number),
  check("supplier_invoice_vat_treatment_valid", sql`${table.vatTreatment} IS NULL OR ${table.vatTreatment} IN ('DOMESTIC', 'INTRA_EU', 'REVERSE_CHARGE', 'IMPORT', 'NOT_SUBJECT')`),
  uniqueIndex("supplier_invoice_supplier_document_canonical_unique")
    .on(table.companyId, table.supplierIdentityKey, table.supplierDocumentNumberNormalized)
    .where(sql`${table.supplierIdentityKey} IS NOT NULL AND ${table.supplierDocumentNumberNormalized} IS NOT NULL AND ${table.status} <> 'VOID'`),
  uniqueIndex("supplier_invoice_document_sha_unique")
    .on(table.companyId, table.documentSha256)
    .where(sql`${table.documentSha256} IS NOT NULL AND ${table.status} <> 'VOID'`),
  uniqueIndex("supplier_invoice_idempotency_unique")
    .on(table.companyId, table.idempotencyKey)
    .where(sql`${table.idempotencyKey} IS NOT NULL`),
  index("supplier_invoice_company_supplier_idx").on(table.companyId, table.supplierPartnerId),
  index("supplier_invoice_company_issue_date_idx").on(table.companyId, table.issueDate),
  index("supplier_invoice_company_payment_status_idx").on(table.companyId, table.paymentStatus),
]);

export const supplierInvoiceLine = pgTable("supplier_invoice_line", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  supplierInvoiceId: text("supplierInvoiceId").notNull().references(() => supplierInvoice.id, { onDelete: "cascade" }),
  itemId: text("itemId").references(() => item.id, { onDelete: "set null" }),
  expenseAccountId: text("expenseAccountId").references(() => accountChart.id, { onDelete: "set null" }),
  // Trazabilidad compra → recepción → factura por línea (no por artículo): permite facturar
  // varias recepciones y repetir un artículo en varias líneas del pedido.
  purchaseOrderLineId: text("purchaseOrderLineId").references(() => purchaseOrderLine.id, { onDelete: "set null" }),
  goodsReceiptLineId: text("goodsReceiptLineId").references(() => goodsReceiptLine.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
  unitPrice: numeric("unitPrice", { precision: 12, scale: 2 }).notNull(),
  taxRate: numeric("taxRate", { precision: 6, scale: 3 }).notNull().default("21"),
  taxDeductiblePct: numeric("taxDeductiblePct", { precision: 6, scale: 3 }).notNull().default("100"),
  retentionRate: numeric("retentionRate", { precision: 6, scale: 3 }).notNull().default("0"),
  subtotalAmount: numeric("subtotalAmount", { precision: 12, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("taxAmount", { precision: 12, scale: 2 }).notNull().default("0"),
  retentionAmount: numeric("retentionAmount", { precision: 12, scale: 2 }).notNull().default("0"),
  lineTotal: numeric("lineTotal", { precision: 12, scale: 2 }).notNull(),
}, (table) => [
  index("supplier_invoice_line_invoice_idx").on(table.supplierInvoiceId),
  index("supplier_invoice_line_po_line_idx").on(table.purchaseOrderLineId),
  index("supplier_invoice_line_receipt_line_idx").on(table.goodsReceiptLineId),
]);

// Recepciones cubiertas por una factura de proveedor (una factura puede agrupar varias
// entregas del mismo pedido). `supplier_invoice.goodsReceiptId` conserva la primera por compatibilidad.
export const supplierInvoiceGoodsReceipt = pgTable("supplier_invoice_goods_receipt", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  supplierInvoiceId: text("supplierInvoiceId").notNull().references(() => supplierInvoice.id, { onDelete: "cascade" }),
  goodsReceiptId: text("goodsReceiptId").notNull().references(() => goodsReceipt.id, { onDelete: "cascade" }),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  unique("supplier_invoice_goods_receipt_unique").on(table.supplierInvoiceId, table.goodsReceiptId),
  index("supplier_invoice_goods_receipt_receipt_idx").on(table.companyId, table.goodsReceiptId),
]);

export const supplierInvoiceAttachment = pgTable("supplier_invoice_attachment", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  supplierInvoiceId: text("supplierInvoiceId").notNull().references(() => supplierInvoice.id, { onDelete: "cascade" }),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  fileName: text("fileName").notNull(),
  fileUrl: text("fileUrl").notNull(),
  storageKey: text("storageKey"),
  contentType: text("contentType"),
  sizeBytes: integer("sizeBytes"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const expenseIngestionBatch = pgTable("expense_ingestion_batch", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  tenantId: text("tenantId").notNull().references(() => tenant.id, { onDelete: "cascade" }),
  actorUserId: text("actorUserId").notNull().references(() => user.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("OPEN"),
  expectedFiles: integer("expectedFiles").notNull().default(0),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [index("expense_ingestion_batch_company_created_idx").on(table.companyId, table.createdAt)]);

export const expenseOcrJob = pgTable("expense_ocr_job", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  tenantId: text("tenantId").notNull().references(() => tenant.id, { onDelete: "cascade" }),
  actorUserId: text("actorUserId").notNull().references(() => user.id, { onDelete: "cascade" }),
  batchId: text("batchId").references(() => expenseIngestionBatch.id, { onDelete: "set null" }),
  supplierInvoiceId: text("supplierInvoiceId").references(() => supplierInvoice.id, { onDelete: "set null" }),
  status: text("status").notNull().default("PENDING"),
  fileName: text("fileName").notNull(),
  filePath: text("filePath").notNull(),
  fileUrl: text("fileUrl"),
  storageKey: text("storageKey"),
  contentType: text("contentType").notNull(),
  sizeBytes: integer("sizeBytes"),
  documentSha256: text("documentSha256"),
  attempts: integer("attempts").notNull().default(0),
  leaseExpiresAt: timestamp("leaseExpiresAt", { withTimezone: true, mode: "date" }),
  extractionProvider: text("extractionProvider"),
  extractionModel: text("extractionModel"),
  extractionSchemaVersion: integer("extractionSchemaVersion").notNull().default(1),
  sourceText: text("sourceText"),
  extractedJson: text("extractedJson"),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  startedAt: timestamp("startedAt", { withTimezone: true, mode: "date" }),
  finishedAt: timestamp("finishedAt", { withTimezone: true, mode: "date" }),
}, (table) => [
  index("expense_ocr_job_company_status_idx").on(table.companyId, table.status),
  index("expense_ocr_job_actor_created_idx").on(table.actorUserId, table.createdAt),
  index("expense_ocr_job_batch_idx").on(table.batchId, table.createdAt),
  index("expense_ocr_job_lease_idx").on(table.status, table.leaseExpiresAt),
]);

// Preferencias de lectura automática de facturas por empresa. Sin fila = valores por defecto
// (análisis externo permitido si el servidor tiene OPENAI_API_KEY).
export const expenseOcrSetting = pgTable("expense_ocr_setting", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }).unique(),
  // false = nunca se envían documentos a proveedores externos de IA (solo OCR local).
  externalAiEnabled: boolean("externalAiEnabled").notNull().default(true),
  updatedByUserId: text("updatedByUserId").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const journal = pgTable("journal", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
}, (table) => [unique("journal_company_code_unique").on(table.companyId, table.code)]);

export const accountChart = pgTable(
  "account_chart",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: accountTypeEnum("type").notNull(),
    parentCode: text("parentCode"),
    level: integer("level").notNull().default(3),
    isPostable: boolean("isPostable").notNull().default(true),
    isActive: boolean("isActive").notNull().default(false),
    source: text("source").notNull().default("manual"),
    templateVersion: text("templateVersion"),
  },
  (table) => [
    unique("account_chart_company_code_unique").on(table.companyId, table.code),
    index("account_chart_company_active_idx").on(table.companyId, table.isActive),
    index("account_chart_company_postable_idx").on(table.companyId, table.isPostable),
  ],
);

export const journalEntry = pgTable("journal_entry", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  journalId: text("journalId").notNull().references(() => journal.id, { onDelete: "restrict" }),
  postedAt: timestamp("postedAt", { withTimezone: true, mode: "date" }).notNull(),
  reference: text("reference"),
  sourceType: text("sourceType"),
  sourceId: text("sourceId"),
  isAutomatic: boolean("isAutomatic").notNull().default(false),
  reversedAt: timestamp("reversedAt", { withTimezone: true, mode: "date" }),
  reversesEntryId: text("reversesEntryId"),
}, (table) => [
  unique("journal_entry_company_number_unique").on(table.companyId, table.number),
  index("journal_entry_company_date_idx").on(table.companyId, table.postedAt),
  index("journal_entry_source_idx").on(table.companyId, table.sourceType, table.sourceId),
  // Idempotencia del ciclo de ejercicio: un único asiento vigente de regularización, cierre y apertura por ejercicio.
  uniqueIndex("journal_entry_fiscal_year_lifecycle_unique")
    .on(table.companyId, table.sourceType, table.sourceId)
    .where(sql`${table.sourceType} IN ('fiscalYearRegularization', 'fiscalYearClosing', 'fiscalYearOpening') AND ${table.reversesEntryId} IS NULL AND ${table.reversedAt} IS NULL`),
]);

export const journalLine = pgTable("journal_line", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  journalEntryId: text("journalEntryId").notNull().references(() => journalEntry.id, { onDelete: "cascade" }),
  accountId: text("accountId").notNull().references(() => accountChart.id, { onDelete: "restrict" }),
  debit: numeric("debit", { precision: 12, scale: 2 }).notNull().default("0"),
  credit: numeric("credit", { precision: 12, scale: 2 }).notNull().default("0"),
}, (table) => [
  index("journal_line_entry_idx").on(table.journalEntryId),
  index("journal_line_account_idx").on(table.accountId),
  check("journal_line_valid_amounts", sql`${table.debit} >= 0 AND ${table.credit} >= 0 AND ((${table.debit} > 0 AND ${table.credit} = 0) OR (${table.credit} > 0 AND ${table.debit} = 0))`),
]);

export const bankTransaction = pgTable("bank_transaction", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  // no action (comprobado al final de la sentencia): una cuenta con movimientos no se puede borrar
  // sola (se archiva), pero el borrado en cascada de la empresa completa sigue funcionando.
  bankAccountId: text("bankAccountId").notNull().references(() => bankAccount.id, { onDelete: "no action" }),
  postedAt: timestamp("postedAt", { withTimezone: true, mode: "date" }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  description: text("description").notNull(),
  reconciliationStatus: reconciliationStatusEnum("reconciliationStatus").notNull().default("PENDING"),
  matchedInvoicePaymentId: text("matchedInvoicePaymentId").references(() => invoicePayment.id, { onDelete: "set null" }),
  matchedSupplierPaymentId: text("matchedSupplierPaymentId").references(() => supplierInvoicePayment.id, { onDelete: "set null" }),
  reconciledAt: timestamp("reconciledAt", { withTimezone: true, mode: "date" }),
  // Datos del extracto (importación CSV/Excel/Norma 43): fecha valor, saldo tras el movimiento y referencia.
  valueDate: timestamp("valueDate", { withTimezone: true, mode: "date" }),
  balanceAfter: numeric("balanceAfter", { precision: 14, scale: 2 }),
  reference: text("reference"),
  // MANUAL | CSV | XLSX | NORMA43 | PSD2 (null = registros anteriores a la importación con asistente).
  // Con PSD2 `reference` guarda el transactionId del banco (clave de deduplicación).
  importSource: text("importSource"),
  // Cómo se resolvió al conciliar: PAYMENT (cobros/pagos), ACCOUNT (asignado a cuenta) o MIXED.
  resolution: text("resolution"),
}, (table) => [
  index("bank_transaction_account_date_idx").on(table.bankAccountId, table.postedAt),
  // Movimientos pendientes de conciliar (panel "Qué hacer hoy", filtro de la lista, auto-conciliación).
  index("bank_transaction_account_status_idx").on(table.bankAccountId, table.reconciliationStatus),
  check("bank_transaction_resolution_valid", sql`${table.resolution} IS NULL OR ${table.resolution} IN ('PAYMENT', 'ACCOUNT', 'MIXED')`),
  check("bank_transaction_import_source_valid", sql`${table.importSource} IS NULL OR ${table.importSource} IN ('MANUAL', 'CSV', 'XLSX', 'NORMA43', 'PSD2')`),
]);

export const tax = pgTable("tax", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  rate: numeric("rate", { precision: 6, scale: 3 }).notNull(),
  kind: text("kind").notNull().default("VAT"),
  operation: text("operation").notNull().default("ADD"),
  isDefault: boolean("isDefault").notNull().default(false),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  unique("tax_company_name_unique").on(table.companyId, table.name),
  index("tax_company_active_idx").on(table.companyId, table.isActive),
  check("tax_rate_nonnegative", sql`${table.rate} >= 0`),
  check("tax_kind_valid", sql`${table.kind} IN ('VAT', 'SURCHARGE', 'WITHHOLDING', 'OTHER')`),
  check("tax_operation_valid", sql`${table.operation} IN ('ADD', 'SUBTRACT')`),
]);

export const fiscalReport = pgTable(
  "fiscal_report",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    period: text("period").notNull(),
    status: fiscalReportStatusEnum("status").notNull().default("DRAFT"),
    filedAt: timestamp("filedAt", { withTimezone: true, mode: "date" }),
    // Presentación en la sede de la AEAT: número de justificante (13 dígitos) y, si hubo pago, NRC del banco.
    filingReceiptNumber: text("filingReceiptNumber"),
    paymentNrc: text("paymentNrc"),
    createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [unique("fiscal_report_company_code_period_unique").on(table.companyId, table.code, table.period)],
);

export const kpiSnapshot = pgTable("kpi_snapshot", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  metricKey: text("metricKey").notNull(),
  metricValue: numeric("metricValue", { precision: 18, scale: 4 }).notNull(),
  capturedAt: timestamp("capturedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const subscription = pgTable(
  "subscription",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenantId").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    plan: text("plan").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    currentPeriodEndsAt: timestamp("currentPeriodEndsAt", { withTimezone: true, mode: "date" }),
    stripeCustomerId: text("stripeCustomerId"),
    stripeSubscriptionId: text("stripeSubscriptionId").unique(),
    cancelAtPeriodEnd: boolean("cancelAtPeriodEnd").notNull().default(false),
    /** `created` del último evento de Stripe aplicado; descarta eventos que llegan desordenados. */
    lastStripeEventAt: timestamp("lastStripeEventAt", { withTimezone: true, mode: "date" }),
  },
  (table) => [unique("subscription_tenant_unique").on(table.tenantId), index("subscription_customer_idx").on(table.stripeCustomerId)],
);

/** Idempotencia del webhook de Stripe: un evento (`evt_…`) se procesa una sola vez. */
export const processedStripeEvent = pgTable("processed_stripe_event", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  stripeCreatedAt: timestamp("stripeCreatedAt", { withTimezone: true, mode: "date" }).notNull(),
  processedAt: timestamp("processedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const tenantSecurityPolicy = pgTable(
  "tenant_security_policy",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenantId").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    sessionTimeoutMinutes: integer("sessionTimeoutMinutes"),
    requireTwoFactor: boolean("requireTwoFactor"),
    apiKeyRotationDays: integer("apiKeyRotationDays"),
    allowedDomains: text("allowedDomains"),
    allowedIpNotes: text("allowedIpNotes"),
    createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [unique("tenant_security_policy_tenant_unique").on(table.tenantId), index("tenant_security_policy_tenant_idx").on(table.tenantId)],
);

export const apiKey = pgTable("api_key", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenantId").notNull().references(() => tenant.id, { onDelete: "cascade" }),
  companyId: text("companyId").references(() => company.id, { onDelete: "cascade" }),
  keyPrefix: text("keyPrefix"),
  keyHash: text("keyHash").notNull(),
  name: text("name").notNull(),
  scopes: text("scopes").notNull().default('["customer.read","supplier.read","invoice.read"]'),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  revokedAt: timestamp("revokedAt", { withTimezone: true, mode: "date" }),
  lastUsedAt: timestamp("lastUsedAt", { withTimezone: true, mode: "date" }),
}, (table) => [unique("api_key_prefix_unique").on(table.keyPrefix), index("api_key_tenant_idx").on(table.tenantId)]);

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenantId").notNull().references(() => tenant.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: membershipRoleEnum("role").notNull().default("MEMBER"),
  token: text("token").notNull().unique(),
  // Quién invitó (se muestra en el email y en la página de aceptación).
  invitedByUserId: text("invitedByUserId").references(() => user.id, { onDelete: "set null" }),
  expiresAt: timestamp("expiresAt", { withTimezone: true, mode: "date" }).notNull(),
  acceptedAt: timestamp("acceptedAt", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const plan = pgTable("plan", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  stripePriceId: text("stripePriceId"),
  limits: text("limits"),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const payment = pgTable("payment", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  invoiceId: text("invoiceId").notNull().references(() => invoice.id, { onDelete: "cascade" }),
  paymentMethodId: text("paymentMethodId").references(() => paymentMethod.id, { onDelete: "set null" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  postedAt: timestamp("postedAt", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [unique("payment_company_number_unique").on(table.companyId, table.number), index("payment_company_invoice_date_idx").on(table.companyId, table.invoiceId, table.postedAt), check("payment_amount_positive", sql`${table.amount} > 0`)]);

export const supplierPayment = pgTable("supplier_payment", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  supplierPartnerId: text("supplierPartnerId").notNull().references(() => partner.id, { onDelete: "restrict" }),
  supplierInvoiceId: text("supplierInvoiceId").references(() => supplierInvoice.id, { onDelete: "set null" }),
  paymentMethodId: text("paymentMethodId").references(() => paymentMethod.id, { onDelete: "set null" }),
  bankAccountId: text("bankAccountId").references(() => bankAccount.id, { onDelete: "set null" }),
  reference: text("reference"),
  notes: text("notes"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  postedAt: timestamp("postedAt", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  unique("supplier_payment_company_number_unique").on(table.companyId, table.number),
  index("supplier_payment_company_supplier_date_idx").on(table.companyId, table.supplierPartnerId, table.postedAt),
  index("supplier_payment_company_invoice_date_idx").on(table.companyId, table.supplierInvoiceId, table.postedAt),
  check("supplier_payment_amount_positive", sql`${table.amount} > 0`),
]);

export const supplierInvoicePayment = pgTable("supplier_invoice_payment", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  supplierInvoiceId: text("supplierInvoiceId").notNull().references(() => supplierInvoice.id, { onDelete: "cascade" }),
  supplierPaymentId: text("supplierPaymentId").notNull().references(() => supplierPayment.id, { onDelete: "cascade" }),
  amountApplied: numeric("amountApplied", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [index("supplier_invoice_payment_invoice_idx").on(table.companyId, table.supplierInvoiceId), check("supplier_invoice_payment_amount_positive", sql`${table.amountApplied} > 0`)]);

/**
 * VeriFactu (RD 1007/2023 y Orden HAC/1177/2024): registros de facturación de alta y anulación.
 * Cadena de huellas por empresa emisora, estrictamente secuencial (`sequence`) y sin bifurcaciones
 * (único por registro anterior). Los campos que intervienen en la huella son inmutables: lo
 * garantiza el trigger `verifactu_record_immutable` (ver `src/server/verifactu/sql.ts`).
 */
export const verifactuRecord = pgTable("verifactu_record", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  invoiceId: text("invoiceId").notNull().references(() => invoice.id, { onDelete: "restrict" }),
  // ALTA (registro de facturación de alta) o ANULACION.
  recordType: text("recordType").notNull(),
  // VERIFACTU (remisión a la AEAT) o NO_VERIFACTU (conservación local).
  mode: text("mode").notNull(),
  sequence: integer("sequence").notNull(),
  issuerTaxId: text("issuerTaxId").notNull(),
  issuerName: text("issuerName").notNull(),
  invoiceNumber: text("invoiceNumber").notNull(),
  // Fecha de expedición en formato AEAT dd-mm-aaaa (tal y como entra en la huella).
  invoiceIssueDate: text("invoiceIssueDate").notNull(),
  // F1, F2, R1–R5 (solo altas).
  invoiceTypeCode: text("invoiceTypeCode"),
  // S (sustitución) o I (diferencias), solo rectificativas.
  rectificationKind: text("rectificationKind"),
  rectifiedInvoices: jsonb("rectifiedInvoices").$type<Array<{ issuerTaxId: string; invoiceNumber: string; invoiceIssueDate: string }>>(),
  description: text("description"),
  recipient: jsonb("recipient").$type<{ name: string; taxId: string | null; countryCode: string | null; idType: string | null } | null>(),
  breakdown: jsonb("breakdown").$type<Array<Record<string, string>>>(),
  // CuotaTotal e ImporteTotal con 2 decimales y punto (texto exacto usado en la huella).
  taxAmount: text("taxAmount"),
  totalAmount: text("totalAmount"),
  previousRecordId: text("previousRecordId").references((): AnyPgColumn => verifactuRecord.id, { onDelete: "restrict" }),
  previousIssuerTaxId: text("previousIssuerTaxId"),
  previousInvoiceNumber: text("previousInvoiceNumber"),
  previousInvoiceIssueDate: text("previousInvoiceIssueDate"),
  previousHash: text("previousHash"),
  hash: text("hash").notNull(),
  // FechaHoraHusoGenRegistro exacta (ISO 8601 con huso) usada en la huella.
  generatedAtText: text("generatedAtText").notNull(),
  generatedAt: timestamp("generatedAt", { withTimezone: true, mode: "date" }).notNull(),
  systemInfo: jsonb("systemInfo").$type<Record<string, string>>().notNull(),
  // PENDING_SEND, SENT, ACCEPTED, ACCEPTED_WITH_ERRORS, REJECTED, NOT_REQUIRED.
  status: text("status").notNull(),
  sendAttempts: integer("sendAttempts").notNull().default(0),
  nextAttemptAt: timestamp("nextAttemptAt", { withTimezone: true, mode: "date" }),
  lastAttemptAt: timestamp("lastAttemptAt", { withTimezone: true, mode: "date" }),
  sentAt: timestamp("sentAt", { withTimezone: true, mode: "date" }),
  aeatCsv: text("aeatCsv"),
  aeatErrorCode: text("aeatErrorCode"),
  aeatErrorMessage: text("aeatErrorMessage"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  unique("verifactu_record_company_sequence_unique").on(table.companyId, table.sequence),
  // Sin bifurcaciones: cada registro solo puede tener un sucesor y solo hay un primer registro.
  uniqueIndex("verifactu_record_company_previous_unique").on(table.companyId, table.previousRecordId).where(sql`${table.previousRecordId} IS NOT NULL`),
  uniqueIndex("verifactu_record_company_first_unique").on(table.companyId).where(sql`${table.previousRecordId} IS NULL`),
  index("verifactu_record_invoice_idx").on(table.invoiceId),
  index("verifactu_record_status_idx").on(table.status, table.nextAttemptAt),
  check("verifactu_record_type_valid", sql`${table.recordType} IN ('ALTA', 'ANULACION')`),
  check("verifactu_record_mode_valid", sql`${table.mode} IN ('VERIFACTU', 'NO_VERIFACTU')`),
  check("verifactu_record_status_valid", sql`${table.status} IN ('PENDING_SEND', 'SENT', 'ACCEPTED', 'ACCEPTED_WITH_ERRORS', 'REJECTED', 'NOT_REQUIRED')`),
  check("verifactu_record_hash_format", sql`${table.hash} ~ '^[0-9A-F]{64}$'`),
  check("verifactu_record_chain_link", sql`(${table.sequence} = 1 AND ${table.previousRecordId} IS NULL AND ${table.previousHash} IS NULL) OR (${table.sequence} > 1 AND ${table.previousRecordId} IS NOT NULL AND ${table.previousHash} IS NOT NULL)`),
]);

/** Cabeza de la cadena VeriFactu de cada empresa: se bloquea (FOR UPDATE) para encadenar sin bifurcaciones. */
export const verifactuChainHead = pgTable("verifactu_chain_head", {
  companyId: text("companyId").primaryKey().references(() => company.id, { onDelete: "cascade" }),
  lastRecordId: text("lastRecordId").references((): AnyPgColumn => verifactuRecord.id, { onDelete: "restrict" }),
  lastSequence: integer("lastSequence").notNull().default(0),
  lastHash: text("lastHash"),
  lastEventSequence: integer("lastEventSequence").notNull().default(0),
  lastEventHash: text("lastEventHash"),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/** Registro de eventos del sistema informático de facturación (arranque, anomalías, exportaciones…), encadenado. */
export const verifactuEvent = pgTable("verifactu_event", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  eventType: text("eventType").notNull(),
  description: text("description").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  actorUserId: text("actorUserId"),
  previousHash: text("previousHash"),
  hash: text("hash").notNull(),
  generatedAtText: text("generatedAtText").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  unique("verifactu_event_company_sequence_unique").on(table.companyId, table.sequence),
  index("verifactu_event_company_created_idx").on(table.companyId, table.createdAt),
  check("verifactu_event_hash_format", sql`${table.hash} ~ '^[0-9A-F]{64}$'`),
]);

/**
 * Tesorería · conciliación: cómo se ha aplicado un movimiento bancario. Un movimiento puede
 * repartirse entre varios cobros/pagos (existentes o creados desde la mesa de conciliación) y
 * cuentas contables ("Asignar a cuenta"). `amount` va en el sentido del movimiento: positivo
 * suma al movimiento; negativo resta (p. ej. una comisión descontada de un cobro).
 */
export const bankTransactionAllocation = pgTable("bank_transaction_allocation", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  bankTransactionId: text("bankTransactionId").notNull().references(() => bankTransaction.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  invoicePaymentId: text("invoicePaymentId").references(() => invoicePayment.id, { onDelete: "set null" }),
  paymentId: text("paymentId").references(() => payment.id, { onDelete: "set null" }),
  supplierInvoicePaymentId: text("supplierInvoicePaymentId").references(() => supplierInvoicePayment.id, { onDelete: "set null" }),
  supplierPaymentId: text("supplierPaymentId").references(() => supplierPayment.id, { onDelete: "set null" }),
  accountId: text("accountId").references(() => accountChart.id, { onDelete: "restrict" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  // El cobro/pago se creó al conciliar: deshacer lo elimina (si no, solo se desvincula).
  createdPayment: boolean("createdPayment").notNull().default(false),
  ruleId: text("ruleId").references((): AnyPgColumn => bankReconciliationRule.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  index("bank_transaction_allocation_transaction_idx").on(table.bankTransactionId),
  index("bank_transaction_allocation_invoice_payment_idx").on(table.companyId, table.invoicePaymentId),
  index("bank_transaction_allocation_supplier_payment_idx").on(table.companyId, table.supplierInvoicePaymentId),
  check("bank_transaction_allocation_kind_valid", sql`${table.kind} IN ('CUSTOMER_PAYMENT', 'SUPPLIER_PAYMENT', 'ACCOUNT')`),
  check("bank_transaction_allocation_amount_nonzero", sql`${table.amount} <> 0`),
]);

/** Reglas de conciliación: "concepto contiene X [e importe entre A y B] → cuenta / contrapartida". */
export const bankReconciliationRule = pgTable("bank_reconciliation_rule", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  conceptContains: text("conceptContains").notNull(),
  // ANY | IN (solo ingresos) | OUT (solo cargos).
  direction: text("direction").notNull().default("ANY"),
  minAmount: numeric("minAmount", { precision: 12, scale: 2 }),
  maxAmount: numeric("maxAmount", { precision: 12, scale: 2 }),
  accountId: text("accountId").references(() => accountChart.id, { onDelete: "cascade" }),
  partnerId: text("partnerId").references(() => partner.id, { onDelete: "cascade" }),
  // Aplicar sin preguntar al importar extractos (solo reglas de cuenta).
  autoApply: boolean("autoApply").notNull().default(false),
  isActive: boolean("isActive").notNull().default(true),
  timesApplied: integer("timesApplied").notNull().default(0),
  lastAppliedAt: timestamp("lastAppliedAt", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  index("bank_reconciliation_rule_company_idx").on(table.companyId, table.isActive),
  check("bank_reconciliation_rule_direction_valid", sql`${table.direction} IN ('ANY', 'IN', 'OUT')`),
  check("bank_reconciliation_rule_target", sql`${table.accountId} IS NOT NULL OR ${table.partnerId} IS NOT NULL`),
]);

/** Cuentas bancarias de clientes/proveedores (IBAN del beneficiario de las remesas SEPA). */
export const partnerBankAccount = pgTable("partner_bank_account", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  partnerId: text("partnerId").notNull().references(() => partner.id, { onDelete: "cascade" }),
  iban: text("iban").notNull(),
  bic: text("bic"),
  isDefault: boolean("isDefault").notNull().default(true),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  unique("partner_bank_account_company_partner_iban_unique").on(table.companyId, table.partnerId, table.iban),
  index("partner_bank_account_partner_idx").on(table.companyId, table.partnerId),
]);

/** Remesa SEPA de transferencias (pain.001.001.03) para pagar varias facturas de proveedor. */
export const sepaRemittance = pgTable("sepa_remittance", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  bankAccountId: text("bankAccountId").notNull().references(() => bankAccount.id, { onDelete: "restrict" }),
  // Identificador del mensaje (MsgId, máx. 35 caracteres).
  number: text("number").notNull(),
  // GENERATED (fichero creado) | CONFIRMED (enviada/cargada: pagos registrados) | CANCELLED.
  status: text("status").notNull().default("GENERATED"),
  executionDate: timestamp("executionDate", { withTimezone: true, mode: "date" }).notNull(),
  totalAmount: numeric("totalAmount", { precision: 12, scale: 2 }).notNull(),
  itemCount: integer("itemCount").notNull(),
  xml: text("xml").notNull(),
  createdByUserId: text("createdByUserId").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmedAt", { withTimezone: true, mode: "date" }),
  cancelledAt: timestamp("cancelledAt", { withTimezone: true, mode: "date" }),
}, (table) => [
  unique("sepa_remittance_company_number_unique").on(table.companyId, table.number),
  index("sepa_remittance_company_status_idx").on(table.companyId, table.status),
  check("sepa_remittance_status_valid", sql`${table.status} IN ('GENERATED', 'CONFIRMED', 'CANCELLED')`),
]);

export const sepaRemittanceItem = pgTable("sepa_remittance_item", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  remittanceId: text("remittanceId").notNull().references(() => sepaRemittance.id, { onDelete: "cascade" }),
  supplierInvoiceId: text("supplierInvoiceId").notNull().references(() => supplierInvoice.id, { onDelete: "restrict" }),
  supplierPartnerId: text("supplierPartnerId").notNull().references(() => partner.id, { onDelete: "restrict" }),
  creditorName: text("creditorName").notNull(),
  creditorIban: text("creditorIban").notNull(),
  creditorBic: text("creditorBic"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  endToEndId: text("endToEndId").notNull(),
  remittanceInformation: text("remittanceInformation").notNull(),
  supplierPaymentId: text("supplierPaymentId").references(() => supplierPayment.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  index("sepa_remittance_item_remittance_idx").on(table.remittanceId),
  index("sepa_remittance_item_invoice_idx").on(table.companyId, table.supplierInvoiceId),
  check("sepa_remittance_item_amount_positive", sql`${table.amount} > 0`),
]);

/**
 * Mandato SEPA de adeudo directo (esquema CORE) firmado por un cliente. La secuencia del
 * siguiente adeudo se deduce de su historial: FRST (primer adeudo de un mandato recurrente),
 * RCUR (siguientes), OOFF (mandato de un solo uso) y FNAL (último adeudo, si se marca).
 */
export const sepaMandate = pgTable("sepa_mandate", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  customerId: text("customerId").notNull().references(() => customer.id, { onDelete: "cascade" }),
  // Referencia única del mandato (MndtId, máx. 35 caracteres).
  mandateReference: text("mandateReference").notNull(),
  signatureDate: timestamp("signatureDate", { withTimezone: true, mode: "date" }).notNull(),
  iban: text("iban").notNull(),
  bic: text("bic"),
  // RECURRENT (varios adeudos) | ONE_OFF (un único adeudo).
  mandateType: text("mandateType").notNull().default("RECURRENT"),
  // ACTIVE | REVOKED (revocado por el cliente, sustituido o ya usado si era de un solo uso).
  status: text("status").notNull().default("ACTIVE"),
  // Adeudos cobrados con este mandato (0 = el siguiente es FRST).
  collectionCount: integer("collectionCount").notNull().default(0),
  firstCollectionAt: timestamp("firstCollectionAt", { withTimezone: true, mode: "date" }),
  lastCollectionAt: timestamp("lastCollectionAt", { withTimezone: true, mode: "date" }),
  revokedAt: timestamp("revokedAt", { withTimezone: true, mode: "date" }),
  notes: text("notes"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  unique("sepa_mandate_company_reference_unique").on(table.companyId, table.mandateReference),
  index("sepa_mandate_company_customer_idx").on(table.companyId, table.customerId, table.status),
  check("sepa_mandate_type_valid", sql`${table.mandateType} IN ('RECURRENT', 'ONE_OFF')`),
  check("sepa_mandate_status_valid", sql`${table.status} IN ('ACTIVE', 'REVOKED')`),
]);

/** Remesa SEPA de adeudos directos (pain.008.001.02, CORE) para cobrar facturas de clientes. */
export const sepaDirectDebitRemittance = pgTable("sepa_direct_debit_remittance", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  // Cuenta de abono (la del acreedor).
  bankAccountId: text("bankAccountId").notNull().references(() => bankAccount.id, { onDelete: "restrict" }),
  number: text("number").notNull(),
  // GENERATED (fichero creado) | COLLECTED (cobrada: cobros registrados) | CANCELLED.
  status: text("status").notNull().default("GENERATED"),
  collectionDate: timestamp("collectionDate", { withTimezone: true, mode: "date" }).notNull(),
  creditorId: text("creditorId").notNull(),
  totalAmount: numeric("totalAmount", { precision: 12, scale: 2 }).notNull(),
  itemCount: integer("itemCount").notNull(),
  xml: text("xml").notNull(),
  createdByUserId: text("createdByUserId").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  collectedAt: timestamp("collectedAt", { withTimezone: true, mode: "date" }),
  cancelledAt: timestamp("cancelledAt", { withTimezone: true, mode: "date" }),
}, (table) => [
  unique("sepa_dd_remittance_company_number_unique").on(table.companyId, table.number),
  index("sepa_dd_remittance_company_status_idx").on(table.companyId, table.status),
  check("sepa_dd_remittance_status_valid", sql`${table.status} IN ('GENERATED', 'COLLECTED', 'CANCELLED')`),
]);

export const sepaDirectDebitItem = pgTable("sepa_direct_debit_item", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  remittanceId: text("remittanceId").notNull().references(() => sepaDirectDebitRemittance.id, { onDelete: "cascade" }),
  invoiceId: text("invoiceId").notNull().references(() => invoice.id, { onDelete: "restrict" }),
  customerId: text("customerId").notNull().references(() => customer.id, { onDelete: "restrict" }),
  mandateId: text("mandateId").notNull().references(() => sepaMandate.id, { onDelete: "restrict" }),
  debtorName: text("debtorName").notNull(),
  debtorIban: text("debtorIban").notNull(),
  debtorBic: text("debtorBic"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  endToEndId: text("endToEndId").notNull(),
  // FRST | RCUR | OOFF | FNAL
  sequenceType: text("sequenceType").notNull(),
  remittanceInformation: text("remittanceInformation").notNull(),
  // PENDING (en el fichero) | COLLECTED (cobro registrado) | RETURNED (devuelto por el banco del cliente).
  status: text("status").notNull().default("PENDING"),
  paymentId: text("paymentId").references(() => payment.id, { onDelete: "set null" }),
  returnedAt: timestamp("returnedAt", { withTimezone: true, mode: "date" }),
  returnReason: text("returnReason"),
  // Cargo del extracto con la devolución (y la comisión, si la hay) y la parte de comisión.
  returnBankTransactionId: text("returnBankTransactionId").references(() => bankTransaction.id, { onDelete: "set null" }),
  returnFeeAmount: numeric("returnFeeAmount", { precision: 12, scale: 2 }),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  index("sepa_dd_item_remittance_idx").on(table.remittanceId),
  index("sepa_dd_item_invoice_idx").on(table.companyId, table.invoiceId),
  index("sepa_dd_item_payment_idx").on(table.paymentId),
  check("sepa_dd_item_amount_positive", sql`${table.amount} > 0`),
  check("sepa_dd_item_sequence_valid", sql`${table.sequenceType} IN ('FRST', 'RCUR', 'OOFF', 'FNAL')`),
  check("sepa_dd_item_status_valid", sql`${table.status} IN ('PENDING', 'COLLECTED', 'RETURNED')`),
]);

/**
 * Conexión PSD2 con un banco a través de GoCardless Bank Account Data (antes Nordigen).
 * Los identificadores del proveedor se guardan cifrados (AES-256-GCM) y nunca llegan al cliente.
 */
export const bankConnection = pgTable("bank_connection", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("GOCARDLESS"),
  institutionId: text("institutionId").notNull(),
  institutionName: text("institutionName").notNull(),
  institutionLogo: text("institutionLogo"),
  requisitionIdEncrypted: text("requisitionIdEncrypted"),
  agreementIdEncrypted: text("agreementIdEncrypted"),
  // PENDING (esperando el consentimiento en el banco) | LINKED | EXPIRED | REVOKED | ERROR
  status: text("status").notNull().default("PENDING"),
  accessValidForDays: integer("accessValidForDays").notNull().default(90),
  historyDays: integer("historyDays").notNull().default(90),
  consentGrantedAt: timestamp("consentGrantedAt", { withTimezone: true, mode: "date" }),
  consentExpiresAt: timestamp("consentExpiresAt", { withTimezone: true, mode: "date" }),
  lastSyncedAt: timestamp("lastSyncedAt", { withTimezone: true, mode: "date" }),
  lastSyncError: text("lastSyncError"),
  createdByUserId: text("createdByUserId").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  index("bank_connection_company_status_idx").on(table.companyId, table.status),
  check("bank_connection_status_valid", sql`${table.status} IN ('PENDING', 'LINKED', 'EXPIRED', 'REVOKED', 'ERROR')`),
]);

/** Cuenta devuelta por el banco en una conexión PSD2 y la cuenta bancaria del ERP a la que se vuelca. */
export const bankConnectionAccount = pgTable("bank_connection_account", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  connectionId: text("connectionId").notNull().references(() => bankConnection.id, { onDelete: "cascade" }),
  externalAccountIdEncrypted: text("externalAccountIdEncrypted").notNull(),
  iban: text("iban"),
  name: text("name"),
  currency: text("currency"),
  bankAccountId: text("bankAccountId").references(() => bankAccount.id, { onDelete: "set null" }),
  lastSyncedAt: timestamp("lastSyncedAt", { withTimezone: true, mode: "date" }),
  lastBookingDate: timestamp("lastBookingDate", { withTimezone: true, mode: "date" }),
  lastSyncError: text("lastSyncError"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  index("bank_connection_account_connection_idx").on(table.connectionId),
  index("bank_connection_account_bank_account_idx").on(table.companyId, table.bankAccountId),
]);

// ─── Envío de facturas por email, recordatorios de cobro y documentos recurrentes ───

/** Cada envío de una factura (o recordatorio de cobro) por email, con su resultado. */
export const invoiceEmailLog = pgTable("invoice_email_log", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  invoiceId: text("invoiceId").notNull().references(() => invoice.id, { onDelete: "cascade" }),
  // INVOICE = envío de la factura; REMINDER = recordatorio de cobro (reminderLevel 1–3).
  kind: text("kind").notNull().default("INVOICE"),
  reminderLevel: integer("reminderLevel"),
  // Destinatarios separados por comas.
  toEmails: text("toEmails").notNull(),
  ccEmails: text("ccEmails"),
  subject: text("subject").notNull(),
  // SENT | FAILED
  status: text("status").notNull(),
  messageId: text("messageId"),
  error: text("error"),
  // MANUAL (desde la aplicación) | AUTOMATIC (worker: recurrencias o recordatorios programados).
  trigger: text("trigger").notNull().default("MANUAL"),
  userId: text("userId").references(() => user.id, { onDelete: "set null" }),
  sentAt: timestamp("sentAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  index("invoice_email_log_company_invoice_idx").on(table.companyId, table.invoiceId, table.sentAt),
  check("invoice_email_log_kind_valid", sql`${table.kind} IN ('INVOICE', 'REMINDER')`),
  check("invoice_email_log_status_valid", sql`${table.status} IN ('SENT', 'FAILED')`),
  check("invoice_email_log_trigger_valid", sql`${table.trigger} IN ('MANUAL', 'AUTOMATIC')`),
  check("invoice_email_log_reminder_level_valid", sql`${table.reminderLevel} IS NULL OR ${table.reminderLevel} BETWEEN 1 AND 3`),
]);

/**
 * Plantillas de email de facturas y recordatorios, y calendario automático de recordatorios.
 * Sin fila (o campo null) = plantillas por defecto de `src/server/invoice-email/templates.ts`.
 */
export const invoiceEmailSetting = pgTable("invoice_email_setting", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }).unique(),
  invoiceSubject: text("invoiceSubject"),
  invoiceBody: text("invoiceBody"),
  reminder1Subject: text("reminder1Subject"),
  reminder1Body: text("reminder1Body"),
  reminder2Subject: text("reminder2Subject"),
  reminder2Body: text("reminder2Body"),
  reminder3Subject: text("reminder3Subject"),
  reminder3Body: text("reminder3Body"),
  // Propone "enviarme una copia" marcado por defecto.
  copyToSelfDefault: boolean("copyToSelfDefault").notNull().default(false),
  // Recordatorios automáticos: el primero N días después del vencimiento, luego cada M días, máximo K.
  dunningEnabled: boolean("dunningEnabled").notNull().default(false),
  dunningFirstDelayDays: integer("dunningFirstDelayDays").notNull().default(3),
  dunningIntervalDays: integer("dunningIntervalDays").notNull().default(7),
  dunningMaxReminders: integer("dunningMaxReminders").notNull().default(3),
  updatedByUserId: text("updatedByUserId").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  check("invoice_email_setting_dunning_first_delay_valid", sql`${table.dunningFirstDelayDays} BETWEEN 0 AND 365`),
  check("invoice_email_setting_dunning_interval_valid", sql`${table.dunningIntervalDays} BETWEEN 1 AND 365`),
  check("invoice_email_setting_dunning_max_valid", sql`${table.dunningMaxReminders} BETWEEN 1 AND 3`),
]);

/** Clientes a los que nunca se envían recordatorios de cobro (ni en bloque ni automáticos). */
export const dunningCustomerOptOut = pgTable("dunning_customer_opt_out", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  customerId: text("customerId").notNull().references(() => customer.id, { onDelete: "cascade" }),
  createdByUserId: text("createdByUserId").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [unique("dunning_customer_opt_out_company_customer_unique").on(table.companyId, table.customerId)]);

/** Impuesto congelado de una línea de plantilla recurrente (misma forma que `invoice_line_tax`). */
export type RecurringTemplateLineTax = {
  taxId: string | null;
  name: string;
  rate: number;
  kind: string;
  operation: "ADD" | "SUBTRACT";
};

/** Línea de una plantilla recurrente. Las descripciones admiten variables ({mes}, {trimestre}…). */
export type RecurringTemplateLine = {
  itemId?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPct?: number;
  taxRate: number;
  retentionRate: number;
  /**
   * Solo facturas: impuestos exactos de la línea (IVA, recargo de equivalencia, retenciones u otros),
   * copiados de la factura de origen. Si faltan, se derivan de `taxRate` y `retentionRate`.
   */
  taxes?: RecurringTemplateLineTax[] | null;
  /** Solo gastos: cuenta de gasto y % de IVA deducible. */
  expenseAccountId?: string | null;
  taxDeductiblePct?: number;
};

/** Plantilla de documento recurrente: factura de venta o gasto (factura de proveedor). */
export const recurringTemplate = pgTable("recurring_template", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  // SALES_INVOICE | EXPENSE
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  // ACTIVE | PAUSED | FINISHED
  status: text("status").notNull().default("ACTIVE"),
  customerId: text("customerId").references(() => customer.id, { onDelete: "restrict" }),
  supplierPartnerId: text("supplierPartnerId").references(() => partner.id, { onDelete: "restrict" }),
  // MONTHLY | QUARTERLY | YEARLY | EVERY_N_MONTHS (intervalMonths guarda los meses efectivos).
  frequency: text("frequency").notNull(),
  intervalMonths: integer("intervalMonths").notNull().default(1),
  // Fechas de calendario (YYYY-MM-DD, zona de la empresa). dayOfMonth 29–31 se ajusta al último día del mes.
  startDate: text("startDate").notNull(),
  endDate: text("endDate"),
  dayOfMonth: integer("dayOfMonth").notNull(),
  maxOccurrences: integer("maxOccurrences"),
  // Facturas: DRAFT | ISSUE | ISSUE_AND_EMAIL. Gastos: DRAFT (pendiente de revisar) | POST (registrar).
  issueMode: text("issueMode").notNull().default("DRAFT"),
  lines: jsonb("lines").$type<RecurringTemplateLine[]>().notNull(),
  notes: text("notes"),
  vatTreatment: text("vatTreatment"),
  // Facturas: serie de numeración (null = la serie por defecto). Se resuelve por código en cada ejercicio.
  seriesId: text("seriesId").references(() => documentSeries.id, { onDelete: "set null" }),
  sourceInvoiceId: text("sourceInvoiceId").references(() => invoice.id, { onDelete: "set null" }),
  // Próxima fecha a generar (null = terminada). occurrencesGenerated cuenta los periodos ya generados.
  nextRunDate: text("nextRunDate"),
  occurrencesGenerated: integer("occurrencesGenerated").notNull().default(0),
  lastRunAt: timestamp("lastRunAt", { withTimezone: true, mode: "date" }),
  lastError: text("lastError"),
  // Usuario en cuyo nombre actúa el worker (auditoría, series y contabilidad).
  createdByUserId: text("createdByUserId").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  index("recurring_template_company_kind_idx").on(table.companyId, table.kind),
  index("recurring_template_due_idx").on(table.status, table.nextRunDate),
  check("recurring_template_kind_valid", sql`${table.kind} IN ('SALES_INVOICE', 'EXPENSE')`),
  check("recurring_template_status_valid", sql`${table.status} IN ('ACTIVE', 'PAUSED', 'FINISHED')`),
  check("recurring_template_frequency_valid", sql`${table.frequency} IN ('MONTHLY', 'QUARTERLY', 'YEARLY', 'EVERY_N_MONTHS')`),
  check("recurring_template_interval_valid", sql`${table.intervalMonths} BETWEEN 1 AND 60`),
  check("recurring_template_day_valid", sql`${table.dayOfMonth} BETWEEN 1 AND 31`),
  check("recurring_template_issue_mode_valid", sql`${table.issueMode} IN ('DRAFT', 'ISSUE', 'ISSUE_AND_EMAIL', 'POST')`),
  check("recurring_template_party_valid", sql`(${table.kind} = 'SALES_INVOICE' AND ${table.customerId} IS NOT NULL) OR (${table.kind} = 'EXPENSE' AND ${table.supplierPartnerId} IS NOT NULL)`),
]);

/** Cada periodo generado por una plantilla. Único por plantilla + periodo: el worker es idempotente. */
export const recurringRun = pgTable("recurring_run", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  templateId: text("templateId").notNull().references(() => recurringTemplate.id, { onDelete: "cascade" }),
  // Fecha programada del periodo (YYYY-MM-DD); es también la clave de idempotencia.
  periodDate: text("periodDate").notNull(),
  // GENERATED | PENDING_REVIEW (gasto a confirmar) | DISCARDED
  status: text("status").notNull(),
  invoiceId: text("invoiceId").references(() => invoice.id, { onDelete: "set null" }),
  supplierInvoiceId: text("supplierInvoiceId").references(() => supplierInvoice.id, { onDelete: "set null" }),
  // Gastos pendientes de revisar: líneas ya renderizadas para registrarlas al confirmar.
  payload: jsonb("payload").$type<{ lines: RecurringTemplateLine[]; notes: string | null }>(),
  // Aviso no bloqueante (p. ej. "no se pudo emitir: queda en borrador" o fallo del email).
  message: text("message"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  unique("recurring_run_template_period_unique").on(table.templateId, table.periodDate),
  index("recurring_run_company_status_idx").on(table.companyId, table.status),
  check("recurring_run_status_valid", sql`${table.status} IN ('GENERATED', 'PENDING_REVIEW', 'DISCARDED')`),
]);
