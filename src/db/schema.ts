import { boolean, index, integer, numeric, pgEnum, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

export const membershipRoleEnum = pgEnum("membership_role", ["OWNER", "ADMIN", "MEMBER"]);
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
export const accountTypeEnum = pgEnum("account_type", ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]);
export const fiscalReportStatusEnum = pgEnum("fiscal_report_status", ["DRAFT", "READY", "FILED"]);
export const paymentMethodTypeEnum = pgEnum("payment_method_type", ["BANK_TRANSFER", "CARD", "CASH", "DIRECT_DEBIT"]);
export const salesDocumentStatusEnum = pgEnum("sales_document_status", ["DRAFT", "SENT", "CONFIRMED", "DELIVERED", "INVOICED", "PAID", "VOID"]);

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
  countryCode: text("countryCode").notNull().default("ES"),
  timezone: text("timezone").notNull().default("Europe/Madrid"),
  baseCurrencyCode: text("baseCurrencyCode").notNull().default("EUR"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const fiscalYear = pgTable("fiscal_year", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  startsAt: timestamp("startsAt", { withTimezone: true, mode: "date" }).notNull(),
  endsAt: timestamp("endsAt", { withTimezone: true, mode: "date" }).notNull(),
  isClosed: boolean("isClosed").notNull().default(false),
});

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
});

export const documentSeries = pgTable("document_series", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  fiscalYearId: text("fiscalYearId").notNull().references(() => fiscalYear.id, { onDelete: "cascade" }),
  type: documentTypeEnum("type").notNull(),
  prefix: text("prefix").notNull(),
  nextNumber: integer("nextNumber").notNull().default(1),
});

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
});

export const unitOfMeasure = pgTable("unit_of_measure", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const paymentMethod = pgTable("payment_method", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  type: paymentMethodTypeEnum("type").notNull().default("BANK_TRANSFER"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

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
  prorrataPct: numeric("prorrataPct", { precision: 6, scale: 3 }).notNull().default("100"),
  defaultCustomerAccountCode: text("defaultCustomerAccountCode").notNull().default("430000"),
  defaultSupplierAccountCode: text("defaultSupplierAccountCode").notNull().default("410000"),
  defaultSalesAccountCode: text("defaultSalesAccountCode").notNull().default("700000"),
  defaultPurchaseAccountCode: text("defaultPurchaseAccountCode").notNull().default("600000"),
  defaultBankAccountCode: text("defaultBankAccountCode").notNull().default("572000"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const partner = pgTable("partner", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  type: partnerTypeEnum("type").notNull().default("CUSTOMER"),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  taxId: text("taxId"),
  address: text("address"),
  addressLine2: text("addressLine2"),
  city: text("city"),
  province: text("province"),
  postalCode: text("postalCode"),
  countryCode: text("countryCode").notNull().default("ES"),
  paymentTermsDays: integer("paymentTermsDays"),
  paymentMethodId: text("paymentMethodId").references(() => paymentMethod.id, { onDelete: "set null" }),
  defaultAccountId: text("defaultAccountId").references(() => accountChart.id, { onDelete: "set null" }),
  currencyCode: text("currencyCode").notNull().default("EUR"),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
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
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

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
});

export const warehouse = pgTable("warehouse", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
});

export const stockMovement = pgTable("stock_movement", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  itemId: text("itemId").notNull().references(() => item.id, { onDelete: "cascade" }),
  warehouseId: text("warehouseId").notNull().references(() => warehouse.id, { onDelete: "cascade" }),
  movementType: stockMovementTypeEnum("movementType").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
  movedAt: timestamp("movedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  reason: text("reason").notNull().default("Ajuste operativo"),
  reference: text("reference"),
});

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
    number: text("number").notNull(),
    issueDate: timestamp("issueDate", { withTimezone: true, mode: "date" }).notNull(),
    dueDate: timestamp("dueDate", { withTimezone: true, mode: "date" }),
    totalAmount: numeric("totalAmount", { precision: 12, scale: 2 }).notNull(),
    status: invoiceStatusEnum("status").notNull().default("DRAFT"),
    paymentStatus: paymentStatusEnum("paymentStatus").notNull().default("PENDING"),
    notes: text("notes"),
    createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [unique("invoice_company_number_unique").on(table.companyId, table.number), index("invoice_company_customer_idx").on(table.companyId, table.customerId)],
);

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
});

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
});

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
});

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
  number: text("number").notNull(),
  issuedAt: timestamp("issuedAt", { withTimezone: true, mode: "date" }).notNull(),
  status: salesDocumentStatusEnum("status").notNull().default("DRAFT"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const deliveryNoteLine = pgTable("delivery_note_line", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  deliveryNoteId: text("deliveryNoteId").notNull().references(() => deliveryNote.id, { onDelete: "cascade" }),
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
});

