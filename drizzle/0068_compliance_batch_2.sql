-- Segundo lote de cumplimiento (auditoría 2026-11-27): nóminas y retenciones, Impuesto sobre
-- Sociedades, SII, factura electrónica, clase de documento y canje de simplificadas, criterio de
-- caja y prorrata, cuentas anuales y libros oficiales, compensación de abonos de proveedor,
-- centros de coste y declaración responsable de VERI*FACTU. Todo son tablas nuevas y columnas con
-- valor por defecto o anulables: quien no usa lo nuevo no nota cambios.
CREATE TABLE "annual_accounts_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"fiscalYearId" text NOT NULL,
	"sections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"averageEmployees" numeric(8, 2),
	"taxData" jsonb,
	"updatedByUserId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "annual_accounts_notes_company_year_unique" UNIQUE("companyId","fiscalYearId")
);
--> statement-breakpoint
CREATE TABLE "capital_income_payment" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"recipientName" text NOT NULL,
	"recipientTaxId" text,
	"kind" text NOT NULL,
	"paymentDate" date NOT NULL,
	"grossAmount" numeric(12, 2) NOT NULL,
	"withholdingRate" numeric(6, 3) DEFAULT '19' NOT NULL,
	"withholdingAmount" numeric(12, 2) NOT NULL,
	"bankAccountId" text,
	"journalEntryId" text,
	"notes" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capital_income_payment_kind_valid" CHECK ("capital_income_payment"."kind" IN ('dividend', 'interest')),
	CONSTRAINT "capital_income_payment_amounts_valid" CHECK ("capital_income_payment"."grossAmount" > 0 AND "capital_income_payment"."withholdingAmount" >= 0 AND "capital_income_payment"."withholdingAmount" <= "capital_income_payment"."grossAmount")
);
--> statement-breakpoint
CREATE TABLE "corporate_tax_installment" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"fiscalYearId" text NOT NULL,
	"period" text NOT NULL,
	"method" text DEFAULT 'quota' NOT NULL,
	"inputs" jsonb NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"snapshot" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"filedAt" timestamp with time zone,
	"filingReceiptNumber" text,
	"paidAt" date,
	"paidAmount" numeric(14, 2),
	"journalEntryId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporate_tax_installment_company_year_period_unique" UNIQUE("companyId","fiscalYearId","period"),
	CONSTRAINT "corporate_tax_installment_period_valid" CHECK ("corporate_tax_installment"."period" IN ('1P', '2P', '3P')),
	CONSTRAINT "corporate_tax_installment_method_valid" CHECK ("corporate_tax_installment"."method" IN ('quota', 'base')),
	CONSTRAINT "corporate_tax_installment_status_valid" CHECK ("corporate_tax_installment"."status" IN ('draft', 'filed')),
	CONSTRAINT "corporate_tax_installment_amount_valid" CHECK ("corporate_tax_installment"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "corporate_tax_loss" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"originYear" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"notes" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporate_tax_loss_company_year_unique" UNIQUE("companyId","originYear"),
	CONSTRAINT "corporate_tax_loss_valid" CHECK ("corporate_tax_loss"."amount" > 0 AND "corporate_tax_loss"."originYear" BETWEEN 1990 AND 2100)
);
--> statement-breakpoint
CREATE TABLE "corporate_tax_return" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"fiscalYearId" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"filedAt" timestamp with time zone,
	"filingReceiptNumber" text,
	"filedSnapshot" jsonb,
	"journalEntryId" text,
	"postedAt" timestamp with time zone,
	"postedSnapshot" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporate_tax_return_company_year_unique" UNIQUE("companyId","fiscalYearId"),
	CONSTRAINT "corporate_tax_return_status_valid" CHECK ("corporate_tax_return"."status" IN ('draft', 'filed'))
);
--> statement-breakpoint
CREATE TABLE "corporate_tax_settings" (
	"companyId" text PRIMARY KEY NOT NULL,
	"remindRelatedParties" boolean DEFAULT false NOT NULL,
	"remindBooks" boolean DEFAULT true NOT NULL,
	"remindAnnualAccounts" boolean DEFAULT true NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_center" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_center_company_code_unique" UNIQUE("companyId","code")
);
--> statement-breakpoint
CREATE TABLE "einvoice_document" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"invoiceId" text NOT NULL,
	"format" text NOT NULL,
	"formatVersion" text NOT NULL,
	"signed" boolean DEFAULT false NOT NULL,
	"signerSubject" text,
	"sha256" text NOT NULL,
	"storageKey" text NOT NULL,
	"fileName" text NOT NULL,
	"status" text DEFAULT 'GENERATED' NOT NULL,
	"generatedByUserId" text,
	"generatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "einvoice_document_invoice_format_signed_unique" UNIQUE("invoiceId","format","signed"),
	CONSTRAINT "einvoice_document_format_valid" CHECK ("einvoice_document"."format" IN ('FACTURAE', 'UBL')),
	CONSTRAINT "einvoice_document_status_valid" CHECK ("einvoice_document"."status" IN ('GENERATED', 'SENT', 'FAILED'))
);
--> statement-breakpoint
CREATE TABLE "einvoice_status_event" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"invoiceId" text NOT NULL,
	"status" text NOT NULL,
	"effectiveDate" text NOT NULL,
	"rejectionCode" text,
	"reason" text,
	"source" text DEFAULT 'MANUAL' NOT NULL,
	"createdByUserId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "einvoice_status_event_status_valid" CHECK ("einvoice_status_event"."status" IN ('SENT', 'RECEIVED', 'ACCEPTED', 'REJECTED', 'PAID'))
);
--> statement-breakpoint
CREATE TABLE "official_book_submission" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"fiscalYearId" text NOT NULL,
	"status" text DEFAULT 'generated' NOT NULL,
	"files" jsonb NOT NULL,
	"ledgerFingerprint" text NOT NULL,
	"entryCount" integer DEFAULT 0 NOT NULL,
	"generatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"generatedByUserId" text,
	"submittedAt" date,
	"registryName" text,
	"submissionReference" text,
	"notes" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_employee" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"name" text NOT NULL,
	"taxId" text,
	"socialSecurityNumber" text,
	"startDate" date,
	"endDate" date,
	"recipientKind" text DEFAULT 'employee' NOT NULL,
	"subkey190" text,
	"withholdingRate" numeric(6, 3) DEFAULT '0' NOT NULL,
	"birthYear" integer,
	"familySituation" integer,
	"disability" integer,
	"contractType" integer,
	"spouseTaxId" text,
	"notes" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_employee_kind_valid" CHECK ("payroll_employee"."recipientKind" IN ('employee', 'director')),
	CONSTRAINT "payroll_employee_rate_valid" CHECK ("payroll_employee"."withholdingRate" >= 0 AND "payroll_employee"."withholdingRate" <= 100)
);
--> statement-breakpoint
CREATE TABLE "payroll_payment" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"kind" text NOT NULL,
	"period" text NOT NULL,
	"paymentDate" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"bankAccountId" text,
	"journalEntryId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_payment_kind_valid" CHECK ("payroll_payment"."kind" IN ('salaries', 'socialSecurity')),
	CONSTRAINT "payroll_payment_amount_valid" CHECK ("payroll_payment"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "payroll_settings" (
	"companyId" text PRIMARY KEY NOT NULL,
	"invoiceWithholdingBasis" text DEFAULT 'registration' NOT NULL,
	"payrollWithholdingBasis" text DEFAULT 'accrual' NOT NULL,
	"enabledModels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_settings_invoice_basis_valid" CHECK ("payroll_settings"."invoiceWithholdingBasis" IN ('registration', 'payment')),
	CONSTRAINT "payroll_settings_payroll_basis_valid" CHECK ("payroll_settings"."payrollWithholdingBasis" IN ('accrual', 'payment'))
);
--> statement-breakpoint
CREATE TABLE "payroll_slip" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"employeeId" text NOT NULL,
	"period" text NOT NULL,
	"concept" text DEFAULT 'Nómina' NOT NULL,
	"accrualDate" date NOT NULL,
	"grossAmount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"inKindAmount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"inKindWithholdingAmount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"withholdingAmount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"employeeSocialSecurity" numeric(12, 2) DEFAULT '0' NOT NULL,
	"employerSocialSecurity" numeric(12, 2) DEFAULT '0' NOT NULL,
	"advancesAmount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"netAmount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"journalEntryId" text,
	"paymentDate" date,
	"paymentId" text,
	"notes" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_slip_employee_period_concept_unique" UNIQUE("employeeId","period","concept"),
	CONSTRAINT "payroll_slip_status_valid" CHECK ("payroll_slip"."status" IN ('draft', 'posted')),
	CONSTRAINT "payroll_slip_period_valid" CHECK ("payroll_slip"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "payroll_slip_amounts_valid" CHECK ("payroll_slip"."grossAmount" >= 0 AND "payroll_slip"."inKindAmount" >= 0 AND "payroll_slip"."inKindWithholdingAmount" >= 0 AND "payroll_slip"."withholdingAmount" >= 0 AND "payroll_slip"."employeeSocialSecurity" >= 0 AND "payroll_slip"."employerSocialSecurity" >= 0 AND "payroll_slip"."advancesAmount" >= 0 AND "payroll_slip"."netAmount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "rental_property" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"supplierPartnerId" text NOT NULL,
	"situation" text DEFAULT '1' NOT NULL,
	"cadastralReference" text,
	"address" text,
	"postalCode" text,
	"city" text,
	"province" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rental_property_situation_valid" CHECK ("rental_property"."situation" IN ('1', '2', '3', '4'))
);
--> statement-breakpoint
CREATE TABLE "sii_record" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"book" text NOT NULL,
	"sourceId" text NOT NULL,
	"operation" text NOT NULL,
	"environment" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"fiscalYear" text NOT NULL,
	"period" text NOT NULL,
	"invoiceNumber" text NOT NULL,
	"invoiceDate" text NOT NULL,
	"invoiceTypeCode" text,
	"counterpartyName" text,
	"totalAmount" text,
	"payload" jsonb NOT NULL,
	"contentHash" text NOT NULL,
	"dueDate" text,
	"blockedReason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"nextAttemptAt" timestamp with time zone,
	"lastAttemptAt" timestamp with time zone,
	"sentAt" timestamp with time zone,
	"aeatCsv" text,
	"aeatErrorCode" text,
	"aeatErrorMessage" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sii_record_book_valid" CHECK ("sii_record"."book" IN ('ISSUED', 'RECEIVED')),
	CONSTRAINT "sii_record_operation_valid" CHECK ("sii_record"."operation" IN ('A0', 'A1', 'BAJA')),
	CONSTRAINT "sii_record_environment_valid" CHECK ("sii_record"."environment" IN ('production', 'test')),
	CONSTRAINT "sii_record_status_valid" CHECK ("sii_record"."status" IN ('PENDING', 'SENT', 'ACCEPTED', 'ACCEPTED_WITH_ERRORS', 'REJECTED'))
);
--> statement-breakpoint
CREATE TABLE "sii_settings" (
	"companyId" text PRIMARY KEY NOT NULL,
	"since" timestamp with time zone NOT NULL,
	"lastDetectionAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_credit_application" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"creditInvoiceId" text NOT NULL,
	"supplierInvoiceId" text,
	"amount" numeric(12, 2) NOT NULL,
	"appliedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"bankAccountId" text,
	"reference" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_credit_application_amount_positive" CHECK ("supplier_credit_application"."amount" > 0),
	CONSTRAINT "supplier_credit_application_distinct" CHECK ("supplier_credit_application"."supplierInvoiceId" IS NULL OR "supplier_credit_application"."supplierInvoiceId" <> "supplier_credit_application"."creditInvoiceId")
);
--> statement-breakpoint
CREATE TABLE "verifactu_declaration" (
	"id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"title" text NOT NULL,
	"rows" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verifactu_declaration_version_unique" UNIQUE("version")
);
--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "vatProrataFinal" jsonb;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "annualAccountsModel" text DEFAULT 'abbreviated' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "dir3AccountingOffice" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "dir3ManagingBody" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "dir3ProcessingUnit" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "dir3ProposingBody" text;--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD COLUMN "disposalInvoiceId" text;--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD COLUMN "costCenterId" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "documentClass" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "isSubstitutive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "substitutesInvoiceIds" jsonb;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "commercialReason" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "legalMentions" text;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD COLUMN "supplierCashAccounting" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "verifactu_record" ADD COLUMN "substitutedInvoices" jsonb;--> statement-breakpoint
ALTER TABLE "verifactu_record" ADD COLUMN "simplifiedArt7273" text;--> statement-breakpoint
ALTER TABLE "annual_accounts_notes" ADD CONSTRAINT "annual_accounts_notes_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_accounts_notes" ADD CONSTRAINT "annual_accounts_notes_fiscalYearId_fiscal_year_id_fk" FOREIGN KEY ("fiscalYearId") REFERENCES "public"."fiscal_year"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_accounts_notes" ADD CONSTRAINT "annual_accounts_notes_updatedByUserId_user_id_fk" FOREIGN KEY ("updatedByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capital_income_payment" ADD CONSTRAINT "capital_income_payment_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capital_income_payment" ADD CONSTRAINT "capital_income_payment_bankAccountId_bank_account_id_fk" FOREIGN KEY ("bankAccountId") REFERENCES "public"."bank_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capital_income_payment" ADD CONSTRAINT "capital_income_payment_journalEntryId_journal_entry_id_fk" FOREIGN KEY ("journalEntryId") REFERENCES "public"."journal_entry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_tax_installment" ADD CONSTRAINT "corporate_tax_installment_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_tax_installment" ADD CONSTRAINT "corporate_tax_installment_fiscalYearId_fiscal_year_id_fk" FOREIGN KEY ("fiscalYearId") REFERENCES "public"."fiscal_year"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_tax_installment" ADD CONSTRAINT "corporate_tax_installment_journalEntryId_journal_entry_id_fk" FOREIGN KEY ("journalEntryId") REFERENCES "public"."journal_entry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_tax_loss" ADD CONSTRAINT "corporate_tax_loss_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_tax_return" ADD CONSTRAINT "corporate_tax_return_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_tax_return" ADD CONSTRAINT "corporate_tax_return_fiscalYearId_fiscal_year_id_fk" FOREIGN KEY ("fiscalYearId") REFERENCES "public"."fiscal_year"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_tax_return" ADD CONSTRAINT "corporate_tax_return_journalEntryId_journal_entry_id_fk" FOREIGN KEY ("journalEntryId") REFERENCES "public"."journal_entry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_tax_settings" ADD CONSTRAINT "corporate_tax_settings_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_center" ADD CONSTRAINT "cost_center_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einvoice_document" ADD CONSTRAINT "einvoice_document_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einvoice_document" ADD CONSTRAINT "einvoice_document_invoiceId_invoice_id_fk" FOREIGN KEY ("invoiceId") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einvoice_document" ADD CONSTRAINT "einvoice_document_generatedByUserId_user_id_fk" FOREIGN KEY ("generatedByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einvoice_status_event" ADD CONSTRAINT "einvoice_status_event_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einvoice_status_event" ADD CONSTRAINT "einvoice_status_event_invoiceId_invoice_id_fk" FOREIGN KEY ("invoiceId") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einvoice_status_event" ADD CONSTRAINT "einvoice_status_event_createdByUserId_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_book_submission" ADD CONSTRAINT "official_book_submission_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_book_submission" ADD CONSTRAINT "official_book_submission_fiscalYearId_fiscal_year_id_fk" FOREIGN KEY ("fiscalYearId") REFERENCES "public"."fiscal_year"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_book_submission" ADD CONSTRAINT "official_book_submission_generatedByUserId_user_id_fk" FOREIGN KEY ("generatedByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_employee" ADD CONSTRAINT "payroll_employee_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payment" ADD CONSTRAINT "payroll_payment_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payment" ADD CONSTRAINT "payroll_payment_bankAccountId_bank_account_id_fk" FOREIGN KEY ("bankAccountId") REFERENCES "public"."bank_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payment" ADD CONSTRAINT "payroll_payment_journalEntryId_journal_entry_id_fk" FOREIGN KEY ("journalEntryId") REFERENCES "public"."journal_entry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_slip" ADD CONSTRAINT "payroll_slip_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_slip" ADD CONSTRAINT "payroll_slip_employeeId_payroll_employee_id_fk" FOREIGN KEY ("employeeId") REFERENCES "public"."payroll_employee"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_slip" ADD CONSTRAINT "payroll_slip_journalEntryId_journal_entry_id_fk" FOREIGN KEY ("journalEntryId") REFERENCES "public"."journal_entry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_slip" ADD CONSTRAINT "payroll_slip_paymentId_payroll_payment_id_fk" FOREIGN KEY ("paymentId") REFERENCES "public"."payroll_payment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_property" ADD CONSTRAINT "rental_property_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_property" ADD CONSTRAINT "rental_property_supplierPartnerId_partner_id_fk" FOREIGN KEY ("supplierPartnerId") REFERENCES "public"."partner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sii_record" ADD CONSTRAINT "sii_record_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sii_settings" ADD CONSTRAINT "sii_settings_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_application" ADD CONSTRAINT "supplier_credit_application_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_application" ADD CONSTRAINT "supplier_credit_application_creditInvoiceId_supplier_invoice_id_fk" FOREIGN KEY ("creditInvoiceId") REFERENCES "public"."supplier_invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_application" ADD CONSTRAINT "supplier_credit_application_supplierInvoiceId_supplier_invoice_id_fk" FOREIGN KEY ("supplierInvoiceId") REFERENCES "public"."supplier_invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_application" ADD CONSTRAINT "supplier_credit_application_bankAccountId_bank_account_id_fk" FOREIGN KEY ("bankAccountId") REFERENCES "public"."bank_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capital_income_payment_company_date_idx" ON "capital_income_payment" USING btree ("companyId","paymentDate");--> statement-breakpoint
CREATE INDEX "corporate_tax_installment_entry_idx" ON "corporate_tax_installment" USING btree ("journalEntryId");--> statement-breakpoint
CREATE INDEX "corporate_tax_return_entry_idx" ON "corporate_tax_return" USING btree ("journalEntryId");--> statement-breakpoint
CREATE INDEX "einvoice_document_company_idx" ON "einvoice_document" USING btree ("companyId","generatedAt");--> statement-breakpoint
CREATE INDEX "einvoice_status_event_invoice_idx" ON "einvoice_status_event" USING btree ("invoiceId","createdAt");--> statement-breakpoint
CREATE INDEX "einvoice_status_event_company_idx" ON "einvoice_status_event" USING btree ("companyId","createdAt");--> statement-breakpoint
CREATE INDEX "official_book_submission_company_year_idx" ON "official_book_submission" USING btree ("companyId","fiscalYearId","status");--> statement-breakpoint
CREATE INDEX "payroll_employee_company_name_idx" ON "payroll_employee" USING btree ("companyId","name");--> statement-breakpoint
CREATE INDEX "payroll_payment_company_period_idx" ON "payroll_payment" USING btree ("companyId","period");--> statement-breakpoint
CREATE INDEX "payroll_slip_company_period_idx" ON "payroll_slip" USING btree ("companyId","period");--> statement-breakpoint
CREATE INDEX "payroll_slip_company_accrual_idx" ON "payroll_slip" USING btree ("companyId","accrualDate");--> statement-breakpoint
CREATE INDEX "payroll_slip_payment_idx" ON "payroll_slip" USING btree ("paymentId");--> statement-breakpoint
CREATE INDEX "rental_property_company_supplier_idx" ON "rental_property" USING btree ("companyId","supplierPartnerId");--> statement-breakpoint
CREATE UNIQUE INDEX "sii_record_pending_unique" ON "sii_record" USING btree ("companyId","environment","book","sourceId") WHERE "sii_record"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "sii_record_source_idx" ON "sii_record" USING btree ("companyId","book","sourceId","createdAt");--> statement-breakpoint
CREATE INDEX "sii_record_status_idx" ON "sii_record" USING btree ("status","nextAttemptAt");--> statement-breakpoint
CREATE INDEX "sii_record_company_created_idx" ON "sii_record" USING btree ("companyId","createdAt");--> statement-breakpoint
CREATE INDEX "supplier_credit_application_credit_idx" ON "supplier_credit_application" USING btree ("companyId","creditInvoiceId");--> statement-breakpoint
CREATE INDEX "supplier_credit_application_invoice_idx" ON "supplier_credit_application" USING btree ("supplierInvoiceId");--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD CONSTRAINT "fixed_asset_disposalInvoiceId_invoice_id_fk" FOREIGN KEY ("disposalInvoiceId") REFERENCES "public"."invoice"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD CONSTRAINT "fixed_asset_costCenterId_cost_center_id_fk" FOREIGN KEY ("costCenterId") REFERENCES "public"."cost_center"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_document_class_valid" CHECK ("invoice"."documentClass" IS NULL OR "invoice"."documentClass" IN ('FULL', 'SIMPLIFIED', 'SIMPLIFIED_QUALIFIED'));--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_commercial_reason_valid" CHECK ("invoice"."commercialReason" IS NULL OR "invoice"."commercialReason" IN ('RETURN', 'DISCOUNT', 'ERROR'));--> statement-breakpoint
-- Abonos de proveedor ya registrados con factura enlazada: se compensan contra lo pendiente de su
-- factura (hasta ahora quedaban como saldo a favor sin aplicar), por orden de fecha.
WITH credits AS (
  SELECT c."id" AS credit_id, c."companyId", c."rectifiedInvoiceId" AS invoice_id, -c."totalAmount" AS credit_amount,
         SUM(-c."totalAmount") OVER (PARTITION BY c."rectifiedInvoiceId" ORDER BY c."issueDate", c."id") AS running
  FROM "supplier_invoice" c
  WHERE c."status" <> 'VOID' AND c."totalAmount" < 0 AND c."rectifiedInvoiceId" IS NOT NULL
), targets AS (
  SELECT f."id", GREATEST(f."totalAmount" - COALESCE((SELECT SUM(p."amountApplied") FROM "supplier_invoice_payment" p WHERE p."supplierInvoiceId" = f."id"), 0), 0) AS outstanding
  FROM "supplier_invoice" f WHERE f."status" <> 'VOID' AND f."totalAmount" > 0
)
INSERT INTO "supplier_credit_application" ("id","companyId","creditInvoiceId","supplierInvoiceId","amount")
SELECT gen_random_uuid()::text, c."companyId", c.credit_id, c.invoice_id,
       LEAST(c.credit_amount, t.outstanding - (c.running - c.credit_amount))
FROM credits c JOIN targets t ON t."id" = c.invoice_id
WHERE t.outstanding - (c.running - c.credit_amount) > 0;--> statement-breakpoint
UPDATE "supplier_invoice" f SET "paymentStatus" = CASE WHEN s.settled >= f."totalAmount" THEN 'PAID'::payment_status ELSE 'PARTIAL'::payment_status END
FROM (SELECT a."supplierInvoiceId" AS id,
             SUM(a."amount") + COALESCE((SELECT SUM(p."amountApplied") FROM "supplier_invoice_payment" p WHERE p."supplierInvoiceId" = a."supplierInvoiceId"), 0) AS settled
      FROM "supplier_credit_application" a WHERE a."supplierInvoiceId" IS NOT NULL GROUP BY a."supplierInvoiceId") s
WHERE f."id" = s.id AND f."status" <> 'VOID';
