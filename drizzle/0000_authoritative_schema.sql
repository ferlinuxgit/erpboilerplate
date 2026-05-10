CREATE TYPE "public"."account_type" AS ENUM('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');--> statement-breakpoint
CREATE TYPE "public"."customer_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('SALES_QUOTE', 'SALES_ORDER', 'DELIVERY_NOTE', 'SALES_INVOICE', 'CREDIT_NOTE', 'PURCHASE_ORDER', 'GOODS_RECEIPT', 'SUPPLIER_INVOICE', 'SUPPLIER_CREDIT_NOTE', 'PAYMENT', 'RECEIPT');--> statement-breakpoint
CREATE TYPE "public"."fiscal_report_status" AS ENUM('DRAFT', 'READY', 'FILED');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('DRAFT', 'SENT', 'PAID', 'OVERDUE', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('OWNER', 'ADMIN', 'MEMBER');--> statement-breakpoint
CREATE TYPE "public"."partner_type" AS ENUM('CUSTOMER', 'SUPPLIER', 'BOTH');--> statement-breakpoint
CREATE TYPE "public"."payment_method_type" AS ENUM('BANK_TRANSFER', 'CARD', 'CASH', 'DIRECT_DEBIT');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_status" AS ENUM('PENDING', 'RECONCILED');--> statement-breakpoint
CREATE TYPE "public"."sales_document_status" AS ENUM('DRAFT', 'SENT', 'CONFIRMED', 'DELIVERED', 'INVOICED', 'PAID', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_type" AS ENUM('IN', 'OUT', 'ADJUSTMENT', 'TRANSFER');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_provider_id_account_id_unique" UNIQUE("providerId","accountId")
);
--> statement-breakpoint
CREATE TABLE "account_chart" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "account_type" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_key" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text NOT NULL,
	"keyHash" text NOT NULL,
	"name" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text NOT NULL,
	"companyId" text,
	"actorUserId" text,
	"action" text NOT NULL,
	"entityName" text NOT NULL,
	"entityId" text NOT NULL,
	"payload" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_account" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"iban" text NOT NULL,
	"bankName" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"bankAccountId" text NOT NULL,
	"postedAt" timestamp with time zone NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"description" text NOT NULL,
	"reconciliationStatus" "reconciliation_status" DEFAULT 'PENDING' NOT NULL,
	"matchedInvoicePaymentId" text,
	"matchedSupplierPaymentId" text,
	"reconciledAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "company" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text NOT NULL,
	"name" text NOT NULL,
	"legalName" text,
	"vatNumber" text,
	"countryCode" text DEFAULT 'ES' NOT NULL,
	"timezone" text DEFAULT 'Europe/Madrid' NOT NULL,
	"baseCurrencyCode" text DEFAULT 'EUR' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"logoUrl" text,
	"paymentTermsDays" integer DEFAULT 30 NOT NULL,
	"defaultCustomerAccountCode" text DEFAULT '430000' NOT NULL,
	"defaultSupplierAccountCode" text DEFAULT '410000' NOT NULL,
	"defaultSalesAccountCode" text DEFAULT '700000' NOT NULL,
	"defaultPurchaseAccountCode" text DEFAULT '600000' NOT NULL,
	"defaultBankAccountCode" text DEFAULT '572000' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_settings_companyId_unique" UNIQUE("companyId")
);
--> statement-breakpoint
CREATE TABLE "country" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "currency" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"decimals" integer DEFAULT 2 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"partnerId" text,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"status" "customer_status" DEFAULT 'ACTIVE' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_note" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"customerId" text NOT NULL,
	"salesOrderId" text,
	"number" text NOT NULL,
	"issuedAt" timestamp with time zone NOT NULL,
	"status" "sales_document_status" DEFAULT 'DRAFT' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_note_line" (
	"id" text PRIMARY KEY NOT NULL,
	"deliveryNoteId" text NOT NULL,
	"itemId" text,
	"description" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"documentType" "document_type" NOT NULL,
	"documentId" text NOT NULL,
	"fileUrl" text NOT NULL,
	"fileName" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_series" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"fiscalYearId" text NOT NULL,
	"type" "document_type" NOT NULL,
	"prefix" text NOT NULL,
	"nextNumber" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_rate" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"fromCurrencyCode" text NOT NULL,
	"toCurrencyCode" text NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	"rateDate" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiscal_report" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"code" text NOT NULL,
	"period" text NOT NULL,
	"status" "fiscal_report_status" DEFAULT 'DRAFT' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiscal_year" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"code" text NOT NULL,
	"startsAt" timestamp with time zone NOT NULL,
	"endsAt" timestamp with time zone NOT NULL,
	"isClosed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goods_receipt" (
	"id" text PRIMARY KEY NOT NULL,
	"purchaseOrderId" text NOT NULL,
	"receivedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goods_receipt_line" (
	"id" text PRIMARY KEY NOT NULL,
	"goodsReceiptId" text NOT NULL,
	"itemId" text,
	"quantity" numeric(12, 3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text NOT NULL,
	"email" text NOT NULL,
	"role" "membership_role" DEFAULT 'MEMBER' NOT NULL,
	"token" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"acceptedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"customerId" text NOT NULL,
	"number" text NOT NULL,
	"issueDate" timestamp with time zone NOT NULL,
	"dueDate" timestamp with time zone,
	"totalAmount" numeric(12, 2) NOT NULL,
	"status" "invoice_status" DEFAULT 'DRAFT' NOT NULL,
	"paymentStatus" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"notes" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_company_number_unique" UNIQUE("companyId","number")
);
--> statement-breakpoint
CREATE TABLE "invoice_line" (
	"id" text PRIMARY KEY NOT NULL,
	"invoiceId" text NOT NULL,
	"itemId" text,
	"description" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unitPrice" numeric(12, 2) NOT NULL,
	"taxRate" numeric(6, 3) DEFAULT '0' NOT NULL,
	"lineTotal" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_payment" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"invoiceId" text NOT NULL,
	"paymentId" text NOT NULL,
	"amountApplied" numeric(12, 2) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"categoryId" text,
	"unitOfMeasureId" text,
	"defaultTaxId" text,
	"defaultRetentionId" text,
	"salesAccountId" text,
	"purchaseAccountId" text,
	"isService" boolean DEFAULT false NOT NULL,
	"salePrice" numeric(12, 2) DEFAULT '0' NOT NULL,
	"costPrice" numeric(12, 2) DEFAULT '0' NOT NULL,
	"averageCost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"minimumStock" numeric(12, 3) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_category" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_cost_history" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"itemId" text NOT NULL,
	"unitCost" numeric(12, 2) NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"movementId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"journalId" text NOT NULL,
	"postedAt" timestamp with time zone NOT NULL,
	"reference" text
);
--> statement-breakpoint
CREATE TABLE "journal_line" (
	"id" text PRIMARY KEY NOT NULL,
	"journalEntryId" text NOT NULL,
	"accountId" text NOT NULL,
	"debit" numeric(12, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(12, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"metricKey" text NOT NULL,
	"metricValue" numeric(18, 4) NOT NULL,
	"capturedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"tenantId" text NOT NULL,
	"role" "membership_role" DEFAULT 'MEMBER' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_user_tenant_unique" UNIQUE("userId","tenantId")
);
--> statement-breakpoint
CREATE TABLE "partner" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"type" "partner_type" DEFAULT 'CUSTOMER' NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"taxId" text,
	"address" text,
	"city" text,
	"postalCode" text,
	"countryCode" text DEFAULT 'ES' NOT NULL,
	"paymentTermsDays" integer,
	"paymentMethodId" text,
	"defaultAccountId" text,
	"currencyCode" text DEFAULT 'EUR' NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"invoiceId" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"postedAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_method" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "payment_method_type" DEFAULT 'BANK_TRANSFER' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permission" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "permission_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "plan" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"stripePriceId" text,
	"limits" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "purchase_order" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"supplierPartnerId" text NOT NULL,
	"number" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_line" (
	"id" text PRIMARY KEY NOT NULL,
	"purchaseOrderId" text NOT NULL,
	"itemId" text,
	"description" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unitPrice" numeric(12, 2) NOT NULL,
	"lineTotal" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permission" (
	"id" text PRIMARY KEY NOT NULL,
	"role" "membership_role" NOT NULL,
	"permissionKey" text NOT NULL,
	CONSTRAINT "role_permission_unique" UNIQUE("role","permissionKey")
);
--> statement-breakpoint
CREATE TABLE "sales_order" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"customerId" text NOT NULL,
	"salesQuoteId" text,
	"number" text NOT NULL,
	"issueDate" timestamp with time zone NOT NULL,
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"taxAmount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"retentionAmount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"totalAmount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" "sales_document_status" DEFAULT 'DRAFT' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_order_line" (
	"id" text PRIMARY KEY NOT NULL,
	"salesOrderId" text NOT NULL,
	"itemId" text,
	"description" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unitPrice" numeric(12, 2) NOT NULL,
	"discountPct" numeric(6, 3) DEFAULT '0' NOT NULL,
	"taxRate" numeric(6, 3) DEFAULT '0' NOT NULL,
	"retentionRate" numeric(6, 3) DEFAULT '0' NOT NULL,
	"lineTotal" numeric(12, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_quote" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"customerId" text NOT NULL,
	"number" text NOT NULL,
	"issueDate" timestamp with time zone NOT NULL,
	"validUntil" timestamp with time zone,
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"taxAmount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"retentionAmount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"totalAmount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" "sales_document_status" DEFAULT 'DRAFT' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_quote_line" (
	"id" text PRIMARY KEY NOT NULL,
	"salesQuoteId" text NOT NULL,
	"itemId" text,
	"description" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unitPrice" numeric(12, 2) NOT NULL,
	"discountPct" numeric(6, 3) DEFAULT '0' NOT NULL,
	"taxRate" numeric(6, 3) DEFAULT '0' NOT NULL,
	"retentionRate" numeric(6, 3) DEFAULT '0' NOT NULL,
	"lineTotal" numeric(12, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "stock_location" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"itemId" text NOT NULL,
	"warehouseId" text NOT NULL,
	"currentQuantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"averageCost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_location_unique" UNIQUE("companyId","itemId","warehouseId")
);
--> statement-breakpoint
CREATE TABLE "stock_movement" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"itemId" text NOT NULL,
	"warehouseId" text NOT NULL,
	"movementType" "stock_movement_type" NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"movedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text DEFAULT 'Ajuste operativo' NOT NULL,
	"reference" text
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text NOT NULL,
	"plan" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"currentPeriodEndsAt" timestamp with time zone,
	"stripeCustomerId" text,
	"stripeSubscriptionId" text,
	"cancelAtPeriodEnd" boolean DEFAULT false NOT NULL,
	CONSTRAINT "subscription_tenant_unique" UNIQUE("tenantId")
);
--> statement-breakpoint
CREATE TABLE "supplier_invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"supplierPartnerId" text NOT NULL,
	"purchaseOrderId" text,
	"goodsReceiptId" text,
	"number" text NOT NULL,
	"totalAmount" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_invoice_line" (
	"id" text PRIMARY KEY NOT NULL,
	"supplierInvoiceId" text NOT NULL,
	"itemId" text,
	"description" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unitPrice" numeric(12, 2) NOT NULL,
	"lineTotal" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_invoice_payment" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"supplierInvoiceId" text NOT NULL,
	"supplierPaymentId" text NOT NULL,
	"amountApplied" numeric(12, 2) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_payment" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"supplierInvoiceId" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"postedAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"name" text NOT NULL,
	"rate" numeric(6, 3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_retention" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"name" text NOT NULL,
	"rate" numeric(6, 3) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"ownerId" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "tenant_security_policy" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text NOT NULL,
	"sessionTimeoutMinutes" integer,
	"requireTwoFactor" boolean,
	"apiKeyRotationDays" integer,
	"allowedDomains" text,
	"allowedIpNotes" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_security_policy_tenant_unique" UNIQUE("tenantId")
);
--> statement-breakpoint
CREATE TABLE "unit_of_measure" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_identifier_value_unique" UNIQUE("identifier","value")
);
--> statement-breakpoint
CREATE TABLE "warehouse" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_chart" ADD CONSTRAINT "account_chart_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_tenantId_tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_bankAccountId_bank_account_id_fk" FOREIGN KEY ("bankAccountId") REFERENCES "public"."bank_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_matchedInvoicePaymentId_invoice_payment_id_fk" FOREIGN KEY ("matchedInvoicePaymentId") REFERENCES "public"."invoice_payment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_matchedSupplierPaymentId_supplier_invoice_payment_id_fk" FOREIGN KEY ("matchedSupplierPaymentId") REFERENCES "public"."supplier_invoice_payment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_tenantId_tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_partnerId_partner_id_fk" FOREIGN KEY ("partnerId") REFERENCES "public"."partner"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_note" ADD CONSTRAINT "delivery_note_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_note" ADD CONSTRAINT "delivery_note_customerId_customer_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_note" ADD CONSTRAINT "delivery_note_salesOrderId_sales_order_id_fk" FOREIGN KEY ("salesOrderId") REFERENCES "public"."sales_order"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_note_line" ADD CONSTRAINT "delivery_note_line_deliveryNoteId_delivery_note_id_fk" FOREIGN KEY ("deliveryNoteId") REFERENCES "public"."delivery_note"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_note_line" ADD CONSTRAINT "delivery_note_line_itemId_item_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_attachment" ADD CONSTRAINT "document_attachment_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_series" ADD CONSTRAINT "document_series_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_series" ADD CONSTRAINT "document_series_fiscalYearId_fiscal_year_id_fk" FOREIGN KEY ("fiscalYearId") REFERENCES "public"."fiscal_year"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rate" ADD CONSTRAINT "exchange_rate_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_report" ADD CONSTRAINT "fiscal_report_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_year" ADD CONSTRAINT "fiscal_year_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_purchaseOrderId_purchase_order_id_fk" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."purchase_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_goodsReceiptId_goods_receipt_id_fk" FOREIGN KEY ("goodsReceiptId") REFERENCES "public"."goods_receipt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_itemId_item_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_tenantId_tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_customerId_customer_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_invoiceId_invoice_id_fk" FOREIGN KEY ("invoiceId") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_itemId_item_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payment" ADD CONSTRAINT "invoice_payment_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payment" ADD CONSTRAINT "invoice_payment_invoiceId_invoice_id_fk" FOREIGN KEY ("invoiceId") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payment" ADD CONSTRAINT "invoice_payment_paymentId_payment_id_fk" FOREIGN KEY ("paymentId") REFERENCES "public"."payment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_categoryId_item_category_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."item_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_unitOfMeasureId_unit_of_measure_id_fk" FOREIGN KEY ("unitOfMeasureId") REFERENCES "public"."unit_of_measure"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_defaultTaxId_tax_id_fk" FOREIGN KEY ("defaultTaxId") REFERENCES "public"."tax"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_defaultRetentionId_tax_retention_id_fk" FOREIGN KEY ("defaultRetentionId") REFERENCES "public"."tax_retention"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_salesAccountId_account_chart_id_fk" FOREIGN KEY ("salesAccountId") REFERENCES "public"."account_chart"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_purchaseAccountId_account_chart_id_fk" FOREIGN KEY ("purchaseAccountId") REFERENCES "public"."account_chart"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_category" ADD CONSTRAINT "item_category_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_cost_history" ADD CONSTRAINT "item_cost_history_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_cost_history" ADD CONSTRAINT "item_cost_history_itemId_item_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_cost_history" ADD CONSTRAINT "item_cost_history_movementId_stock_movement_id_fk" FOREIGN KEY ("movementId") REFERENCES "public"."stock_movement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal" ADD CONSTRAINT "journal_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_journalId_journal_id_fk" FOREIGN KEY ("journalId") REFERENCES "public"."journal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_journalEntryId_journal_entry_id_fk" FOREIGN KEY ("journalEntryId") REFERENCES "public"."journal_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_accountId_account_chart_id_fk" FOREIGN KEY ("accountId") REFERENCES "public"."account_chart"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_snapshot" ADD CONSTRAINT "kpi_snapshot_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_tenantId_tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner" ADD CONSTRAINT "partner_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner" ADD CONSTRAINT "partner_paymentMethodId_payment_method_id_fk" FOREIGN KEY ("paymentMethodId") REFERENCES "public"."payment_method"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner" ADD CONSTRAINT "partner_defaultAccountId_account_chart_id_fk" FOREIGN KEY ("defaultAccountId") REFERENCES "public"."account_chart"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_invoiceId_invoice_id_fk" FOREIGN KEY ("invoiceId") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_method" ADD CONSTRAINT "payment_method_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_supplierPartnerId_partner_id_fk" FOREIGN KEY ("supplierPartnerId") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_purchaseOrderId_purchase_order_id_fk" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."purchase_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_itemId_item_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_customerId_customer_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_salesQuoteId_sales_quote_id_fk" FOREIGN KEY ("salesQuoteId") REFERENCES "public"."sales_quote"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_line" ADD CONSTRAINT "sales_order_line_salesOrderId_sales_order_id_fk" FOREIGN KEY ("salesOrderId") REFERENCES "public"."sales_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_line" ADD CONSTRAINT "sales_order_line_itemId_item_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quote" ADD CONSTRAINT "sales_quote_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quote" ADD CONSTRAINT "sales_quote_customerId_customer_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quote_line" ADD CONSTRAINT "sales_quote_line_salesQuoteId_sales_quote_id_fk" FOREIGN KEY ("salesQuoteId") REFERENCES "public"."sales_quote"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quote_line" ADD CONSTRAINT "sales_quote_line_itemId_item_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_location" ADD CONSTRAINT "stock_location_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_location" ADD CONSTRAINT "stock_location_itemId_item_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_location" ADD CONSTRAINT "stock_location_warehouseId_warehouse_id_fk" FOREIGN KEY ("warehouseId") REFERENCES "public"."warehouse"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_itemId_item_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_warehouseId_warehouse_id_fk" FOREIGN KEY ("warehouseId") REFERENCES "public"."warehouse"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_tenantId_tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_supplierPartnerId_partner_id_fk" FOREIGN KEY ("supplierPartnerId") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_purchaseOrderId_purchase_order_id_fk" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."purchase_order"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_goodsReceiptId_goods_receipt_id_fk" FOREIGN KEY ("goodsReceiptId") REFERENCES "public"."goods_receipt"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_line" ADD CONSTRAINT "supplier_invoice_line_supplierInvoiceId_supplier_invoice_id_fk" FOREIGN KEY ("supplierInvoiceId") REFERENCES "public"."supplier_invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_line" ADD CONSTRAINT "supplier_invoice_line_itemId_item_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_payment" ADD CONSTRAINT "supplier_invoice_payment_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_payment" ADD CONSTRAINT "supplier_invoice_payment_supplierInvoiceId_supplier_invoice_id_fk" FOREIGN KEY ("supplierInvoiceId") REFERENCES "public"."supplier_invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_payment" ADD CONSTRAINT "supplier_invoice_payment_supplierPaymentId_supplier_payment_id_fk" FOREIGN KEY ("supplierPaymentId") REFERENCES "public"."supplier_payment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_supplierInvoiceId_supplier_invoice_id_fk" FOREIGN KEY ("supplierInvoiceId") REFERENCES "public"."supplier_invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax" ADD CONSTRAINT "tax_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_retention" ADD CONSTRAINT "tax_retention_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_ownerId_user_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_security_policy" ADD CONSTRAINT "tenant_security_policy_tenantId_tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_of_measure" ADD CONSTRAINT "unit_of_measure_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exchange_rate_company_date_idx" ON "exchange_rate" USING btree ("companyId","rateDate");--> statement-breakpoint
CREATE INDEX "invoice_company_customer_idx" ON "invoice" USING btree ("companyId","customerId");--> statement-breakpoint
CREATE INDEX "membership_tenant_idx" ON "membership" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "tenant_security_policy_tenant_idx" ON "tenant_security_policy" USING btree ("tenantId");