export const purchaseOrder = pgTable("purchase_order", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  supplierPartnerId: text("supplierPartnerId").notNull().references(() => partner.id, { onDelete: "restrict" }),
  number: text("number").notNull(),
  status: text("status").notNull().default("DRAFT"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

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
  purchaseOrderId: text("purchaseOrderId").notNull().references(() => purchaseOrder.id, { onDelete: "cascade" }),
  receivedAt: timestamp("receivedAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const goodsReceiptLine = pgTable("goods_receipt_line", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  goodsReceiptId: text("goodsReceiptId").notNull().references(() => goodsReceipt.id, { onDelete: "cascade" }),
  itemId: text("itemId").references(() => item.id, { onDelete: "set null" }),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
});

export const supplierInvoice = pgTable("supplier_invoice", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  supplierPartnerId: text("supplierPartnerId").notNull().references(() => partner.id, { onDelete: "restrict" }),
  purchaseOrderId: text("purchaseOrderId").references(() => purchaseOrder.id, { onDelete: "set null" }),
  goodsReceiptId: text("goodsReceiptId").references(() => goodsReceipt.id, { onDelete: "set null" }),
  number: text("number").notNull(),
  issueDate: timestamp("issueDate", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  totalAmount: numeric("totalAmount", { precision: 12, scale: 2 }).notNull(),
});

export const supplierInvoiceLine = pgTable("supplier_invoice_line", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  supplierInvoiceId: text("supplierInvoiceId").notNull().references(() => supplierInvoice.id, { onDelete: "cascade" }),
  itemId: text("itemId").references(() => item.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
  unitPrice: numeric("unitPrice", { precision: 12, scale: 2 }).notNull(),
  taxRate: numeric("taxRate", { precision: 6, scale: 3 }).notNull().default("21"),
  lineTotal: numeric("lineTotal", { precision: 12, scale: 2 }).notNull(),
});

export const journal = pgTable("journal", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
});

export const accountChart = pgTable("account_chart", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  type: accountTypeEnum("type").notNull(),
});

export const journalEntry = pgTable("journal_entry", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  journalId: text("journalId").notNull().references(() => journal.id, { onDelete: "restrict" }),
  postedAt: timestamp("postedAt", { withTimezone: true, mode: "date" }).notNull(),
  reference: text("reference"),
});

export const journalLine = pgTable("journal_line", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  journalEntryId: text("journalEntryId").notNull().references(() => journalEntry.id, { onDelete: "cascade" }),
  accountId: text("accountId").notNull().references(() => accountChart.id, { onDelete: "restrict" }),
  debit: numeric("debit", { precision: 12, scale: 2 }).notNull().default("0"),
  credit: numeric("credit", { precision: 12, scale: 2 }).notNull().default("0"),
});

export const bankAccount = pgTable("bank_account", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  iban: text("iban").notNull(),
  bankName: text("bankName").notNull(),
});

export const bankTransaction = pgTable("bank_transaction", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  bankAccountId: text("bankAccountId").notNull().references(() => bankAccount.id, { onDelete: "cascade" }),
  postedAt: timestamp("postedAt", { withTimezone: true, mode: "date" }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  description: text("description").notNull(),
  reconciliationStatus: reconciliationStatusEnum("reconciliationStatus").notNull().default("PENDING"),
  matchedInvoicePaymentId: text("matchedInvoicePaymentId").references(() => invoicePayment.id, { onDelete: "set null" }),
  matchedSupplierPaymentId: text("matchedSupplierPaymentId").references(() => supplierInvoicePayment.id, { onDelete: "set null" }),
  reconciledAt: timestamp("reconciledAt", { withTimezone: true, mode: "date" }),
});

export const tax = pgTable("tax", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  rate: numeric("rate", { precision: 6, scale: 3 }).notNull(),
});

export const fiscalReport = pgTable(
  "fiscal_report",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    period: text("period").notNull(),
    status: fiscalReportStatusEnum("status").notNull().default("DRAFT"),
    filedAt: timestamp("filedAt", { withTimezone: true, mode: "date" }),
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
    stripeSubscriptionId: text("stripeSubscriptionId"),
    cancelAtPeriodEnd: boolean("cancelAtPeriodEnd").notNull().default(false),
  },
  (table) => [unique("subscription_tenant_unique").on(table.tenantId)],
);

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
  keyHash: text("keyHash").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenantId").notNull().references(() => tenant.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: membershipRoleEnum("role").notNull().default("MEMBER"),
  token: text("token").notNull().unique(),
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
  invoiceId: text("invoiceId").notNull().references(() => invoice.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  postedAt: timestamp("postedAt", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const supplierPayment = pgTable("supplier_payment", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  supplierInvoiceId: text("supplierInvoiceId").notNull().references(() => supplierInvoice.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  postedAt: timestamp("postedAt", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const supplierInvoicePayment = pgTable("supplier_invoice_payment", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("companyId").notNull().references(() => company.id, { onDelete: "cascade" }),
  supplierInvoiceId: text("supplierInvoiceId").notNull().references(() => supplierInvoice.id, { onDelete: "cascade" }),
  supplierPaymentId: text("supplierPaymentId").notNull().references(() => supplierPayment.id, { onDelete: "cascade" }),
  amountApplied: numeric("amountApplied", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
