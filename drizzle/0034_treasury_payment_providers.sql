ALTER TABLE "bank_account" ALTER COLUMN "iban" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_account" ADD COLUMN "kind" text DEFAULT 'BANK' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_kind_valid" CHECK ("bank_account"."kind" in ('BANK', 'PAYMENT_PROVIDER'));--> statement-breakpoint
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_bank_has_iban" CHECK ("bank_account"."kind" <> 'BANK' or "bank_account"."iban" is not null);