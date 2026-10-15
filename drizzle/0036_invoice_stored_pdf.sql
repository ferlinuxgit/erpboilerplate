ALTER TABLE "invoice" ADD COLUMN "pdfStorageKey" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "pdfFileName" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "pdfSha256" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "pdfGeneratedAt" timestamp with time zone;