ALTER TABLE "account_chart" ADD COLUMN "nature" text;--> statement-breakpoint
ALTER TABLE "account_chart" ADD COLUMN "isBlocked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "account_chart" ADD COLUMN "partnerId" text;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "subaccountLength" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "fiscal_year" ADD COLUMN "nextJournalEntryNumber" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD COLUMN "fiscalYearId" text;--> statement-breakpoint
ALTER TABLE "journal_line" ADD COLUMN "lineNumber" integer;--> statement-breakpoint
ALTER TABLE "journal_line" ADD COLUMN "concept" text;--> statement-breakpoint
ALTER TABLE "journal_line" ADD COLUMN "partnerId" text;--> statement-breakpoint
ALTER TABLE "journal_line" ADD COLUMN "documentType" text;--> statement-breakpoint
ALTER TABLE "journal_line" ADD COLUMN "documentNumber" text;--> statement-breakpoint
ALTER TABLE "journal_line" ADD COLUMN "documentId" text;--> statement-breakpoint
ALTER TABLE "journal_line" ADD COLUMN "dueDate" date;--> statement-breakpoint
ALTER TABLE "journal_line" ADD COLUMN "reconciledAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "journal_line" ADD COLUMN "reconciliationId" text;--> statement-breakpoint
ALTER TABLE "journal_line" ADD COLUMN "matchingId" text;--> statement-breakpoint
ALTER TABLE "journal_line" ADD COLUMN "costCenterId" text;--> statement-breakpoint
ALTER TABLE "partner" ADD COLUMN "supplierKind" text;--> statement-breakpoint
ALTER TABLE "account_chart" ADD CONSTRAINT "account_chart_partnerId_partner_id_fk" FOREIGN KEY ("partnerId") REFERENCES "public"."partner"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_fiscalYearId_fiscal_year_id_fk" FOREIGN KEY ("fiscalYearId") REFERENCES "public"."fiscal_year"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_partnerId_partner_id_fk" FOREIGN KEY ("partnerId") REFERENCES "public"."partner"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_chart_partner_idx" ON "account_chart" USING btree ("partnerId");--> statement-breakpoint
CREATE INDEX "journal_entry_fiscal_year_idx" ON "journal_entry" USING btree ("companyId","fiscalYearId");--> statement-breakpoint
CREATE INDEX "journal_line_account_entry_idx" ON "journal_line" USING btree ("accountId","journalEntryId");--> statement-breakpoint
CREATE INDEX "journal_line_partner_idx" ON "journal_line" USING btree ("partnerId");--> statement-breakpoint
CREATE INDEX "journal_line_matching_idx" ON "journal_line" USING btree ("matchingId");--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_company_year_number_unique" UNIQUE("companyId","fiscalYearId","number");--> statement-breakpoint
ALTER TABLE "account_chart" ADD CONSTRAINT "account_chart_nature_valid" CHECK ("account_chart"."nature" IS NULL OR "account_chart"."nature" IN ('DEBIT', 'CREDIT', 'MIXED'));--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_subaccount_length_valid" CHECK ("company_settings"."subaccountLength" BETWEEN 8 AND 12);--> statement-breakpoint
ALTER TABLE "partner" ADD CONSTRAINT "partner_supplier_kind_valid" CHECK ("partner"."supplierKind" IS NULL OR "partner"."supplierKind" IN ('GOODS', 'SERVICES'));