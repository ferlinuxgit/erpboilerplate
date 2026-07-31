ALTER TABLE "company_settings" ADD COLUMN "pdfShowLogo" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "pdfShowEmail" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "pdfShowPhone" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "pdfShowWebsite" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "pdfShowCustomerNumber" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "pdfShowPaymentMethod" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "pdfShowTaxBreakdown" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_method" ADD COLUMN "bankAccountId" text;--> statement-breakpoint
ALTER TABLE "payment_method" ADD COLUMN "isDefault" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_method" ADD CONSTRAINT "payment_method_bankAccountId_bank_account_id_fk" FOREIGN KEY ("bankAccountId") REFERENCES "public"."bank_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "payment_method" AS pm
SET "bankAccountId" = ba."id",
    "bankAccountNumber" = ba."iban",
    "updatedAt" = now()
FROM "bank_account" AS ba
WHERE pm."companyId" = ba."companyId"
  AND pm."type" = 'BANK_TRANSFER'
  AND pm."bankAccountId" IS NULL
  AND regexp_replace(upper(coalesce(pm."bankAccountNumber", '')), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(ba."iban"), '[^A-Z0-9]', '', 'g');--> statement-breakpoint
INSERT INTO "payment_method" ("id", "companyId", "bankAccountId", "code", "name", "type", "bankAccountNumber", "isDefault")
SELECT
  'bank-payment-' || ba."id",
  ba."companyId",
  ba."id",
  'AUTO-BANK-' || ba."id",
  'Transferencia · ' || ba."bankName",
  'BANK_TRANSFER',
  ba."iban",
  false
FROM "bank_account" AS ba
WHERE NOT EXISTS (
  SELECT 1 FROM "payment_method" AS pm WHERE pm."bankAccountId" = ba."id"
)
ON CONFLICT DO NOTHING;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_method_company_default_unique" ON "payment_method" USING btree ("companyId") WHERE "payment_method"."isDefault" = true;--> statement-breakpoint
CREATE INDEX "payment_method_bank_account_idx" ON "payment_method" USING btree ("bankAccountId");
