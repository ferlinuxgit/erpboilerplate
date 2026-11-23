ALTER TABLE "user" ADD COLUMN "totpSecretEncrypted" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "totpEnabledAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "totpLastStep" integer;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "totpRecoveryHashes" jsonb DEFAULT '[]'::jsonb NOT NULL;