CREATE TABLE "processed_stripe_event" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"stripeCreatedAt" timestamp with time zone NOT NULL,
	"processedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_transaction" DROP CONSTRAINT "bank_transaction_bankAccountId_bank_account_id_fk";
--> statement-breakpoint
ALTER TABLE "bank_account" ADD COLUMN "accountId" text;--> statement-breakpoint
ALTER TABLE "bank_account" ADD COLUMN "isActive" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_account" ADD COLUMN "archivedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fiscal_year" ADD COLUMN "closedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "vatTreatment" text;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "lastStripeEventAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD COLUMN "vatTreatment" text;--> statement-breakpoint
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_accountId_account_chart_id_fk" FOREIGN KEY ("accountId") REFERENCES "public"."account_chart"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_bankAccountId_bank_account_id_fk" FOREIGN KEY ("bankAccountId") REFERENCES "public"."bank_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entry_fiscal_year_lifecycle_unique" ON "journal_entry" USING btree ("companyId","sourceType","sourceId") WHERE "journal_entry"."sourceType" IN ('fiscalYearRegularization', 'fiscalYearClosing', 'fiscalYearOpening') AND "journal_entry"."reversesEntryId" IS NULL AND "journal_entry"."reversedAt" IS NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_vat_treatment_valid" CHECK ("invoice"."vatTreatment" IS NULL OR "invoice"."vatTreatment" IN ('DOMESTIC', 'INTRA_EU', 'EXPORT', 'EXEMPT', 'REVERSE_CHARGE', 'NOT_SUBJECT'));--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_vat_treatment_valid" CHECK ("supplier_invoice"."vatTreatment" IS NULL OR "supplier_invoice"."vatTreatment" IN ('DOMESTIC', 'INTRA_EU', 'REVERSE_CHARGE', 'IMPORT', 'NOT_SUBJECT'));