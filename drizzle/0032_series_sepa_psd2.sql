CREATE TABLE "bank_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"provider" text DEFAULT 'GOCARDLESS' NOT NULL,
	"institutionId" text NOT NULL,
	"institutionName" text NOT NULL,
	"institutionLogo" text,
	"requisitionIdEncrypted" text,
	"agreementIdEncrypted" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"accessValidForDays" integer DEFAULT 90 NOT NULL,
	"historyDays" integer DEFAULT 90 NOT NULL,
	"consentGrantedAt" timestamp with time zone,
	"consentExpiresAt" timestamp with time zone,
	"lastSyncedAt" timestamp with time zone,
	"lastSyncError" text,
	"createdByUserId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_connection_status_valid" CHECK ("bank_connection"."status" IN ('PENDING', 'LINKED', 'EXPIRED', 'REVOKED', 'ERROR'))
);
--> statement-breakpoint
CREATE TABLE "bank_connection_account" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"connectionId" text NOT NULL,
	"externalAccountIdEncrypted" text NOT NULL,
	"iban" text,
	"name" text,
	"currency" text,
	"bankAccountId" text,
	"lastSyncedAt" timestamp with time zone,
	"lastBookingDate" timestamp with time zone,
	"lastSyncError" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sepa_direct_debit_item" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"remittanceId" text NOT NULL,
	"invoiceId" text NOT NULL,
	"customerId" text NOT NULL,
	"mandateId" text NOT NULL,
	"debtorName" text NOT NULL,
	"debtorIban" text NOT NULL,
	"debtorBic" text,
	"amount" numeric(12, 2) NOT NULL,
	"endToEndId" text NOT NULL,
	"sequenceType" text NOT NULL,
	"remittanceInformation" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"paymentId" text,
	"returnedAt" timestamp with time zone,
	"returnReason" text,
	"returnBankTransactionId" text,
	"returnFeeAmount" numeric(12, 2),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sepa_dd_item_amount_positive" CHECK ("sepa_direct_debit_item"."amount" > 0),
	CONSTRAINT "sepa_dd_item_sequence_valid" CHECK ("sepa_direct_debit_item"."sequenceType" IN ('FRST', 'RCUR', 'OOFF', 'FNAL')),
	CONSTRAINT "sepa_dd_item_status_valid" CHECK ("sepa_direct_debit_item"."status" IN ('PENDING', 'COLLECTED', 'RETURNED'))
);
--> statement-breakpoint
CREATE TABLE "sepa_direct_debit_remittance" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"bankAccountId" text NOT NULL,
	"number" text NOT NULL,
	"status" text DEFAULT 'GENERATED' NOT NULL,
	"collectionDate" timestamp with time zone NOT NULL,
	"creditorId" text NOT NULL,
	"totalAmount" numeric(12, 2) NOT NULL,
	"itemCount" integer NOT NULL,
	"xml" text NOT NULL,
	"createdByUserId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"collectedAt" timestamp with time zone,
	"cancelledAt" timestamp with time zone,
	CONSTRAINT "sepa_dd_remittance_company_number_unique" UNIQUE("companyId","number"),
	CONSTRAINT "sepa_dd_remittance_status_valid" CHECK ("sepa_direct_debit_remittance"."status" IN ('GENERATED', 'COLLECTED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "sepa_mandate" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"customerId" text NOT NULL,
	"mandateReference" text NOT NULL,
	"signatureDate" timestamp with time zone NOT NULL,
	"iban" text NOT NULL,
	"bic" text,
	"mandateType" text DEFAULT 'RECURRENT' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"collectionCount" integer DEFAULT 0 NOT NULL,
	"firstCollectionAt" timestamp with time zone,
	"lastCollectionAt" timestamp with time zone,
	"revokedAt" timestamp with time zone,
	"notes" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sepa_mandate_company_reference_unique" UNIQUE("companyId","mandateReference"),
	CONSTRAINT "sepa_mandate_type_valid" CHECK ("sepa_mandate"."mandateType" IN ('RECURRENT', 'ONE_OFF')),
	CONSTRAINT "sepa_mandate_status_valid" CHECK ("sepa_mandate"."status" IN ('ACTIVE', 'REVOKED'))
);
--> statement-breakpoint
ALTER TABLE "document_series" DROP CONSTRAINT "document_series_company_year_type_unique";--> statement-breakpoint
ALTER TABLE "bank_transaction" DROP CONSTRAINT "bank_transaction_import_source_valid";--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "sepaCreditorId" text;--> statement-breakpoint
ALTER TABLE "document_series" ADD COLUMN "code" text DEFAULT 'GEN' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_series" ADD COLUMN "name" text DEFAULT 'General' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_series" ADD COLUMN "isDefault" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "document_series" ADD COLUMN "isActive" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "seriesId" text;--> statement-breakpoint
ALTER TABLE "recurring_template" ADD COLUMN "seriesId" text;--> statement-breakpoint
ALTER TABLE "bank_connection" ADD CONSTRAINT "bank_connection_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_connection" ADD CONSTRAINT "bank_connection_createdByUserId_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_connection_account" ADD CONSTRAINT "bank_connection_account_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_connection_account" ADD CONSTRAINT "bank_connection_account_connectionId_bank_connection_id_fk" FOREIGN KEY ("connectionId") REFERENCES "public"."bank_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_connection_account" ADD CONSTRAINT "bank_connection_account_bankAccountId_bank_account_id_fk" FOREIGN KEY ("bankAccountId") REFERENCES "public"."bank_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_direct_debit_item" ADD CONSTRAINT "sepa_direct_debit_item_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_direct_debit_item" ADD CONSTRAINT "sepa_direct_debit_item_remittanceId_sepa_direct_debit_remittance_id_fk" FOREIGN KEY ("remittanceId") REFERENCES "public"."sepa_direct_debit_remittance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_direct_debit_item" ADD CONSTRAINT "sepa_direct_debit_item_invoiceId_invoice_id_fk" FOREIGN KEY ("invoiceId") REFERENCES "public"."invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_direct_debit_item" ADD CONSTRAINT "sepa_direct_debit_item_customerId_customer_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_direct_debit_item" ADD CONSTRAINT "sepa_direct_debit_item_mandateId_sepa_mandate_id_fk" FOREIGN KEY ("mandateId") REFERENCES "public"."sepa_mandate"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_direct_debit_item" ADD CONSTRAINT "sepa_direct_debit_item_paymentId_payment_id_fk" FOREIGN KEY ("paymentId") REFERENCES "public"."payment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_direct_debit_item" ADD CONSTRAINT "sepa_direct_debit_item_returnBankTransactionId_bank_transaction_id_fk" FOREIGN KEY ("returnBankTransactionId") REFERENCES "public"."bank_transaction"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_direct_debit_remittance" ADD CONSTRAINT "sepa_direct_debit_remittance_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_direct_debit_remittance" ADD CONSTRAINT "sepa_direct_debit_remittance_bankAccountId_bank_account_id_fk" FOREIGN KEY ("bankAccountId") REFERENCES "public"."bank_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_direct_debit_remittance" ADD CONSTRAINT "sepa_direct_debit_remittance_createdByUserId_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_mandate" ADD CONSTRAINT "sepa_mandate_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_mandate" ADD CONSTRAINT "sepa_mandate_customerId_customer_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_connection_company_status_idx" ON "bank_connection" USING btree ("companyId","status");--> statement-breakpoint
CREATE INDEX "bank_connection_account_connection_idx" ON "bank_connection_account" USING btree ("connectionId");--> statement-breakpoint
CREATE INDEX "bank_connection_account_bank_account_idx" ON "bank_connection_account" USING btree ("companyId","bankAccountId");--> statement-breakpoint
CREATE INDEX "sepa_dd_item_remittance_idx" ON "sepa_direct_debit_item" USING btree ("remittanceId");--> statement-breakpoint
CREATE INDEX "sepa_dd_item_invoice_idx" ON "sepa_direct_debit_item" USING btree ("companyId","invoiceId");--> statement-breakpoint
CREATE INDEX "sepa_dd_item_payment_idx" ON "sepa_direct_debit_item" USING btree ("paymentId");--> statement-breakpoint
CREATE INDEX "sepa_dd_remittance_company_status_idx" ON "sepa_direct_debit_remittance" USING btree ("companyId","status");--> statement-breakpoint
CREATE INDEX "sepa_mandate_company_customer_idx" ON "sepa_mandate" USING btree ("companyId","customerId","status");--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_seriesId_document_series_id_fk" FOREIGN KEY ("seriesId") REFERENCES "public"."document_series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_template" ADD CONSTRAINT "recurring_template_seriesId_document_series_id_fk" FOREIGN KEY ("seriesId") REFERENCES "public"."document_series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_series_one_default_idx" ON "document_series" USING btree ("companyId","fiscalYearId","type") WHERE "document_series"."isDefault";--> statement-breakpoint
ALTER TABLE "document_series" ADD CONSTRAINT "document_series_company_year_type_code_unique" UNIQUE("companyId","fiscalYearId","type","code");--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_import_source_valid" CHECK ("bank_transaction"."importSource" IS NULL OR "bank_transaction"."importSource" IN ('MANUAL', 'CSV', 'XLSX', 'NORMA43', 'PSD2'));--> statement-breakpoint
ALTER TABLE "document_series" ADD CONSTRAINT "document_series_default_active" CHECK (NOT "document_series"."isDefault" OR "document_series"."isActive");