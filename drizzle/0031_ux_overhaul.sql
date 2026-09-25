ALTER TYPE "public"."membership_role" ADD VALUE 'ACCOUNTANT';--> statement-breakpoint
ALTER TYPE "public"."membership_role" ADD VALUE 'VIEWER';--> statement-breakpoint
ALTER TYPE "public"."sales_document_status" ADD VALUE 'REJECTED';--> statement-breakpoint
CREATE TABLE "bank_reconciliation_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"name" text NOT NULL,
	"conceptContains" text NOT NULL,
	"direction" text DEFAULT 'ANY' NOT NULL,
	"minAmount" numeric(12, 2),
	"maxAmount" numeric(12, 2),
	"accountId" text,
	"partnerId" text,
	"autoApply" boolean DEFAULT false NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"timesApplied" integer DEFAULT 0 NOT NULL,
	"lastAppliedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_reconciliation_rule_direction_valid" CHECK ("bank_reconciliation_rule"."direction" IN ('ANY', 'IN', 'OUT')),
	CONSTRAINT "bank_reconciliation_rule_target" CHECK ("bank_reconciliation_rule"."accountId" IS NOT NULL OR "bank_reconciliation_rule"."partnerId" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "bank_transaction_allocation" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"bankTransactionId" text NOT NULL,
	"kind" text NOT NULL,
	"invoicePaymentId" text,
	"paymentId" text,
	"supplierInvoicePaymentId" text,
	"supplierPaymentId" text,
	"accountId" text,
	"amount" numeric(12, 2) NOT NULL,
	"createdPayment" boolean DEFAULT false NOT NULL,
	"ruleId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_transaction_allocation_kind_valid" CHECK ("bank_transaction_allocation"."kind" IN ('CUSTOMER_PAYMENT', 'SUPPLIER_PAYMENT', 'ACCOUNT')),
	CONSTRAINT "bank_transaction_allocation_amount_nonzero" CHECK ("bank_transaction_allocation"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "dunning_customer_opt_out" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"customerId" text NOT NULL,
	"createdByUserId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dunning_customer_opt_out_company_customer_unique" UNIQUE("companyId","customerId")
);
--> statement-breakpoint
CREATE TABLE "expense_ocr_setting" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"externalAiEnabled" boolean DEFAULT true NOT NULL,
	"updatedByUserId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_ocr_setting_companyId_unique" UNIQUE("companyId")
);
--> statement-breakpoint
CREATE TABLE "invoice_email_log" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"invoiceId" text NOT NULL,
	"kind" text DEFAULT 'INVOICE' NOT NULL,
	"reminderLevel" integer,
	"toEmails" text NOT NULL,
	"ccEmails" text,
	"subject" text NOT NULL,
	"status" text NOT NULL,
	"messageId" text,
	"error" text,
	"trigger" text DEFAULT 'MANUAL' NOT NULL,
	"userId" text,
	"sentAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_email_log_kind_valid" CHECK ("invoice_email_log"."kind" IN ('INVOICE', 'REMINDER')),
	CONSTRAINT "invoice_email_log_status_valid" CHECK ("invoice_email_log"."status" IN ('SENT', 'FAILED')),
	CONSTRAINT "invoice_email_log_trigger_valid" CHECK ("invoice_email_log"."trigger" IN ('MANUAL', 'AUTOMATIC')),
	CONSTRAINT "invoice_email_log_reminder_level_valid" CHECK ("invoice_email_log"."reminderLevel" IS NULL OR "invoice_email_log"."reminderLevel" BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE TABLE "invoice_email_setting" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"invoiceSubject" text,
	"invoiceBody" text,
	"reminder1Subject" text,
	"reminder1Body" text,
	"reminder2Subject" text,
	"reminder2Body" text,
	"reminder3Subject" text,
	"reminder3Body" text,
	"copyToSelfDefault" boolean DEFAULT false NOT NULL,
	"dunningEnabled" boolean DEFAULT false NOT NULL,
	"dunningFirstDelayDays" integer DEFAULT 3 NOT NULL,
	"dunningIntervalDays" integer DEFAULT 7 NOT NULL,
	"dunningMaxReminders" integer DEFAULT 3 NOT NULL,
	"updatedByUserId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_email_setting_companyId_unique" UNIQUE("companyId"),
	CONSTRAINT "invoice_email_setting_dunning_first_delay_valid" CHECK ("invoice_email_setting"."dunningFirstDelayDays" BETWEEN 0 AND 365),
	CONSTRAINT "invoice_email_setting_dunning_interval_valid" CHECK ("invoice_email_setting"."dunningIntervalDays" BETWEEN 1 AND 365),
	CONSTRAINT "invoice_email_setting_dunning_max_valid" CHECK ("invoice_email_setting"."dunningMaxReminders" BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE TABLE "partner_bank_account" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"partnerId" text NOT NULL,
	"iban" text NOT NULL,
	"bic" text,
	"isDefault" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_bank_account_company_partner_iban_unique" UNIQUE("companyId","partnerId","iban")
);
--> statement-breakpoint
CREATE TABLE "recurring_run" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"templateId" text NOT NULL,
	"periodDate" text NOT NULL,
	"status" text NOT NULL,
	"invoiceId" text,
	"supplierInvoiceId" text,
	"payload" jsonb,
	"message" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_run_template_period_unique" UNIQUE("templateId","periodDate"),
	CONSTRAINT "recurring_run_status_valid" CHECK ("recurring_run"."status" IN ('GENERATED', 'PENDING_REVIEW', 'DISCARDED'))
);
--> statement-breakpoint
CREATE TABLE "recurring_template" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"customerId" text,
	"supplierPartnerId" text,
	"frequency" text NOT NULL,
	"intervalMonths" integer DEFAULT 1 NOT NULL,
	"startDate" text NOT NULL,
	"endDate" text,
	"dayOfMonth" integer NOT NULL,
	"maxOccurrences" integer,
	"issueMode" text DEFAULT 'DRAFT' NOT NULL,
	"lines" jsonb NOT NULL,
	"notes" text,
	"vatTreatment" text,
	"sourceInvoiceId" text,
	"nextRunDate" text,
	"occurrencesGenerated" integer DEFAULT 0 NOT NULL,
	"lastRunAt" timestamp with time zone,
	"lastError" text,
	"createdByUserId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_template_kind_valid" CHECK ("recurring_template"."kind" IN ('SALES_INVOICE', 'EXPENSE')),
	CONSTRAINT "recurring_template_status_valid" CHECK ("recurring_template"."status" IN ('ACTIVE', 'PAUSED', 'FINISHED')),
	CONSTRAINT "recurring_template_frequency_valid" CHECK ("recurring_template"."frequency" IN ('MONTHLY', 'QUARTERLY', 'YEARLY', 'EVERY_N_MONTHS')),
	CONSTRAINT "recurring_template_interval_valid" CHECK ("recurring_template"."intervalMonths" BETWEEN 1 AND 60),
	CONSTRAINT "recurring_template_day_valid" CHECK ("recurring_template"."dayOfMonth" BETWEEN 1 AND 31),
	CONSTRAINT "recurring_template_issue_mode_valid" CHECK ("recurring_template"."issueMode" IN ('DRAFT', 'ISSUE', 'ISSUE_AND_EMAIL', 'POST')),
	CONSTRAINT "recurring_template_party_valid" CHECK (("recurring_template"."kind" = 'SALES_INVOICE' AND "recurring_template"."customerId" IS NOT NULL) OR ("recurring_template"."kind" = 'EXPENSE' AND "recurring_template"."supplierPartnerId" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "sepa_remittance" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"bankAccountId" text NOT NULL,
	"number" text NOT NULL,
	"status" text DEFAULT 'GENERATED' NOT NULL,
	"executionDate" timestamp with time zone NOT NULL,
	"totalAmount" numeric(12, 2) NOT NULL,
	"itemCount" integer NOT NULL,
	"xml" text NOT NULL,
	"createdByUserId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmedAt" timestamp with time zone,
	"cancelledAt" timestamp with time zone,
	CONSTRAINT "sepa_remittance_company_number_unique" UNIQUE("companyId","number"),
	CONSTRAINT "sepa_remittance_status_valid" CHECK ("sepa_remittance"."status" IN ('GENERATED', 'CONFIRMED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "sepa_remittance_item" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"remittanceId" text NOT NULL,
	"supplierInvoiceId" text NOT NULL,
	"supplierPartnerId" text NOT NULL,
	"creditorName" text NOT NULL,
	"creditorIban" text NOT NULL,
	"creditorBic" text,
	"amount" numeric(12, 2) NOT NULL,
	"endToEndId" text NOT NULL,
	"remittanceInformation" text NOT NULL,
	"supplierPaymentId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sepa_remittance_item_amount_positive" CHECK ("sepa_remittance_item"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_invoice_goods_receipt" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"supplierInvoiceId" text NOT NULL,
	"goodsReceiptId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_invoice_goods_receipt_unique" UNIQUE("supplierInvoiceId","goodsReceiptId")
);
--> statement-breakpoint
ALTER TABLE "invoice" DROP CONSTRAINT "invoice_vat_treatment_valid";--> statement-breakpoint
ALTER TABLE "bank_account" ADD COLUMN "bic" text;--> statement-breakpoint
ALTER TABLE "bank_account" ADD COLUMN "importMapping" jsonb;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD COLUMN "valueDate" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD COLUMN "balanceAfter" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD COLUMN "importSource" text;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD COLUMN "resolution" text;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "businessType" text DEFAULT 'both' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "onboardingCompletedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "onboardingDismissedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "defaultRetentionRate" numeric(6, 3);--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "defaultVatTreatment" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "invoiceEmail" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "iban" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "equivalenceSurcharge" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "viesStatus" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "viesName" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "viesCheckedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fiscal_report" ADD COLUMN "filingReceiptNumber" text;--> statement-breakpoint
ALTER TABLE "fiscal_report" ADD COLUMN "paymentNrc" text;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "invitedByUserId" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "salesQuoteId" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "salesOrderId" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "deliveryNoteId" text;--> statement-breakpoint
ALTER TABLE "partner" ADD COLUMN "defaultExpenseAccountId" text;--> statement-breakpoint
ALTER TABLE "partner" ADD COLUMN "defaultRetentionRate" numeric(6, 3);--> statement-breakpoint
ALTER TABLE "partner" ADD COLUMN "defaultTaxDeductiblePct" numeric(6, 3);--> statement-breakpoint
ALTER TABLE "partner" ADD COLUMN "defaultVatTreatment" text;--> statement-breakpoint
ALTER TABLE "supplier_invoice_line" ADD COLUMN "purchaseOrderLineId" text;--> statement-breakpoint
ALTER TABLE "supplier_invoice_line" ADD COLUMN "goodsReceiptLineId" text;--> statement-breakpoint
ALTER TABLE "bank_reconciliation_rule" ADD CONSTRAINT "bank_reconciliation_rule_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliation_rule" ADD CONSTRAINT "bank_reconciliation_rule_accountId_account_chart_id_fk" FOREIGN KEY ("accountId") REFERENCES "public"."account_chart"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliation_rule" ADD CONSTRAINT "bank_reconciliation_rule_partnerId_partner_id_fk" FOREIGN KEY ("partnerId") REFERENCES "public"."partner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction_allocation" ADD CONSTRAINT "bank_transaction_allocation_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction_allocation" ADD CONSTRAINT "bank_transaction_allocation_bankTransactionId_bank_transaction_id_fk" FOREIGN KEY ("bankTransactionId") REFERENCES "public"."bank_transaction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction_allocation" ADD CONSTRAINT "bank_transaction_allocation_invoicePaymentId_invoice_payment_id_fk" FOREIGN KEY ("invoicePaymentId") REFERENCES "public"."invoice_payment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction_allocation" ADD CONSTRAINT "bank_transaction_allocation_paymentId_payment_id_fk" FOREIGN KEY ("paymentId") REFERENCES "public"."payment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction_allocation" ADD CONSTRAINT "bank_transaction_allocation_supplierInvoicePaymentId_supplier_invoice_payment_id_fk" FOREIGN KEY ("supplierInvoicePaymentId") REFERENCES "public"."supplier_invoice_payment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction_allocation" ADD CONSTRAINT "bank_transaction_allocation_supplierPaymentId_supplier_payment_id_fk" FOREIGN KEY ("supplierPaymentId") REFERENCES "public"."supplier_payment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction_allocation" ADD CONSTRAINT "bank_transaction_allocation_accountId_account_chart_id_fk" FOREIGN KEY ("accountId") REFERENCES "public"."account_chart"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction_allocation" ADD CONSTRAINT "bank_transaction_allocation_ruleId_bank_reconciliation_rule_id_fk" FOREIGN KEY ("ruleId") REFERENCES "public"."bank_reconciliation_rule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dunning_customer_opt_out" ADD CONSTRAINT "dunning_customer_opt_out_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dunning_customer_opt_out" ADD CONSTRAINT "dunning_customer_opt_out_customerId_customer_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dunning_customer_opt_out" ADD CONSTRAINT "dunning_customer_opt_out_createdByUserId_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_ocr_setting" ADD CONSTRAINT "expense_ocr_setting_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_ocr_setting" ADD CONSTRAINT "expense_ocr_setting_updatedByUserId_user_id_fk" FOREIGN KEY ("updatedByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_email_log" ADD CONSTRAINT "invoice_email_log_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_email_log" ADD CONSTRAINT "invoice_email_log_invoiceId_invoice_id_fk" FOREIGN KEY ("invoiceId") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_email_log" ADD CONSTRAINT "invoice_email_log_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_email_setting" ADD CONSTRAINT "invoice_email_setting_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_email_setting" ADD CONSTRAINT "invoice_email_setting_updatedByUserId_user_id_fk" FOREIGN KEY ("updatedByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_bank_account" ADD CONSTRAINT "partner_bank_account_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_bank_account" ADD CONSTRAINT "partner_bank_account_partnerId_partner_id_fk" FOREIGN KEY ("partnerId") REFERENCES "public"."partner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_run" ADD CONSTRAINT "recurring_run_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_run" ADD CONSTRAINT "recurring_run_templateId_recurring_template_id_fk" FOREIGN KEY ("templateId") REFERENCES "public"."recurring_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_run" ADD CONSTRAINT "recurring_run_invoiceId_invoice_id_fk" FOREIGN KEY ("invoiceId") REFERENCES "public"."invoice"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_run" ADD CONSTRAINT "recurring_run_supplierInvoiceId_supplier_invoice_id_fk" FOREIGN KEY ("supplierInvoiceId") REFERENCES "public"."supplier_invoice"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_template" ADD CONSTRAINT "recurring_template_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_template" ADD CONSTRAINT "recurring_template_customerId_customer_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_template" ADD CONSTRAINT "recurring_template_supplierPartnerId_partner_id_fk" FOREIGN KEY ("supplierPartnerId") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_template" ADD CONSTRAINT "recurring_template_sourceInvoiceId_invoice_id_fk" FOREIGN KEY ("sourceInvoiceId") REFERENCES "public"."invoice"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_template" ADD CONSTRAINT "recurring_template_createdByUserId_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_remittance" ADD CONSTRAINT "sepa_remittance_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_remittance" ADD CONSTRAINT "sepa_remittance_bankAccountId_bank_account_id_fk" FOREIGN KEY ("bankAccountId") REFERENCES "public"."bank_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_remittance" ADD CONSTRAINT "sepa_remittance_createdByUserId_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_remittance_item" ADD CONSTRAINT "sepa_remittance_item_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_remittance_item" ADD CONSTRAINT "sepa_remittance_item_remittanceId_sepa_remittance_id_fk" FOREIGN KEY ("remittanceId") REFERENCES "public"."sepa_remittance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_remittance_item" ADD CONSTRAINT "sepa_remittance_item_supplierInvoiceId_supplier_invoice_id_fk" FOREIGN KEY ("supplierInvoiceId") REFERENCES "public"."supplier_invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_remittance_item" ADD CONSTRAINT "sepa_remittance_item_supplierPartnerId_partner_id_fk" FOREIGN KEY ("supplierPartnerId") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_remittance_item" ADD CONSTRAINT "sepa_remittance_item_supplierPaymentId_supplier_payment_id_fk" FOREIGN KEY ("supplierPaymentId") REFERENCES "public"."supplier_payment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_goods_receipt" ADD CONSTRAINT "supplier_invoice_goods_receipt_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_goods_receipt" ADD CONSTRAINT "supplier_invoice_goods_receipt_supplierInvoiceId_supplier_invoice_id_fk" FOREIGN KEY ("supplierInvoiceId") REFERENCES "public"."supplier_invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_goods_receipt" ADD CONSTRAINT "supplier_invoice_goods_receipt_goodsReceiptId_goods_receipt_id_fk" FOREIGN KEY ("goodsReceiptId") REFERENCES "public"."goods_receipt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_reconciliation_rule_company_idx" ON "bank_reconciliation_rule" USING btree ("companyId","isActive");--> statement-breakpoint
CREATE INDEX "bank_transaction_allocation_transaction_idx" ON "bank_transaction_allocation" USING btree ("bankTransactionId");--> statement-breakpoint
CREATE INDEX "bank_transaction_allocation_invoice_payment_idx" ON "bank_transaction_allocation" USING btree ("companyId","invoicePaymentId");--> statement-breakpoint
CREATE INDEX "bank_transaction_allocation_supplier_payment_idx" ON "bank_transaction_allocation" USING btree ("companyId","supplierInvoicePaymentId");--> statement-breakpoint
CREATE INDEX "invoice_email_log_company_invoice_idx" ON "invoice_email_log" USING btree ("companyId","invoiceId","sentAt");--> statement-breakpoint
CREATE INDEX "partner_bank_account_partner_idx" ON "partner_bank_account" USING btree ("companyId","partnerId");--> statement-breakpoint
CREATE INDEX "recurring_run_company_status_idx" ON "recurring_run" USING btree ("companyId","status");--> statement-breakpoint
CREATE INDEX "recurring_template_company_kind_idx" ON "recurring_template" USING btree ("companyId","kind");--> statement-breakpoint
CREATE INDEX "recurring_template_due_idx" ON "recurring_template" USING btree ("status","nextRunDate");--> statement-breakpoint
CREATE INDEX "sepa_remittance_company_status_idx" ON "sepa_remittance" USING btree ("companyId","status");--> statement-breakpoint
CREATE INDEX "sepa_remittance_item_remittance_idx" ON "sepa_remittance_item" USING btree ("remittanceId");--> statement-breakpoint
CREATE INDEX "sepa_remittance_item_invoice_idx" ON "sepa_remittance_item" USING btree ("companyId","supplierInvoiceId");--> statement-breakpoint
CREATE INDEX "supplier_invoice_goods_receipt_receipt_idx" ON "supplier_invoice_goods_receipt" USING btree ("companyId","goodsReceiptId");--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invitedByUserId_user_id_fk" FOREIGN KEY ("invitedByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_salesQuoteId_sales_quote_id_fk" FOREIGN KEY ("salesQuoteId") REFERENCES "public"."sales_quote"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_salesOrderId_sales_order_id_fk" FOREIGN KEY ("salesOrderId") REFERENCES "public"."sales_order"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_deliveryNoteId_delivery_note_id_fk" FOREIGN KEY ("deliveryNoteId") REFERENCES "public"."delivery_note"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner" ADD CONSTRAINT "partner_defaultExpenseAccountId_account_chart_id_fk" FOREIGN KEY ("defaultExpenseAccountId") REFERENCES "public"."account_chart"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_line" ADD CONSTRAINT "supplier_invoice_line_purchaseOrderLineId_purchase_order_line_id_fk" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "public"."purchase_order_line"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_line" ADD CONSTRAINT "supplier_invoice_line_goodsReceiptLineId_goods_receipt_line_id_fk" FOREIGN KEY ("goodsReceiptLineId") REFERENCES "public"."goods_receipt_line"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_delivery_note_idx" ON "invoice" USING btree ("deliveryNoteId");--> statement-breakpoint
CREATE INDEX "supplier_invoice_line_po_line_idx" ON "supplier_invoice_line" USING btree ("purchaseOrderLineId");--> statement-breakpoint
CREATE INDEX "supplier_invoice_line_receipt_line_idx" ON "supplier_invoice_line" USING btree ("goodsReceiptLineId");--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_resolution_valid" CHECK ("bank_transaction"."resolution" IS NULL OR "bank_transaction"."resolution" IN ('PAYMENT', 'ACCOUNT', 'MIXED'));--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_import_source_valid" CHECK ("bank_transaction"."importSource" IS NULL OR "bank_transaction"."importSource" IN ('MANUAL', 'CSV', 'XLSX', 'NORMA43'));--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_default_vat_treatment_valid" CHECK ("customer"."defaultVatTreatment" IS NULL OR "customer"."defaultVatTreatment" IN ('DOMESTIC', 'INTRA_EU', 'INTRA_EU_SERVICES', 'EXPORT', 'EXEMPT', 'REVERSE_CHARGE', 'NOT_SUBJECT'));--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_vies_status_valid" CHECK ("customer"."viesStatus" IS NULL OR "customer"."viesStatus" IN ('VALID', 'INVALID', 'UNAVAILABLE'));--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_vat_treatment_valid" CHECK ("invoice"."vatTreatment" IS NULL OR "invoice"."vatTreatment" IN ('DOMESTIC', 'INTRA_EU', 'INTRA_EU_SERVICES', 'EXPORT', 'EXEMPT', 'REVERSE_CHARGE', 'NOT_SUBJECT'));--> statement-breakpoint
ALTER TABLE "partner" ADD CONSTRAINT "partner_default_vat_treatment_valid" CHECK ("partner"."defaultVatTreatment" IS NULL OR "partner"."defaultVatTreatment" IN ('DOMESTIC', 'INTRA_EU', 'REVERSE_CHARGE', 'IMPORT', 'NOT_SUBJECT'));--> statement-breakpoint
-- Hand-written data fix: the Spanish template seeded IRPF withholdings as VAT/ADD. They are
-- withholdings that subtract from the invoice total.
UPDATE "tax" SET "kind" = 'WITHHOLDING', "operation" = 'SUBTRACT', "updatedAt" = now()
WHERE "kind" = 'VAT' AND ("name" ILIKE '%retenci%' OR "name" ILIKE '%irpf%');--> statement-breakpoint
-- Hand-written data fix: add recargo de equivalencia rates to existing Spanish companies.
INSERT INTO "tax" ("id", "companyId", "name", "rate", "kind", "operation")
SELECT gen_random_uuid()::text, c."id", v.n, v.r, 'SURCHARGE', 'ADD'
FROM "company" c
CROSS JOIN (VALUES ('Recargo de equivalencia 5,2%', 5.200), ('Recargo de equivalencia 1,4%', 1.400), ('Recargo de equivalencia 0,5%', 0.500)) AS v(n, r)
WHERE c."countryCode" = 'ES' AND EXISTS (SELECT 1 FROM "tax" t WHERE t."companyId" = c."id")
ON CONFLICT ("companyId", "name") DO NOTHING;--> statement-breakpoint
-- Hand-written data fix: companies without a default VAT rate get the general 21% as default,
-- so new quotes/orders/invoices no longer start at the lowest rate (4%).
UPDATE "tax" t SET "isDefault" = true, "updatedAt" = now()
WHERE t."kind" = 'VAT' AND t."operation" = 'ADD' AND t."rate" = 21 AND t."isActive" = true
  AND NOT EXISTS (
    SELECT 1 FROM "tax" d
    WHERE d."companyId" = t."companyId" AND d."kind" = 'VAT' AND d."operation" = 'ADD' AND d."isDefault" = true
  )
  AND t."id" = (
    SELECT x."id" FROM "tax" x
    WHERE x."companyId" = t."companyId" AND x."kind" = 'VAT' AND x."operation" = 'ADD' AND x."rate" = 21 AND x."isActive" = true
    ORDER BY x."createdAt" LIMIT 1
  );